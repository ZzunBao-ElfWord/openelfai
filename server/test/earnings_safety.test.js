'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { memoryStore } = require('./helpers/payment_memory');
const { createCommerceService } = require('../src/commerce');
const { changeBalance, createPaymentStore } = require('../src/payment_store');
const { createEarningsReview } = require('../src/earnings_review');
const { plan } = require('../scripts/earnings-ops.cjs');

const A = { id: 'u_' + 'a'.repeat(32) }, B = { id: 'u_' + 'b'.repeat(32) };
async function setup() {
  const store = memoryStore(); store.addUser(A); store.addUser(B);
  let payouts = 0;
  const svc = createCommerceService({ store, settings: { enabled: true, allowSandbox: true },
    payout: async () => { payouts++; return { status: 'paid', orderId: 'fake-provider' }; } });
  await store.transaction('Production', async tx => {
    const w = await tx.lockWallet(A.id); w.diamonds = 1000; await tx.saveWallet(A.id, w);
    await tx.put('identity', B.id, { status: 'verified' });
    await tx.put('creator_agreement', B.id, { version: '2026-10-26' });
  });
  const elf = (await svc.snapshot(B, 'Production')).commerce.elves.find(e => e.isMine);
  return { store, svc, elf, payouts: () => payouts,
    tip: (requestId = 'earning_tip_request_01') => svc.action(A, {
      environment: 'Production', type: 'tip', requestId, elfId: elf.id, amount: 100 }),
    withdraw: (requestId = 'earning_withdraw_001') => svc.requestWithdrawal(B, {
      environment: 'Production', requestId, account: '13800000001', amountCents: 1000 }),
    wallet: user => store.transaction('Production', tx => tx.lockWallet(user.id)),
  };
}
async function fund(f) {
  await f.store.transaction('Production', async tx => {
    const w = await tx.lockWallet(B.id); w.availableCents = 2000; await tx.saveWallet(B.id, w);
  });
}

test('keyset settlement reaches older matured earnings behind 500 newer records, and settles once', async () => {
  const f = await setup();
  await f.store.transaction('Production', async tx => {
    const w = await tx.lockWallet(B.id); w.earningsFen = 1002; w.pendingCents = 1002; await tx.saveWallet(B.id, w);
    for (let i = 0; i < 1002; i++) await tx.put('earning', 'entry' + String(i).padStart(4, '0'),
      { id: 'entry' + String(i).padStart(4, '0'), cents: 1, payerId: A.id, settleAt: i < 502 ? 1 : Date.now() + 86400000 },
      { owner: B.id, state: 'pending' });
  });
  for (let i = 0; i < 2; i++) {
    const e = (await f.svc.snapshot(B, 'Production')).commerce.earnings;
    assert.equal(e.availableCents, 502); assert.equal(e.pendingCents, 500);
  }
});

test('tips have payer provenance; each AI gets only its own earnings; replay does not duplicate', async () => {
  const f = await setup();
  await f.store.transaction('Production', tx => tx.put('elf', 'second', { ...f.elf, id: 'second', name: 'second' }, { owner: B.id }));
  await f.tip(); await f.tip();
  const snap = await f.svc.snapshot(B, 'Production');
  assert.equal(snap.commerce.earnings.lifetimeCents, 500);
  assert.equal(snap.commerce.elves.find(e => e.id === f.elf.id).earningsYuan, 5);
  assert.equal(snap.commerce.elves.find(e => e.id === 'second').earningsYuan, 0);
  const rows = await f.store.transaction('Production', tx => tx.list('earning', { owner: B.id }));
  assert.equal(rows.length, 1); assert.equal(rows[0].payerId, A.id);
  await f.svc.action(A, { environment: 'Production', type: 'tip', requestId: 'earning_tip_request_02',
    elfId: f.elf.id, amount: 100, listingId: 'second' });
  const after = await f.svc.snapshot(B, 'Production');
  assert.equal(after.commerce.elves.find(e => e.id === f.elf.id).earningsYuan, 10);
  assert.equal(after.commerce.elves.find(e => e.id === 'second').earningsYuan, 0);
});

test('refund risk blocks recipients without subtracting their balances; manual review is explicit and stale-safe', async () => {
  const f = await setup(); await f.tip(); await fund(f);
  const before = await f.wallet(B);
  await f.store.transaction('Production', async tx => {
    const w = await tx.lockWallet(A.id);
    await changeBalance(tx, A.id, w, { eventId: 'refund001', type: 'refund', amount: -100, note: 'memory only' });
  });
  assert.deepEqual(await f.wallet(B), before);
  await assert.rejects(f.withdraw(), { code: 'EARNINGS_REVIEW_REQUIRED' });
  const reviewer = createEarningsReview(f.store);
  await assert.rejects(reviewer.review(A.id, { action: 'resolve_refund', expectedEventId: 'wrong', confirmed: true,
    reason: '人工核对依据：模拟记录已核对，仅为自动测试' }), { code: 'RISK_CHANGED' });
  await reviewer.review(A.id, { action: 'resolve_refund', expectedEventId: 'refund001', confirmed: true,
    reason: '人工核对依据：模拟记录已核对，仅为自动测试' });
  await f.withdraw();
  await f.store.transaction('Production', async tx => {
    const w = await tx.lockWallet(A.id);
    await changeBalance(tx, A.id, w, { eventId: 'refund002', type: 'refund', amount: -100, note: 'memory only' });
  });
  await assert.rejects(f.withdraw('earning_withdraw_002'), { code: 'EARNINGS_REVIEW_REQUIRED' });
  assert.equal(f.payouts(), 0);
});

