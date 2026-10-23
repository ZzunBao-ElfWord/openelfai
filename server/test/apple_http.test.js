'use strict';
// All dependencies on Apple, SMS, and MySQL are injected. No network or DB writes.
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.NODE_ENV = 'test';
for (const name of ['DB_PASSWORD', 'JWT_SECRET', 'SMS_CODE_PEPPER', 'REFRESH_TOKEN_PEPPER']) process.env[name] = 'isolated-test-secret-not-for-deployment';
process.env.APPLE_IAP_ENABLED = 'true';
process.env.APPLE_IAP_SANDBOX_ONLY = 'false';
process.env.APPLE_IAP_ALLOW_SANDBOX = 'true';
process.env.APPLE_IAP_BUNDLE_ID = 'com.ai.openelf';
process.env.APPLE_IAP_PRODUCTS_JSON = '{"com.ai.openelf.gems42":42}';
const buildApp = require('../src/app');
const config = require('../src/config');
const { signAccessToken } = require('../src/security');
const { userToken } = require('../src/apple_iap');
const { memoryStore } = require('./helpers/payment_memory');
const user = { id: 'u_1234567890abcdef1234567890abcdef', nickname: 'test', status: 'active' };

test('HTTP：鉴权、商品、验单、消费、重复请求和退款通知贯通', async () => {
  const store = memoryStore(); store.addUser(user);
  const token = signAccessToken({ secret: config.jwtSecret, userId: user.id, sessionId: 'test-session', ttlSec: 900 });
  const headers = { authorization: 'Bearer ' + token };
  const transaction = { transactionId: '2000000001234567', productId: 'com.ai.openelf.gems42',
    bundleId: 'com.ai.openelf', type: 'Consumable', quantity: 1,
    environment: 'Production', appAccountToken: userToken(user.id), signedDate: 1000 };
  const db = { async execute(sql) {
    if (sql === 'SELECT * FROM refresh_sessions WHERE id = ?') return [[{ user_id: user.id, expires_at: Date.now() + 60000 }]];
    if (sql === 'SELECT * FROM users WHERE id = ?') return [[user]];
    throw new Error('Unexpected SQL in HTTP test');
  } };
  const app = await buildApp({ db, paymentStore: store, sms: {}, captcha: {}, logger: false,
    appleVerifier: async () => transaction,
    appleNotificationVerifier: async (payload) => {
      if (payload !== 'trusted-test-token') throw new Error('invalid signature');
      return { environment: 'Production', payload: { notificationUUID: '12345678-1234-1234-1234-123456789012',
        signedDate: 2000, notificationType: 'REFUND' }, transaction: { ...transaction, revocationDate: 1900 } };
    },
  });
  try {
    assert.equal((await app.inject('/api/v1/wallet')).statusCode, 401);
    let r = await app.inject({ url: '/api/v1/ios/products?environment=Production', headers });
    assert.equal(r.statusCode, 200); assert.equal(r.json().protocol, 2); assert.equal(r.json().products[0].diamonds, 42);
    r = await app.inject({ method: 'POST', url: '/api/v1/ios/verify', headers,
      payload: { productId: transaction.productId, transactionId: transaction.transactionId } });
    assert.equal(r.statusCode, 200); assert.equal(r.json().wallet.diamonds, 42);
    const action = { type: 'elf_update', operation: 'inject', amount: 2, environment: 'Production', requestId: 'http_request_12345678' };
    for (let i = 0; i < 2; i++) {
      r = await app.inject({ method: 'POST', url: '/api/v1/commerce/actions', headers, payload: action });
      assert.equal(r.statusCode, 200); assert.equal(r.json().wallet.diamonds, 22);
      assert.equal(r.json().commerce.elves.find(e => e.isMine).energy, 162);
    }
    r = await app.inject({ method: 'POST', url: '/api/v1/ios/notifications/production', payload: { signedPayload: 'forged' } });
    assert.equal(r.statusCode, 400);
    r = await app.inject({ method: 'POST', url: '/api/v1/ios/notifications/production', payload: { signedPayload: 'trusted-test-token' } });
    assert.equal(r.statusCode, 200);
    r = await app.inject({ url: '/api/v1/wallet?environment=Production', headers });
    assert.equal(r.json().wallet.refundDebt, 20); assert.equal(r.json().wallet.diamonds, 0);
    r = await app.inject({ method: 'POST', url: '/api/v1/commerce/actions', headers,
      payload: { ...action, requestId: 'http_request_12345679' } });
    assert.equal(r.statusCode, 409); assert.equal(r.json().error.code, 'REFUND_DEBT');
  } finally { await app.close(); }
});

