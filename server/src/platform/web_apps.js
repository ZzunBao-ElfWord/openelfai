'use strict';
const NEW_APP_ID = '2021007112614465', OLD_APP_ID = '2021000105658450';
const NOTIFY_URL = 'https://web.openelfai.com/api/v1/platform/web-alipay/notify';
const RETURN_URL = 'https://web.openelfai.com/?topup_return=1';
function webSettings(env = process.env) {
  const s = { enabled: env.ALIPAY_WEB_ENABLED === 'true', sandbox: false,
    appId: env.ALIPAY_WEB_APP_ID || NEW_APP_ID, sellerId: env.ALIPAY_WEB_SELLER_ID || '', keyMode: 'public',
    privateKeyPath: env.ALIPAY_WEB_PRIVATE_KEY_PATH || '/etc/openelf/alipay-web-' + NEW_APP_ID + '/private.pem',
    publicKeyPath: env.ALIPAY_WEB_PUBLIC_KEY_PATH || '/etc/openelf/alipay-web-' + NEW_APP_ID + '/alipay-public.pem', notifyUrl: NOTIFY_URL };
  if (s.appId !== NEW_APP_ID || env.ALIPAY_WEB_SANDBOX === 'true') throw Error('新网页应用或正式环境配置不一致，禁止启动网页支付');
  return s;
}
function legacySettings(env = process.env) {
  return { enabled: env.ALIPAY_WEB_LEGACY_ENABLED === 'true', sandbox: false, appId: OLD_APP_ID,
    sellerId: env.ALIPAY_WEB_LEGACY_SELLER_ID || '', keyMode: 'public',
    privateKeyPath: env.ALIPAY_WEB_LEGACY_PRIVATE_KEY_PATH || '',
    publicKeyPath: env.ALIPAY_WEB_LEGACY_PUBLIC_KEY_PATH || '', notifyUrl: NOTIFY_URL };
}
module.exports = { NEW_APP_ID, OLD_APP_ID, webSettings, legacySettings, NOTIFY_URL, RETURN_URL };
