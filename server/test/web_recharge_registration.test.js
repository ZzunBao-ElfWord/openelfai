'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.NODE_ENV = 'test';
for (const key of ['DB_PASSWORD', 'JWT_SECRET', 'SMS_CODE_PEPPER', 'REFRESH_TOKEN_PEPPER']) {
  process.env[key] = 'isolated-web-regression-fixture-secret';
}
process.env.APPLE_IAP_ENABLED = 'false';
process.env.ALIPAY_ENABLED = 'false';
const buildApp = require('../src/app');
const config = require('../src/config');
const { signAccessToken } = require('../src/security');
const { memoryStore } = require('./helpers/payment_memory');
const { NEW_APP_ID } = require('../src/platform/web_apps');

const user = { id: 'u_' + 'a'.repeat(32), nickname: 'fixture', status: 'active' };
const seller = '2088000000000001';

test('完整入口注册网页支付，匿名401、错误回调400，不访问DB或支付网关', async t => {
  const store = memoryStore(); store.addUser(user);
  let queries = 0;
  const app = await buildApp({ logger: false,
    db: { execute: async () => { queries++; throw Error('Unexpected database call'); } },
    paymentStore: store, sms: {}, captcha: {}, realname: {},
    webTopupSettings: { enabled: false, sandbox: false, appId: NEW_APP_ID, sellerId: seller },
    webPaymentGateway: null, webLegacy: null });
  t.after(() => app.close());
  for (const url of ['/api/v1/platform/web-topup/products', '/api/v1/web/alipay/products',
    '/api/v1/web/alipay/pending', '/api/v1/web/alipay/legacy-orders', '/api/v1/web/wallet',
    '/api/v1/web/commerce/feed', '/api/v1/web/commerce/chat']) {
    assert.equal((await app.inject({ url })).statusCode, 401, url);
  }
  for (const url of ['/api/v1/platform/web-topup/orders', '/api/v1/web/alipay/orders',
    '/api/v1/web/commerce/actions']) {
    assert.equal((await app.inject({ method: 'POST', url, payload: {} })).statusCode, 401, url);
  }
  for (const url of ['/api/v1/platform/web-alipay/notify', '/api/v1/web/alipay/notify']) {
    const response = await app.inject({ method: 'POST', url, payload: {} });
    assert.equal(response.statusCode, 400);
    assert.equal(response.body, 'failure');
  }
  assert.equal(queries, 0);
  assert.equal(store.inspect().objects.size, 0);
});

test('网页恢复复用共享安全账本，模拟付款只入钻石一次并保留下架过滤', async t => {
  const store = memoryStore(); store.addUser(user);
  const token = signAccessToken({ secret: config.jwtSecret, userId: user.id, sessionId: 'web-test-session', ttlSec: 900 });
  const headers = { authorization: 'Bearer ' + token };
  const calls = [];
  const db = { async execute(sql) {
    calls.push(sql);
    if (sql.includes('FROM compliance_blocks')) return [[]];
    if (sql === 'SELECT * FROM refresh_sessions WHERE id = ?') return [[{ user_id: user.id, expires_at: Date.now() + 60000 }]];
    if (sql === 'SELECT * FROM users WHERE id = ?') return [[user]];
    throw Error('Unexpected SQL: no real database or platform balance writes allowed');
  } };
  let currentOrder;
  const gateway = {
    pagePay(order) { currentOrder = order; return 'https://openapi.alipay.com/gateway.do?fixture=true'; },
    verifyNotify(body) { return body.sign === 'fixture-signature'; },
    async query(id) { return { app_id: NEW_APP_ID, seller_id: seller, out_trade_no: id,
      total_amount: '1.00', trade_no: '202610300000000001', trade_status: 'TRADE_SUCCESS' }; }
  };
  const app = await buildApp({ db, paymentStore: store, sms: {}, captcha: {}, realname: {}, logger: false,
    webTopupSettings: { enabled: true, sandbox: false, appId: NEW_APP_ID, sellerId: seller },
    webPaymentGateway: gateway, webLegacy: null });
  t.after(() => app.close());
  const products = await app.inject({ url: '/api/v1/web/alipay/products', headers });
  assert.equal(products.statusCode, 200);
  const created = await app.inject({ method: 'POST', url: '/api/v1/web/alipay/orders', headers,
    payload: { tierId: 'diamonds10', requestId: 'fixture_web_request_0001' } });
  assert.equal(created.statusCode, 200);
  assert.ok(created.json().payUrl.startsWith('https://openapi.alipay.com/'));
  assert.equal(created.json().orderString, undefined);
  const notify = { app_id: NEW_APP_ID, seller_id: seller, out_trade_no: created.json().id,
    total_amount: '1.00', trade_no: '202610300000000001', trade_status: 'TRADE_SUCCESS', sign: 'fixture-signature' };
  assert.equal(currentOrder.id, notify.out_trade_no);
  for (let i = 0; i < 2; i++) {
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/web/alipay/notify', payload: notify })).statusCode, 200);
  }
  assert.equal((await store.transaction('Production', tx => tx.lockWallet(user.id))).diamonds, 10);
  await store.transaction('Production', async tx => {
    await tx.put('elf', 'fixture_hidden_elf', { id: 'fixture_hidden_elf', ownerId: 'other_user', name: 'hidden',
      status: 'owned', moderationStatus: 'hidden' }, { owner: 'other_user' });
    await tx.put('post', 'fixture_hidden_post', { id: 'fixture_hidden_post', elfId: 'fixture_hidden_elf',
      body: 'must remain hidden', createdAt: new Date().toISOString() }, { owner: 'other_user' });
  });
  const feed = await app.inject({ url: '/api/v1/web/commerce/feed', headers });
  assert.equal(feed.statusCode, 200);
  assert.ok(!feed.json().posts.some(post => post.id === 'fixture_hidden_post'));
  assert.ok(!calls.some(sql => /INSERT|UPDATE|DELETE/.test(sql)));
});
