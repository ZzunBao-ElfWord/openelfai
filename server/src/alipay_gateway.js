'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');

function shanghaiTime(ms) {
  return new Date(ms + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
}
function createAlipayGateway(settings) {
  if (!settings.enabled) return null;
  if (!/^\d{16}$/.test(settings.appId) || !/^2088\d{12}$/.test(settings.sellerId)) throw new Error('支付宝 APPID/PID 未正确配置');
  const url = new URL(settings.notifyUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('支付宝通知地址必须是无凭据的 HTTPS 地址');
  const privateKey = fs.readFileSync(settings.privateKeyPath, 'utf8');
  const key = crypto.createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 2048) throw new Error('支付宝需要 RSA2 私钥');
  const options = { appId: settings.appId, privateKey, keyType: privateKey.includes('BEGIN RSA PRIVATE') ? 'PKCS1' : 'PKCS8',
    signType: 'RSA2', camelcase: false, timeout: 10000,
    gateway: settings.sandbox ? 'https://openapi-sandbox.dl.alipaydev.com/gateway.do' : 'https://openapi.alipay.com/gateway.do' };
  if (settings.keyMode === 'certificate') {
    for (const field of ['appCertPath', 'alipayPublicCertPath', 'alipayRootCertPath']) {
      if (!settings[field]) throw new Error('支付宝证书模式配置不完整');
      fs.accessSync(settings[field], fs.constants.R_OK); options[field] = settings[field];
    }
  } else if (settings.keyMode === 'public') {
    options.alipayPublicKey = fs.readFileSync(settings.publicKeyPath, 'utf8');
    crypto.createPublicKey(options.alipayPublicKey);
  } else throw new Error('支付宝密钥模式无效');
  const { AlipaySdk } = require('alipay-sdk');
  const sdk = new AlipaySdk(options);
  // SDK can otherwise skip response verification when no public key was loaded.
  if (!sdk.config.alipayPublicKey) throw new Error('支付宝验签公钥未加载，禁止启用支付');
  crypto.createPublicKey(sdk.config.alipayPublicKey);
  return {
    signOrder(order) {
      return sdk.sdkExecute('alipay.trade.app.pay', { notifyUrl: settings.notifyUrl, timestamp: shanghaiTime(Date.now()),
        bizContent: { out_trade_no: order.id, product_code: 'QUICK_MSECURITY_PAY', seller_id: settings.sellerId,
          total_amount: (order.priceFen / 100).toFixed(2), subject: `OpenElf ${order.diamonds}钻石`,
          time_expire: shanghaiTime(order.expiresAt) } });
    },
    verifyNotify(data) { return data.sign_type === 'RSA2' && sdk.checkNotifySignV2(data); },
    async query(id) {
      // V2 is used deliberately for APP-pay's established trade query contract.
      // Explicit response verification is mandatory; no unverified SDK result is trusted.
      const data = await sdk.exec('alipay.trade.query', { timestamp: shanghaiTime(Date.now()), bizContent: { out_trade_no: id } }, { validateSign: true });
      if (data.code === '40004' && data.sub_code === 'ACQ.TRADE_NOT_EXIST') return { notFound: true };
      if (data.code !== '10000') throw new Error('Alipay query unavailable');
      if (data.seller_id && data.seller_id !== settings.sellerId) throw new Error('Alipay seller mismatch');
      return { ...data, app_id: settings.appId, seller_id: settings.sellerId };
    },
  };
}
module.exports = { createAlipayGateway, shanghaiTime };
