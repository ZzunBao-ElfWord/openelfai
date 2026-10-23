'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAppleIapService, parseProducts, validateTransaction, userToken } = require('../src/apple_iap');
const { createCommerceService, MODULES, MODULE_PRICES } = require('../src/commerce');
const { changeBalance } = require('../src/payment_store');
const { memoryStore } = require('./helpers/payment_memory');

const A = { id: 'u_1234567890abcdef1234567890abcdef', nickname: 'A' };
const B = { id: 'u_abcdef1234567890abcdef1234567890', nickname: 'B' };
const sku = 'com.ai.openelf.gems2086';
function fixture(overrides = {}) {
  const store = memoryStore(); store.addUser(A); store.addUser(B);
  const settings = { enabled: true, sandboxOnly: false, allowSandbox: true,
    bundleId: 'com.ai.openelf', productsJson: JSON.stringify({ [sku]: 2086 }), ...overrides };
  let transaction = { transactionId: '2000000001234567', productId: sku, bundleId: settings.bundleId,
    type: 'Consumable', quantity: 1, environment: 'Production', appAccountToken: userToken(A.id),
    purchaseDate: 1000, signedDate: 2000 };
  let notification;
  const iap = createAppleIapService({ paymentStore: store, settings,
    verifyTransaction: async () => ({ ...transaction }), verifyNotification: async () => notification });
  const commerce = createCommerceService({ store, settings });
  let seq = 0;
  return { store, settings, iap, commerce,
    transaction: (changes) => transaction = { ...transaction, ...changes },
    grant: () => iap.verifyAndGrant(A.id, { transactionId: transaction.transactionId, productId: sku }),
    action: (user, type, payload = {}) => commerce.action(user, {
      requestId: 'request_' + String(++seq).padStart(12, '0'), environment: 'Production', type, ...payload }),
    async notify(type, at, changes = {}, environment = 'Production') {
      notification = { environment, transaction: { ...transaction, ...changes, environment },
        payload: { notificationUUID: 'notification-' + at + '-' + type.replaceAll('_', '-'), signedDate: at, notificationType: type } };
      return iap.notification({ signedPayload: 'verified-injected-JWS' }, environment);
    },
  };
}
test('商品目录拒绝负数、小数、原型键和无效 ID；账号绑定稳定', () => {
  assert.deepEqual(parseProducts('{"a.b":7}'), { 'a.b': 7 });
  for (const raw of ['[]', 'null', '{"a":0}', '{"a":1.5}', '{"a":-1}']) assert.throws(() => parseProducts(raw));
  assert.equal(userToken(A.id), '12345678-90ab-cdef-1234-567890abcdef');
  assert.throws(() => userToken('u_me'));
});
test('商品、Bundle ID、类型、数量、账号、环境不匹配均被拒绝', () => {
  const f = fixture(); const t = f.transaction({});
  const expected = { transactionId: t.transactionId, productId: sku, bundleId: t.bundleId, appAccountToken: userToken(A.id) };
  for (const change of [{ productId: 'x' }, { bundleId: 'android' }, { type: 'Auto-Renewable Subscription' },
    { quantity: 2 }, { appAccountToken: userToken(B.id) }, { environment: 'Xcode' }, { revocationDate: 2 }]) {
    assert.throws(() => validateTransaction({ ...t, ...change }, expected));
  }
});
test('重复和并发验单只入账一次，不能转给另一个账号', async () => {
  const f = fixture();
  await Promise.all([f.grant(), f.grant(), f.grant()]);
  assert.equal((await f.iap.wallet(A.id)).diamonds, 2086);
  await assert.rejects(() => f.iap.verifyAndGrant(B.id, { transactionId: f.transaction({}).transactionId, productId: sku }), { code: 'APPLE_ACCOUNT_MISMATCH' });
});
test('沙盒与正式钱包、权益、流水独立；审核沙盒可与正式环境共存', async () => {
  const f = fixture(); f.transaction({ environment: 'Sandbox' }); await f.grant();
  assert.equal((await f.iap.wallet(A.id, 'Sandbox')).diamonds, 2086);
  assert.equal((await f.iap.wallet(A.id, 'Production')).diamonds, 0);
  assert.equal((await f.commerce.snapshot(A, 'Production')).wallet.diamonds, 0);
  await f.action(A, 'elf_update', { environment: 'Sandbox', operation: 'inject', amount: 1 });
  assert.equal((await f.commerce.snapshot(A, 'Sandbox')).wallet.diamonds, 2076);
  assert.equal((await f.commerce.snapshot(A, 'Production')).wallet.diamonds, 0);
});
test('沙盒专用服务拒绝真实交易；关闭时无商品、无消费', async () => {
  const f = fixture({ sandboxOnly: true }); await assert.rejects(f.grant, { code: 'APPLE_ENVIRONMENT_MISMATCH' });
  const disabled = fixture({ enabled: false }); assert.deepEqual(disabled.iap.listProducts(), []);
  await assert.rejects(disabled.grant, { statusCode: 503 });
  await assert.rejects(() => disabled.action(A, 'tip'), { statusCode: 503 });
});
test('退款余额不足记欠额、暂停消费、后续充值先补欠额', async () => {
  const f = fixture(); await f.grant();
  await f.action(A, 'elf_update', { operation: 'inject', amount: 160 });
  await f.notify('REFUND', 3000, { revocationDate: 2900 });
  let w = await f.iap.wallet(A.id); assert.equal(w.diamonds, 0); assert.equal(w.refundDebt, 1600);
  await assert.rejects(() => f.action(A, 'resell', { price: 10 }), { code: 'REFUND_DEBT' });
  f.transaction({ transactionId: '2000000001234568', signedDate: 4000 }); await f.grant();
  w = await f.iap.wallet(A.id); assert.equal(w.refundDebt, 0); assert.equal(w.diamonds, 486);
  assert.equal(w.totalRecharged, 4172);
});
test('重复退款、乱序旧通知不重复扣款；退款撤销恢复但不重复累计充值', async () => {
  const f = fixture(); await f.grant();
  await f.notify('REFUND', 4000, { revocationDate: 3900 });
  await f.notify('REFUND', 4000, { revocationDate: 3900 });
  await f.notify('ONE_TIME_CHARGE', 3000); assert.equal((await f.iap.wallet(A.id)).diamonds, 0);
  await f.notify('REFUND_REVERSED', 5000); let w = await f.iap.wallet(A.id);
  assert.equal(w.diamonds, 2086); assert.equal(w.totalRecharged, 2086);
  await f.notify('REFUND', 4500, { revocationDate: 4400 });
  w = await f.iap.wallet(A.id); assert.equal(w.diamonds, 2086);
});
test('退款通知先于客户端验单时不发钻、不记虚构欠额', async () => {
  const f = fixture(); await f.notify('REFUND', 4000, { revocationDate: 3900 });
  await f.grant(); const w = await f.iap.wallet(A.id);
  assert.equal(w.diamonds, 0); assert.equal(w.refundDebt, 0); assert.equal(w.totalRecharged, 0);
});
test('旧沙盒订单迁移不会重复发钻，退款仍能扣回', async () => {
  const f = fixture(); const t = f.transaction({ environment: 'Sandbox' });
  f.store.seedLegacy('Sandbox', { transaction_id: t.transactionId, user_id: A.id, product_id: sku, diamonds: 2086 }, 2086);
  await f.grant(); assert.equal((await f.iap.wallet(A.id, 'Sandbox')).diamonds, 2086);
  await f.notify('REFUND', 4000, { revocationDate: 3900 }, 'Sandbox');
  assert.equal((await f.iap.wallet(A.id, 'Sandbox')).diamonds, 0);
});
test('通知签名不通过或通知端点环境不符不会入账', async () => {
  const f = fixture();
  await assert.rejects(() => f.iap.notification({ signedPayload: '' }, 'Sandbox'), { statusCode: 400 });
  await f.notify('TEST', 3000);
  await assert.rejects(() => f.iap.notification({ signedPayload: 'x' }, 'Sandbox'), { statusCode: 400 });
  assert.equal((await f.iap.wallet(A.id)).diamonds, 0);
});
test('注算力按10钻石/点扣款，溢出、负数和重复请求不会多扣', async () => {
  const f = fixture(); await f.grant();
  const body = { operation: 'inject', amount: 10, requestId: 'same_request_123456' };
  await f.action(A, 'elf_update', body); await f.action(A, 'elf_update', body);
  let s = await f.commerce.snapshot(A, 'Production'); assert.equal(s.wallet.diamonds, 1986);
  assert.equal(s.commerce.elves.find(e => e.isMine).energy, 170);
  await assert.rejects(() => f.action(A, 'elf_update', { operation: 'inject', amount: 151 }), { code: 'ENERGY_OVERFLOW' });
  await assert.rejects(() => f.action(A, 'elf_update', { operation: 'inject', amount: -1 }), { statusCode: 400 });
  await assert.rejects(() => f.action(A, 'elf_update', { ...body, amount: 11 }), { code: 'REQUEST_REUSED' });
  assert.equal((await f.iap.wallet(A.id)).diamonds, 1986);
});
test('能力包须购买后装配；重复购买不再扣费，接口不足事务回滚', async () => {
  const f = fixture(); await f.grant();
  await assert.rejects(() => f.action(A, 'elf_update', { operation: 'equip', moduleId: 'video' }), { code: 'MODULE_NOT_OWNED' });
  await f.action(A, 'buy_module', { moduleId: 'video', price: 0 });
  await f.action(A, 'buy_module', { moduleId: 'video' });
  assert.equal((await f.iap.wallet(A.id)).diamonds, 2086 - MODULE_PRICES.video);
  await assert.rejects(() => f.action(A, 'elf_update', { operation: 'equip', moduleId: 'video' }), { code: 'NO_SLOTS' });
  const s = await f.commerce.snapshot(A, 'Production'); assert.deepEqual(s.commerce.elves.find(e => e.isMine).equipped, ['sharp', 'rhythm']);
});
test('手动创作按已装能力扣算力，不直接扣钻；不能冒用能力或AI', async () => {
  const f = fixture(); await f.grant();
  await f.action(A, 'elf_update', { operation: 'publish', moduleId: 'sharp', body: '示例内容' });
  const s = await f.commerce.snapshot(A, 'Production'); assert.equal(s.wallet.diamonds, 2086);
  assert.equal(s.commerce.elves.find(e => e.isMine).energy, 160 - MODULES.sharp[1]);
  await assert.rejects(() => f.action(A, 'elf_update', { operation: 'publish', moduleId: 'video', body: 'x' }), { code: 'MODULE_NOT_EQUIPPED' });
  await assert.rejects(() => f.action(A, 'elf_update', { operation: 'inject', amount: 1, elfId: 'someone_else' }), { code: 'OWNERSHIP_CHANGED' });
});
test('自动创作必须装中枢、到时间才执行，并由服务器推进下次时间', async () => {
  const f = fixture(); await f.grant(); await f.action(A, 'buy_module', { moduleId: 'auto' });
  await f.action(A, 'elf_update', { operation: 'equip', moduleId: 'auto' });
  const payload = { operation: 'auto_publish', moduleId: 'rhythm', body: '自动示例内容' };
  await assert.rejects(() => f.action(A, 'elf_update', payload), { code: 'AUTO_NOT_DUE' });
  const s = await f.commerce.snapshot(A, 'Production'); const elf = s.commerce.elves.find(e => e.isMine);
  await f.store.transaction('Production', tx => tx.put('elf', elf.id, { ...elf, nextAutoPostAt: 1 }, { owner: A.id }));
  await f.action(A, 'elf_update', payload);
  await assert.rejects(() => f.action(A, 'elf_update', payload), { code: 'AUTO_NOT_DUE' });
  assert.equal((await f.commerce.snapshot(A, 'Production')).commerce.elves.find(e => e.isMine).energy, 158);
});
test('打赏只扣买家钻石，真实创作者记收益；自己、假AI、帖子不匹配不允许', async () => {
  const f = fixture(); await f.grant(); const b = await f.commerce.snapshot(B, 'Production');
  const elf = b.commerce.elves.find(e => e.isMine);
  await f.action(A, 'tip', { elfId: elf.id, amount: 10 });
  assert.equal((await f.iap.wallet(A.id)).diamonds, 2076);
  const w = await f.iap.wallet(B.id); assert.equal(w.diamonds, 0); assert.equal(w.earningsFen, 50);
  await assert.rejects(() => f.action(B, 'tip', { elfId: elf.id, amount: 10 }), { code: 'SELF_TIP' });
  await assert.rejects(() => f.action(A, 'tip', { elfId: 'seed', amount: 10 }));
  await assert.rejects(() => f.action(A, 'tip', { elfId: elf.id, postId: 'fake', amount: 10 }), { code: 'INVALID_POST' });
});
test('寄售购买转移唯一权益及能力包；重复购买、撤回失败不多扣钱', async () => {
  const f = fixture(); await f.grant();
  await f.commerce.snapshot(B, 'Production');
  await f.action(A, 'resell', { price: 10 });
  await f.action(B, 'resell', { price: 100 });
  let s = await f.commerce.snapshot(A, 'Production'); const listing = s.commerce.secondary.find(l => l.sellerId === B.id);
  await f.action(A, 'buy', { listingId: listing.id, price: 0 });
  s = await f.commerce.snapshot(A, 'Production'); assert.equal(s.wallet.diamonds, 1986);
  assert.equal(s.commerce.elves.find(e => e.isMine).id, listing.elfId);
  assert.equal((await f.iap.wallet(B.id)).earningsFen, 500);
  await assert.rejects(() => f.action(A, 'buy', { listingId: listing.id }));
  await assert.rejects(() => f.action(B, 'cancel_resell', { listingId: listing.id }));
});
test('官方购买使用服务器价格且只能持有一只AI', async () => {
  const f = fixture(); await f.grant(); await f.action(A, 'resell', { price: 10 });
  await f.action(A, 'buy', { listingId: 'pm_001', price: 1 });
  assert.equal((await f.iap.wallet(A.id)).diamonds, 806);
  await assert.rejects(() => f.action(A, 'buy', { listingId: 'pm_001' }), { code: 'ALREADY_OWNS_ELF' });
});
test('任何消费失败整体回滚，不会留下负数余额', async () => {
  const f = fixture(); await f.commerce.snapshot(A, 'Production');
  await assert.rejects(() => f.action(A, 'elf_update', { operation: 'inject', amount: 1 }), { code: 'INSUFFICIENT_BALANCE' });
  const s = await f.commerce.snapshot(A, 'Production'); assert.equal(s.wallet.diamonds, 0);
  assert.equal(s.commerce.elves.find(e => e.isMine).energy, 160);
});