test('refund debt or unresolved Alipay review blocks both request and payout approval; rejection remains possible', async () => {
  const f = await setup(); await fund(f);
  const { withdrawal } = await f.withdraw();
  await f.store.transaction('Production', async tx => {
    const w = await tx.lockWallet(B.id); w.refundDebt = 1; await tx.saveWallet(B.id, w);
  });
  await assert.rejects(f.withdraw('earning_withdraw_002'), { code: 'EARNINGS_REVIEW_REQUIRED' });
  await assert.rejects(f.svc.reviewWithdrawal({ environment: 'Production', withdrawalId: withdrawal.id,
    action: 'approve', payeeVerified: true }), { code: 'EARNINGS_REVIEW_REQUIRED' });
  assert.equal(f.payouts(), 0);
  await f.svc.reviewWithdrawal({ environment: 'Production', withdrawalId: withdrawal.id, action: 'reject' });
  assert.equal((await f.wallet(B)).availableCents, 2000);
  await f.store.transaction('Production', async tx => {
    const w = await tx.lockWallet(B.id); w.refundDebt = 0; await tx.saveWallet(B.id, w);
    await tx.put('alipay_review', 'review', {}, { owner: B.id, state: 'needs_review' });
  });
  await assert.rejects(f.withdraw('earning_withdraw_003'), { code: 'EARNINGS_REVIEW_REQUIRED' });
});

test('legacy income needs a matching audited clearance, never a silent balance migration', async () => {
  const f = await setup(); await fund(f);
  await f.store.transaction('Production', tx => tx.put('earning', 'legacy',
    { id: 'legacy', cents: 2000, source: 'tip', refId: f.elf.id, settleAt: 1 }, { owner: B.id, state: 'settled' }));
  await assert.rejects(f.withdraw(), { code: 'EARNINGS_REVIEW_REQUIRED' });
  const reviewer = createEarningsReview(f.store), inspection = await reviewer.inspect(B.id);
  await assert.rejects(reviewer.review(B.id, { action: 'clear_legacy', fingerprint: inspection.legacy.fingerprint }), { code: 'REVIEW_EVIDENCE_REQUIRED' });
  const before = await f.wallet(B);
  await reviewer.review(B.id, { action: 'clear_legacy', fingerprint: inspection.legacy.fingerprint, confirmed: true,
    reason: '人工核对依据：模拟历史流水已核对，仅为自动测试' });
  assert.deepEqual(await f.wallet(B), before);
  await f.withdraw();
  await f.store.transaction('Production', tx => tx.put('earning', 'legacy2',
    { id: 'legacy2', cents: 1, settleAt: 1 }, { owner: B.id, state: 'settled' }));
  await assert.rejects(f.withdraw('earning_withdraw_002'), { code: 'EARNINGS_REVIEW_REQUIRED' });
  assert.equal((await f.store.transaction('Production', tx => tx.list('income_risk_audit', { owner: B.id }))).length, 1);
});

test('production scan uses parameterized owner/state/cursor and stable key ordering', async () => {
  const queries = [];
  const connection = { beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {},
    execute: async (sql, params) => { queries.push({ sql, params }); return [[{ object_id: 'entry2', payload: '{"id":"entry2"}' }]]; } };
  const store = createPaymentStore({ getConnection: async () => connection });
  const rows = await store.transaction('Production', tx => tx.scan('earning', { owner: B.id, state: 'pending', after: 'entry1', lock: true }));
  assert.deepEqual(rows, [{ key: 'entry2', value: { id: 'entry2' } }]);
  assert.match(queries[0].sql, /ORDER BY object_id ASC LIMIT 200 FOR UPDATE$/);
  assert.deepEqual(queries[0].params, ['Production', 'earning', 'entry1', B.id, 'pending']);
});

test('operator tool is read-only by default; payout and clearance need explicit confirmation', () => {
  assert.equal(plan([]).method, 'GET');
  assert.equal(plan(['risk', A.id]).method, 'GET');
  const wd = 'wd_' + 'd'.repeat(32);
  for (const action of ['approve', 'reject', 'reconcile']) assert.throws(() => plan([action, wd]));
  assert.throws(() => plan(['approve', wd, '--confirm', '--reason', '人工核对依据仅为自动测试记录']));
  assert.equal(plan(['approve', wd, '--confirm', '--payee-verified', '--reason', '人工核对依据仅为自动测试记录']).body.payeeVerified, true);
  assert.throws(() => plan(['clear-legacy', A.id, '--confirm', '--reason', '人工核对依据仅为自动测试记录']));
  assert.equal(plan(['reconcile', wd, '--confirm']).body.environment, 'production');
});