test('HTTP：安卓独立钱包、支付宝占位关闭、表单验签、服务端发钻与消费', async () => {
  const previous = { android: { ...config.androidCommerce }, alipay: { ...config.alipay }, apple: { ...config.appleIap } };
  config.androidCommerce.enabled = true; config.androidCommerce.sandboxOnly = false; config.androidCommerce.allowSandbox = false;
  config.appleIap.enabled = false; config.appleIap.sandboxOnly = true;
  config.alipay.enabled = false; config.alipay.sandbox = false;
  config.alipay.appId = '2026000000000001'; config.alipay.sellerId = '2088000000000001';
  const store = memoryStore(); store.addUser(user);
  const headers = { authorization: 'Bearer ' + signAccessToken({ secret: config.jwtSecret, userId: user.id, sessionId: 'session-android', ttlSec: 900 }) };
  const db = { async execute(sql) {
    if (sql.includes('refresh_sessions')) return [[{ user_id: user.id, expires_at: Date.now() + 60000 }]];
    if (sql.includes('FROM users')) return [[user]];
    throw new Error('Unexpected SQL');
  } };
  const gateway = { signOrder: () => 'test-signed-order', verifyNotify: data => data.sign === 'trusted',
    query: async id => ({ app_id: config.alipay.appId, seller_id: config.alipay.sellerId,
      out_trade_no: id, total_amount: '6.00', trade_status: 'TRADE_SUCCESS', trade_no: '20260000000000000001' }) };
  let app;
  try {
    app = await buildApp({ db, paymentStore: store, sms: {}, captcha: {}, logger: false, alipayGateway: gateway });
    let response = await app.inject({ url: '/api/v1/android/alipay/products', headers });
    assert.deepEqual(response.json().products, []);
    response = await app.inject({ url: '/api/v1/android/wallet?environment=production', headers });
    assert.equal(response.statusCode, 200); assert.equal(response.json().wallet.diamonds, 0);
    assert.equal(response.json().mode, 'production');
    response = await app.inject({ method: 'POST', url: '/api/v1/android/alipay/orders', headers, payload: { tierId: 'diamonds60', requestId: 'http_android_12345678' } });
    assert.equal(response.statusCode, 503);
    config.alipay.enabled = true;
    response = await app.inject({ method: 'POST', url: '/api/v1/android/alipay/orders', headers, payload: { tierId: 'diamonds60', requestId: 'http_android_12345678' } });
    assert.equal(response.statusCode, 200); const id = response.json().id;
    const form = new URLSearchParams({ app_id: config.alipay.appId, seller_id: config.alipay.sellerId,
      out_trade_no: id, total_amount: '6.00', trade_no: '20260000000000000001', sign: 'trusted' }).toString();
    response = await app.inject({ method: 'POST', url: '/api/v1/android/alipay/notify', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: form });
    assert.equal(response.statusCode, 200); assert.equal(response.body, 'success');
    response = await app.inject({ method: 'POST', url: '/api/v1/android/alipay/notify', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: form + '&sign=forged' });
    assert.equal(response.statusCode, 400);
    response = await app.inject({ method: 'POST', url: '/api/v1/android/commerce/actions', headers,
      payload: { type: 'elf_update', operation: 'inject', amount: 2, environment: 'production', requestId: 'http_android_use_12345' } });
    assert.equal(response.statusCode, 200); assert.equal(response.json().wallet.diamonds, 40);
    assert.equal(response.json().commerce.elves.find(e => e.isMine).energy, 162);
  } finally {
    if (app) await app.close();
    Object.assign(config.androidCommerce, previous.android); Object.assign(config.alipay, previous.alipay); Object.assign(config.appleIap, previous.apple);
  }
});
