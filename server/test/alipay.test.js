'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAlipayService, moneyFen, TIERS } = require('../src/alipay');
const { createAlipayGateway } = require('../src/alipay_gateway');
const { createCommerceService } = require('../src/commerce');
const { memoryStore } = require('./helpers/payment_memory');
const A = { id: 'u_1234567890abcdef1234567890abcdef', nickname: 'A' };
const B = { id: 'u_abcdef1234567890abcdef1234567890', nickname: 'B' };
function fixture(changes = {}) {
  const store = memoryStore(); store.addUser(A); store.addUser(B);
  const settings = { enabled: true, sandbox: false, appId: '2026000000000001', sellerId: '2088000000000001', ...changes };
  let clock = 1000000; let status = 'WAIT_BUYER_PAY'; let notFound = false; let queryError = false;
  let mismatch = {}; let signatures = 0;
  const gateway = {
    signOrder: () => { signatures++; return 'signed-test-order'; },
    verifyNotify: body => body.sign === 'trusted',
    query: async id => {
      if (queryError) throw new Error('query unavailable');
      return notFound ? { notFound: true } : {
        app_id: settings.appId, seller_id: settings.sellerId, out_trade_no: id, total_amount: '6.00',
        trade_no: '20260000000000000001', trade_status: status, ...mismatch,
      };
    },
  };
  const commerceSettings = { enabled: true, sandboxOnly: settings.sandbox, allowSandbox: settings.sandbox };
  const service = createAlipayService({ store, settings, gateway, commerceSettings, now: () => clock });
  const create = (body = {}, user = A) => service.create(user, { tierId: 'diamonds60', requestId: 'test_request_12345678', ...body });
  return { store, service, create, gateway, settings, get signatures() { return signatures; },
    commerce: createCommerceService({ store, settings: commerceSettings }),
    set: value => { if (value.status) status = value.status; if (value.notFound != null) notFound = value.notFound;
      if (value.queryError != null) queryError = value.queryError; if (value.mismatch) mismatch = value.mismatch;
      if (value.clock) clock = value.clock; },
  };
}
test('未配置支付宝默认关闭，不读取占位密钥、不展示商品、不允许下单', async () => {
  assert.equal(createAlipayGateway({ enabled: false }), null);
  const f = fixture({ enabled: false }); assert.deepEqual(f.service.products().products, []);
  await assert.rejects(f.create, { code: 'ALIPAY_DISABLED' });
});
test('六档安卓数量保持10/60/300/680/1280/2980；金额按分精确计算', () => {
  assert.deepEqual(TIERS.map(t => t.diamonds), [10, 60, 300, 680, 1280, 2980]);
  assert.equal(moneyFen('6.00'), 600); assert.equal(moneyFen('0.01'), 1);
  for (const raw of [6, 'NaN', '-1', '1e2', '6.001', '6abc']) assert.throws(() => moneyFen(raw));
});
test('重复创建使用同一订单，价格与钻石只由服务端目录决定', async () => {
  const f = fixture(); const a = await f.create({ priceFen: 1, diamonds: 999999 }); const b = await f.create();
  assert.equal(a.id, b.id); assert.equal(a.priceFen, 600); assert.equal(a.diamonds, 60);
  assert.equal((await f.commerce.snapshot(A, 'Production')).wallet.diamonds, 0);
  await assert.rejects(() => f.create({ tierId: 'diamonds10' }), { code: 'REQUEST_REUSED' });
  await assert.rejects(() => f.create({ requestId: 'another_request_1234' }), { code: 'ALIPAY_PENDING_ORDER' });
});
test('查询或通知失败不发钻；正确支付重复/并发查询只到账一次', async () => {
  const f = fixture(); const order = await f.create();
  f.set({ queryError: true }); await assert.rejects(() => f.service.refresh(A.id, order.id), { statusCode: 503 });
  f.set({ queryError: false, status: 'TRADE_SUCCESS' });
  await Promise.all([f.service.refresh(A.id, order.id), f.service.refresh(A.id, order.id)]);
  const s = await f.commerce.snapshot(A, 'Production'); assert.equal(s.wallet.diamonds, 60); assert.equal(s.wallet.totalRecharged, 60);
});
test('其他账号不能查询或重新唤起别人的订单', async () => {
  const f = fixture(); const order = await f.create();
  await assert.rejects(() => f.service.refresh(B.id, order.id), { code: 'UNKNOWN_ORDER' });
  await assert.rejects(() => f.service.resume(B, order.id), { code: 'UNKNOWN_ORDER' });
});
test('APPID、PID、订单、金额和交易号任何一项不符都不入账', async () => {
  for (const mismatch of [{ app_id: 'wrong' }, { seller_id: 'wrong' }, { out_trade_no: 'wrong' },
    { total_amount: '0.01' }, { trade_no: 'bad' }]) {
    const f = fixture(); const order = await f.create(); f.set({ status: 'TRADE_SUCCESS', mismatch });
    await assert.rejects(() => f.service.refresh(A.id, order.id), { code: 'ALIPAY_ORDER_MISMATCH' });
    assert.equal((await f.commerce.snapshot(A, 'Production')).wallet.diamonds, 0);
  }
});
test('伪造通知或金额篡改不发钻；已验签通知仍查当前交易状态', async () => {
  const f = fixture(); const order = await f.create();
  const data = { out_trade_no: order.id, app_id: f.settings.appId, seller_id: f.settings.sellerId,
    total_amount: '6.00', trade_no: '20260000000000000001', trade_status: 'TRADE_SUCCESS', sign: 'forged' };
  await assert.rejects(() => f.service.notify(data), { code: 'INVALID_NOTIFY_SIGNATURE' });
  await f.service.notify({ ...data, sign: 'trusted' });
  assert.equal((await f.commerce.snapshot(A, 'Production')).wallet.diamonds, 0);
  f.set({ status: 'TRADE_SUCCESS' }); await f.service.notify({ ...data, sign: 'trusted' });
  assert.equal((await f.commerce.snapshot(A, 'Production')).wallet.diamonds, 60);
});
test('真实余额与沙箱余额独立，安卓可使用服务端消费，退款记欠额', async () => {
  const f = fixture({ sandbox: true }); const order = await f.create(); f.set({ status: 'TRADE_SUCCESS' });
  await f.service.refresh(A.id, order.id);
  const act = { environment: 'Sandbox', requestId: 'inject_request_123456', type: 'elf_update', operation: 'inject', amount: 5 };
  await f.commerce.action(A, act);
  f.set({ status: 'TRADE_CLOSED' }); await f.service.refresh(A.id, order.id); await f.service.refresh(A.id, order.id);
  let w = (await f.commerce.snapshot(A, 'Sandbox')).wallet;
  assert.equal(w.diamonds, 0); assert.equal(w.refundDebt, 50); assert.equal(w.totalRecharged, 60);
  const production = createCommerceService({ store: f.store, settings: { enabled: true, sandboxOnly: false, allowSandbox: false } });
  assert.equal((await production.snapshot(A, 'Production')).wallet.refundDebt, 0);
  await assert.rejects(() => f.commerce.action(A, { ...act, requestId: 'inject_request_999999' }), { code: 'REFUND_DEBT' });
});
test('签名下单可重试；未创建的订单到期加缓冲时间后才关闭', async () => {
  const f = fixture(); const order = await f.create(); f.set({ notFound: true });
  assert.equal((await f.service.refresh(A.id, order.id)).order.status, 'pending');
  assert.equal((await f.service.resume(A, order.id)).orderString, 'signed-test-order');
  f.set({ clock: order.expiresAt + 120001 });
  assert.equal((await f.service.refresh(A.id, order.id)).order.status, 'closed');
  assert.equal((await f.service.resume(A, order.id)).orderString, null);
});
test('查询乱序不能把退款或已关闭订单重新发钻', async () => {
  const f = fixture(); const order = await f.create(); f.set({ status: 'TRADE_CLOSED' });
  await f.service.refresh(A.id, order.id); f.set({ status: 'TRADE_SUCCESS' });
  await f.service.refresh(A.id, order.id);
  assert.equal((await f.commerce.snapshot(A, 'Production')).wallet.diamonds, 0);
});
test('部分退款需要人工核对，记录未解决前暂停消费而不猜测退款钻石数', async () => {
  const f = fixture(); const order = await f.create(); f.set({ status: 'TRADE_SUCCESS' });
  await f.service.refresh(A.id, order.id);
  await f.service.notify({ sign: 'trusted', app_id: f.settings.appId, seller_id: f.settings.sellerId,
    out_trade_no: order.id, trade_no: '20260000000000000001', total_amount: '6.00', refund_fee: '1.00' });
  assert.equal((await f.service.pending(A)).orders[0].status, 'review');
  await assert.rejects(() => f.commerce.action(A, { environment: 'Production', requestId: 'review_request_123456',
    type: 'elf_update', operation: 'inject', amount: 1 }), { code: 'PAYMENT_REVIEW' });
});
