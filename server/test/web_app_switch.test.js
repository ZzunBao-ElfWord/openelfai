'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const Fastify = require('fastify');
const { makeDb } = require('./helpers/web_topup_memory');
const { memoryStore } = require('./helpers/payment_memory');
const { createTopupService } = require('../src/platform/web_topup_service');
const { createWebDiamondServices, registerWebDiamonds } = require('../src/platform/web_diamonds');
const { registerWebTopup } = require('../src/platform/web_topup');
const { webSettings, legacySettings, NEW_APP_ID: NEW, OLD_APP_ID: OLD } = require('../src/platform/web_apps');
const PID = '2088000000000001', USER = { id: 'u_' + 'a'.repeat(32), status: 'active' }, OTHER = { id: 'u_' + 'b'.repeat(32), status: 'active' };
const settings = appId => ({ enabled: true, sandbox: false, appId, sellerId: PID });
function gateway(appId) {
  const queries = [], pages = []; let paid = false;
  return { queries, pages, setPaid() { paid = true; },
    pagePay(order) { pages.push(order.id); return 'https://openapi.alipay.com/gateway.do?app_id=' + appId; },
    verifyNotify(data) { return data.sign === appId; },
    async query(id) { queries.push(id); return { app_id: appId, seller_id: PID, out_trade_no: id, total_amount: id.startsWith('OE') ? '1.00' : '10.00',
      trade_no: appId === OLD ? '202600000000000001' : '202600000000000002', trade_status: paid ? 'TRADE_SUCCESS' : 'WAIT_BUYER_PAY' }; }
  };
}
const service = (db, appId, gw) => createTopupService({ db, settings: settings(appId), gateway: gw, notifyUrl: 'https://web.openelfai.com/api/v1/platform/web-alipay/notify' });
test('新应用默认关闭、只认新APPID；旧应用独立参数不借用安卓或新公钥', () => {
  assert.equal(webSettings({}).enabled, false); assert.equal(webSettings({}).appId, NEW);
  assert.throws(() => webSettings({ ALIPAY_WEB_APP_ID: OLD }), /不一致/);
  assert.equal(legacySettings({ ALIPAY_PRIVATE_KEY_PATH: 'android', ALIPAY_WEB_PRIVATE_KEY_PATH: 'new' }).privateKeyPath, '');
});
test('3笔旧平台订单不阻塞新应用订单；每个应用内部幂等、跨应用请求编号不能混用', async () => {
  const db = makeDb(), old = service(db, OLD, gateway(OLD)), current = service(db, NEW, gateway(NEW));
  const first = await old.create(USER, { requestId: 'old_request_000001', tierId: 'topup10', channel: 'web' });
  const second = await current.create(USER, { requestId: 'new_request_000001', tierId: 'topup10', channel: 'web' });
  assert.notEqual(first.id, second.id); assert.equal(db.state.orders[1].app_id, NEW);
  assert.equal((await current.create(USER, { requestId: 'new_request_000001', tierId: 'topup10', channel: 'web' })).id, second.id);
  await assert.rejects(current.create(USER, { requestId: 'old_request_000001', tierId: 'topup10', channel: 'web' }), { code: 'REQUEST_APP_MISMATCH' });
});
test('旧平台回调仍用旧验签及查单，新旧订单均只到账一次，共用原平台余额账本', async () => {
  const db = makeDb(), oldGateway = gateway(OLD), newGateway = gateway(NEW);
  const old = service(db, OLD, oldGateway), current = service(db, NEW, newGateway);
  const a = await old.create(USER, { requestId: 'old_request_000001', tierId: 'topup10', channel: 'web' });
  const b = await current.create(USER, { requestId: 'new_request_000001', tierId: 'topup10', channel: 'web' });
  oldGateway.setPaid(); newGateway.setPaid();
  const notify = (id, appId) => ({ out_trade_no: id, app_id: appId, seller_id: PID, total_amount: '10.00', trade_no: appId === OLD ? '202600000000000001' : '202600000000000002', trade_status: 'TRADE_SUCCESS', sign: appId });
  await old.notify(notify(a.id, OLD)); await old.notify(notify(a.id, OLD)); await current.notify(notify(b.id, NEW));
  assert.equal(db.state.wallets.get(USER.id).balance_micro, 20000000); assert.equal(db.state.ledger.length, 2);
  await assert.rejects(current.refresh(USER.id, a.id), { code: 'UNKNOWN_ORDER' });
  assert(!newGateway.queries.includes(a.id));
});
test('旧钻石与新钻石订单分命名空间，不改旧订单、新订单不被旧pending阻塞；共享钱包且正确验签', async () => {
  const store = memoryStore(); store.addUser(USER); const oldGateway = gateway(OLD), newGateway = gateway(NEW);
  const old = createWebDiamondServices({ store, settings: settings(OLD), gateway: oldGateway, prefix: 'web_' });
  const current = createWebDiamondServices({ store, settings: settings(NEW), gateway: newGateway });
  const a = await old.payment.create(USER, { requestId: 'old_diamond_request_1', tierId: 'diamonds10' });
  const b = await current.payment.create(USER, { requestId: 'new_diamond_request_1', tierId: 'diamonds10' });
  assert.notEqual(a.id, b.id); oldGateway.setPaid(); newGateway.setPaid();
  const notify = (id, appId) => ({ out_trade_no: id, app_id: appId, seller_id: PID, total_amount: '1.00', trade_no: appId === OLD ? '202600000000000001' : '202600000000000002', trade_status: 'TRADE_SUCCESS', sign: appId });
  await assert.rejects(current.payment.notify(notify(a.id, OLD)), { code: 'INVALID_NOTIFY_SIGNATURE' });
  await old.payment.notify(notify(a.id, OLD)); await old.payment.notify(notify(a.id, OLD)); await current.payment.notify(notify(b.id, NEW));
  assert.equal((await store.transaction('Production', tx => tx.lockWallet(USER.id))).diamonds, 20);
  assert(await store.transaction('Production', tx => tx.get('web_alipay_order', a.id)));
  assert(await store.transaction('Production', tx => tx.get('web2_alipay_order', b.id)));
});
test('HTTP旧平台订单按已存APPID分流查单，不允许继续付款或越权；关闭新收款不关闭旧回调', async t => {
  const db = makeDb(), oldGateway = gateway(OLD), currentGateway = gateway(NEW);
  const old = service(db, OLD, oldGateway); const a = await old.create(USER, { requestId: 'old_request_000001', tierId: 'topup10', channel: 'web' });
  const app = Fastify(); t.after(() => app.close());
  registerWebTopup(app, { db, settings: { ...settings(NEW), enabled: false }, gateway: null,
    legacy: { settings: settings(OLD), gateway: oldGateway },
    authenticate: async request => { if (!request.headers.authorization) throw Object.assign(Error('login'), { statusCode: 401 }); return { user: request.headers.authorization === 'owner' ? USER : OTHER }; } });
  assert.equal((await app.inject({ url: '/api/v1/platform/web-topup/orders/' + a.id })).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/v1/platform/web-topup/orders/' + a.id, headers: { authorization: 'other' } })).statusCode, 404);
  assert.equal((await app.inject({ url: '/api/v1/platform/web-topup/orders/' + a.id, headers: { authorization: 'owner' } })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/platform/web-topup/orders/' + a.id + '/pay', headers: { authorization: 'owner' }, payload: {} })).statusCode, 409);
  assert.equal(currentGateway.queries.length, 0);
});
test('HTTP旧钻石查单与回调按旧应用分流，不能拿新应用签名伪造旧单，不允许旧单续付', async t => {
  const store = memoryStore(); store.addUser(USER); store.addUser(OTHER);
  const oldGateway = gateway(OLD), newGateway = gateway(NEW);
  const old = createWebDiamondServices({ store, settings: settings(OLD), gateway: oldGateway, prefix: 'web_' });
  const order = await old.payment.create(USER, { requestId: 'old_diamond_request_1', tierId: 'diamonds10' });
  const app = Fastify(); t.after(() => app.close());
  registerWebDiamonds(app, { store, settings: settings(NEW), gateway: newGateway, legacy: { settings: settings(OLD), gateway: oldGateway },
    authenticate: async request => { if (!request.headers.authorization) throw Object.assign(Error('login'), { statusCode: 401 }); return { user: request.headers.authorization === 'owner' ? USER : OTHER }; } });
  assert.equal((await app.inject({ url: '/api/v1/web/alipay/orders/' + order.id, headers: { authorization: 'owner' } })).statusCode, 200);
  assert.equal((await app.inject({ url: '/api/v1/web/alipay/orders/' + order.id, headers: { authorization: 'other' } })).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/web/alipay/orders/' + order.id + '/pay', headers: { authorization: 'owner' }, payload: {} })).statusCode, 409);
  assert.equal((await app.inject({ url: '/api/v1/web/alipay/legacy-orders', headers: { authorization: 'owner' } })).json().orders.length, 1);
  const callback = { out_trade_no: order.id, app_id: OLD, seller_id: PID, total_amount: '1.00', trade_no: '202600000000000001', trade_status: 'TRADE_SUCCESS', sign: NEW };
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/web/alipay/notify', payload: callback })).statusCode, 400);
  oldGateway.setPaid(); callback.sign = OLD;
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/web/alipay/notify', payload: callback })).statusCode, 200);
  assert.equal((await store.transaction('Production', tx => tx.lockWallet(USER.id))).diamonds, 10);
});
