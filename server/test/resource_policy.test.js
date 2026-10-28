'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RESOURCE_POLICY, assertResourceAction } = require('../src/resource_policy');
const { fail } = require('../src/payment_store');
const { createCommerceService } = require('../src/commerce');
const { memoryStore } = require('./helpers/payment_memory');
const { transferOutcome } = require('../src/alipay_gateway');
test('resource contract is station-only with no cashout of diamonds', () => {
  assert.equal(RESOURCE_POLICY.onChain, false);
  assert.equal(RESOURCE_POLICY.resale, false);
  assert.equal(RESOURCE_POLICY.diamondCashout, false);
  assert.equal(RESOURCE_POLICY.earningsTransfer, false);
});
test('reject mint/import/external wallet/resale and priced gifts on server', () => {
  for (const type of ['mint_nft', 'import_nft', 'export_nft', 'list', 'sell', 'resell', 'transfer_diamonds', 'withdraw_diamonds', 'transfer_earnings']) {
    assert.throws(() => assertResourceAction({ type }, fail), { code: 'RESOURCE_OPERATION_DISABLED' });
  }
  for (const field of ['tokenId', 'chainId', 'transactionHash', 'externalWallet']) assert.throws(() => assertResourceAction({ type: 'gift_elf', [field]: 'supplied' }, fail), { code: 'EXTERNAL_ASSET_UNSUPPORTED' });
  for (const field of ['price', 'amount', 'payment', 'consideration']) assert.throws(() => assertResourceAction({ type: 'gift_elf', [field]: 0 }, fail), { code: 'GIFT_MUST_BE_FREE' });
  assert.doesNotThrow(() => assertResourceAction({ type: 'gift_elf', recipient: 'registered user' }, fail));
});
test('sandbox cannot request or approve real withdrawals, even with an operator', async () => {
  const store = memoryStore();
  const service = createCommerceService({ store, settings: { enabled: true, allowSandbox: true } });
  await assert.rejects(service.requestWithdrawal({ id: 'u_tester' }, { environment: 'Sandbox', requestId: 'sandbox_withdraw_request' }), { code: 'SANDBOX_WITHDRAW_DISABLED' });
  await assert.rejects(service.reviewWithdrawal({ environment: 'Sandbox', action: 'approve', payeeVerified: true }), { code: 'SANDBOX_WITHDRAW_DISABLED' });
});
test('timeout keeps money frozen; signed query can finalize once without a new payout', async () => {
  const store = memoryStore(); const user = { id: 'u_' + 'a'.repeat(32) }; store.addUser(user);
  let payoutCount = 0, outcome = 'unknown';
  const service = createCommerceService({ store, settings: { enabled: true, allowSandbox: true },
    payout: async () => { payoutCount++; throw new Error('timeout after request sent'); },
    payoutQuery: async () => ({ status: outcome, orderId: 'verified-provider-order' }) });
  await store.transaction('Production', async tx => {
    const wallet = await tx.lockWallet(user.id); wallet.availableCents = 2000; await tx.saveWallet(user.id, wallet);
    await tx.put('identity', user.id, { status: 'verified', provider: 'aliyun_id2_ocr' });
    await tx.put('creator_agreement', user.id, { version: '2026-10-26' });
  });
  const { withdrawal } = await service.requestWithdrawal(user, { environment: 'Production', requestId: 'withdraw_request_0001', amountCents: 1000, account: '13800000001' });
  const pending = await service.reviewWithdrawal({ environment: 'Production', withdrawalId: withdrawal.id, action: 'approve', payeeVerified: true });
  assert.equal(pending.withdrawal.status, 'pending_reconciliation');
  assert.equal(store.inspect().wallets.get('Production:' + user.id).availableCents, 1000);
  await service.reconcileWithdrawal({ environment: 'Production', withdrawalId: withdrawal.id });
  assert.equal(store.inspect().wallets.get('Production:' + user.id).availableCents, 1000);
  outcome = 'paid';
  await service.reconcileWithdrawal({ environment: 'Production', withdrawalId: withdrawal.id });
  await service.reconcileWithdrawal({ environment: 'Production', withdrawalId: withdrawal.id });
  assert.equal(payoutCount, 1);
  assert.equal(store.inspect().wallets.get('Production:' + user.id).withdrawnCents, 994);
});
test('transfer parsing requires final status, matching ID, amount on query and order ID', () => {
  const data = { code: '10000', out_biz_no: 'wd_1', status: 'SUCCESS', order_id: 'provider_1', trans_amount: '9.94' };
  const request = { outTradeNo: 'wd_1', amountCents: 994, query: true };
  assert.equal(transferOutcome(data, request).status, 'paid');
  for (const change of [{ status: 'DEALING' }, { status: undefined }, { out_biz_no: 'wrong' }, { trans_amount: '10.00' }, { trans_amount: undefined }, { order_id: null }, { code: '20000' }]) {
    assert.equal(transferOutcome({ ...data, ...change }, request).status, 'unknown');
  }
  assert.equal(transferOutcome({ ...data, status: 'FAIL' }, request).status, 'failed');
});
