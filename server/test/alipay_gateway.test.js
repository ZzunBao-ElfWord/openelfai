'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { AlipaySdk } = require('alipay-sdk');
const { createAlipayGateway } = require('../src/alipay_gateway');
test('官方SDK实际RSA2下单签名和通知验签，无商户私钥、无网络', async t => {
  const merchant = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const alipay = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const read = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', (file, ...args) => file === '/test/private.pem'
    ? merchant.privateKey.export({ type: 'pkcs8', format: 'pem' })
    : file === '/test/public.pem' ? alipay.publicKey.export({ type: 'spki', format: 'pem' }) : read(file, ...args));
  const gateway = createAlipayGateway({ enabled: true, sandbox: true, appId: '2026000000000001', sellerId: '2088000000000001',
    privateKeyPath: '/test/private.pem', publicKeyPath: '/test/public.pem', keyMode: 'public',
    notifyUrl: 'https://openelfai.com/api/v1/android/alipay/notify' });
  const order = { id: 'OE1234567890abcdef1234567890abcdef', priceFen: 600, diamonds: 60, expiresAt: 1800000000000 };
  const params = new URLSearchParams(gateway.signOrder(order));
  const canonical = [...params.entries()].filter(([key]) => key !== 'sign').sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('&');
  assert.equal(crypto.verify('RSA-SHA256', Buffer.from(canonical), merchant.publicKey, Buffer.from(params.get('sign'), 'base64')), true);
  assert.equal(JSON.parse(params.get('biz_content')).product_code, 'QUICK_MSECURITY_PAY');
  const notify = { app_id: '2026000000000001', seller_id: '2088000000000001', out_trade_no: order.id,
    total_amount: '6.00', trade_no: '20260000000000000001', subject: '测试+支付', sign_type: 'RSA2' };
  const message = Object.entries(notify).filter(([key]) => key !== 'sign_type').sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('&');
  notify.sign = crypto.sign('RSA-SHA256', Buffer.from(message), alipay.privateKey).toString('base64');
  assert.equal(gateway.verifyNotify(notify), true);
  assert.equal(gateway.verifyNotify({ ...notify, total_amount: '0.01' }), false);
  t.mock.method(AlipaySdk.prototype, 'exec', async (method, params, options) => {
    assert.equal(method, 'alipay.trade.query'); assert.equal(options.validateSign, true);
    assert.equal(params.bizContent.out_trade_no, order.id);
    return { code: '10000', out_trade_no: order.id, total_amount: '6.00', trade_status: 'TRADE_SUCCESS', trade_no: notify.trade_no };
  });
  assert.equal((await gateway.query(order.id)).seller_id, notify.seller_id);
});
