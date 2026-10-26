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
    signOrder(order, options = {}) {
      return sdk.sdkExecute('alipay.trade.app.pay', {
        notifyUrl: options.notifyUrl || settings.notifyUrl, timestamp: shanghaiTime(Date.now()),
        bizContent: { out_trade_no: order.id, product_code: 'QUICK_MSECURITY_PAY', seller_id: settings.sellerId,
          total_amount: (order.priceFen / 100).toFixed(2),
          subject: order.subject || `OpenElf ${order.diamonds}钻石`,
          time_expire: shanghaiTime(order.expiresAt) } });
    },
    // 电脑网站支付：返回可跳转的支付宝收银台链接（需商户已签约该产品）。
    pagePay(order, options = {}) {
      const params = {
        timestamp: shanghaiTime(Date.now()),
        notifyUrl: options.notifyUrl || settings.notifyUrl,
        bizContent: { out_trade_no: order.id, product_code: 'FAST_INSTANT_TRADE_PAY',
          seller_id: settings.sellerId,
          total_amount: (order.priceFen / 100).toFixed(2),
          subject: order.subject || 'OpenElf 平台余额充值',
          time_expire: shanghaiTime(order.expiresAt) } };
      if (options.returnUrl) params.returnUrl = options.returnUrl;
      return sdk.pageExecute('alipay.trade.page.pay', 'GET', params);
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
    async transfer({ outTradeNo, account, amountCents, remark }) {
      // 单笔转账（提现出款）。必须校验返回签名，失败绝不当作成功。
      const data = await sdk.exec('alipay.fund.trans.uni.transfer', {
        timestamp: shanghaiTime(Date.now()),
        bizContent: { out_biz_no: outTradeNo, trans_amount: (amountCents / 100).toFixed(2),
          product_code: 'TRANS_ACCOUNT_NO_PWD', biz_scene: 'DIRECT_TRANSFER',
          order_title: remark || 'OpenElf 创作者收益',
          payee_info: { identity: account, identity_type: 'ALIPAY_LOGON_ID' } },
      }, { validateSign: true });
      if (data.code === '10000') return { status: 'paid', orderId: data.order_id || null, payDate: data.pay_date || null };
      // 处理中/失败都按未完成处理，交由人工复核重试。
      return { status: 'failed', code: data.sub_code || data.code || 'UNKNOWN',
        message: data.sub_msg || data.msg || '支付宝转账未完成' };
    },
  };
}
module.exports = { createAlipayGateway, shanghaiTime };
