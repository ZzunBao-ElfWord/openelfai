'use strict';

const path = require('node:path');

function secret(name) {
  const value = process.env[name];
  if (!value || value.length < 16) {
    throw new Error(`环境变量 ${name} 未配置或长度不足 16 位`);
  }
  return value;
}

function bool(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null) return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
}

const nodeEnv = process.env.NODE_ENV || 'development';

// 审核用固定验证码账号，格式：手机号:验证码，多个用逗号分隔。
// 未配置时功能完全关闭，不影响正常短信验证码登录。
function parseReviewAccounts(raw) {
  const accounts = new Map();
  if (!raw) return accounts;
  for (const item of raw.split(',')) {
    const [phone, code] = item.trim().split(':');
    if (/^1[3-9]\d{9}$/.test(phone || '') && /^\d{6}$/.test(code || '')) {
      accounts.set(phone, code);
    }
  }
  return accounts;
}

module.exports = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 8787),
  trustProxy: bool('TRUST_PROXY', true),

  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'openelf',
    password: secret('DB_PASSWORD'),
    name: process.env.DB_NAME || 'openelf',
    poolSize: Number(process.env.DB_POOL_SIZE || 10),
  },

  jwtSecret: secret('JWT_SECRET'),
  smsCodePepper: secret('SMS_CODE_PEPPER'),
  refreshPepper: secret('REFRESH_TOKEN_PEPPER'),

  reviewAccounts: parseReviewAccounts(process.env.REVIEW_LOGIN_ACCOUNTS),

  accessTtlSec: Number(process.env.ACCESS_TTL_SEC || 900),
  refreshTtlSec: Number(process.env.REFRESH_TTL_SEC || 60 * 60 * 24 * 30),

  sms: {
    provider: process.env.SMS_PROVIDER || 'aliyun',
    debugCodes: bool('AUTH_DEBUG_CODES', false) && nodeEnv !== 'production',
    aliyun: {
      accessKeyId: process.env.ALIYUN_ACCESS_KEY_ID || '',
      accessKeySecret: process.env.ALIYUN_ACCESS_KEY_SECRET || '',
      signName: process.env.ALIYUN_SMS_SIGN_NAME || '',
      templateCode: process.env.ALIYUN_SMS_TEMPLATE_CODE || '',
    },
    whitelistPhones: (process.env.SMS_WHITELIST_PHONES || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
    whitelistCode: process.env.SMS_WHITELIST_CODE || '',
  },

  captcha: {
    enabled: bool('ALIYUN_CAPTCHA_ENABLED', false),
    allowOnError: bool('ALIYUN_CAPTCHA_ALLOW_ON_ERROR', true),
    endpoint: process.env.ALIYUN_CAPTCHA_ENDPOINT || 'https://captcha.alicaptcha.com/validate',
    timeoutMs: Number(process.env.ALIYUN_CAPTCHA_TIMEOUT_MS || 8000),
    schemes: {
      web: {
        appId: process.env.ALIYUN_CAPTCHA_WEB_APP_ID || '',
        appKey: process.env.ALIYUN_CAPTCHA_WEB_APP_KEY || '',
      },
      android: {
        appId: process.env.ALIYUN_CAPTCHA_ANDROID_APP_ID || '',
        appKey: process.env.ALIYUN_CAPTCHA_ANDROID_APP_KEY || '',
      },
      ios: {
        appId: process.env.ALIYUN_CAPTCHA_IOS_APP_ID || '',
        appKey: process.env.ALIYUN_CAPTCHA_IOS_APP_KEY || '',
      },
    },
  },

  // 实名核验：服务端权威核验（阿里云实人认证）。
  // ocr 模式一次调用完成「证件照 OCR + 权威源二要素核验」，plain 模式只核验姓名/证件号。
  realname: {
    enabled: bool('REALNAME_VERIFY_ENABLED', true),
    provider: process.env.REALNAME_PROVIDER || 'aliyun',
    mode: process.env.REALNAME_MODE || 'ocr',
    endpoint: process.env.REALNAME_ENDPOINT || 'cloudauth.aliyuncs.com',
    timeoutMs: Number(process.env.REALNAME_TIMEOUT_MS || 20000),
    accessKeyId: process.env.ALIYUN_ACCESS_KEY_ID || '',
    accessKeySecret: process.env.ALIYUN_ACCESS_KEY_SECRET || '',
    maxFailures: Number(process.env.REALNAME_MAX_FAILURES || 5),
    lockHours: Number(process.env.REALNAME_LOCK_HOURS || 24),
  },
  androidCommerce: {
    enabled: bool('ANDROID_COMMERCE_ENABLED', false),
    sandboxOnly: bool('ALIPAY_SANDBOX', false),
    allowSandbox: bool('ALIPAY_SANDBOX', false),
  },
  // 世界里的厂商官方 AI：每天由服务端按进度补齐动态与互相评论。
  worldAgents: {
    enabled: bool('WORLD_AGENTS_ENABLED', true),
    dailyInteractions: Number(process.env.WORLD_AGENTS_DAILY || 24),
    maxPerCycle: Number(process.env.WORLD_AGENTS_MAX_PER_CYCLE || 3),
    failureCooldownMs: Number(process.env.WORLD_AGENTS_FAILURE_COOLDOWN_MS || 30 * 60000),
    // 已确认可用的厂商（逗号分隔），与后台已配置密钥的厂商取并集。
    // 用于密钥直接写在 /opt/litellm/.env、未走后台配置的厂商。
    vendors: String(process.env.WORLD_AGENTS_VENDORS || '')
      .split(',').map((item) => item.trim()).filter(Boolean),
    assetBaseUrl: process.env.WORLD_ASSET_BASE_URL || 'https://openelfai.com',
  },
  // 收益提现审核：内部接口只认这个令牌，未配置时审核接口整体关闭。
  withdrawReviewToken: process.env.WITHDRAW_REVIEW_TOKEN || '',
  alipay: {
    enabled: bool('ALIPAY_ENABLED', false),
    sandbox: bool('ALIPAY_SANDBOX', false),
    appId: process.env.ALIPAY_APP_ID || '',
    sellerId: process.env.ALIPAY_SELLER_ID || '',
    keyMode: process.env.ALIPAY_KEY_MODE || 'public',
    privateKeyPath: process.env.ALIPAY_PRIVATE_KEY_PATH || '',
    publicKeyPath: process.env.ALIPAY_PUBLIC_KEY_PATH || '',
    appCertPath: process.env.ALIPAY_APP_CERT_PATH || '',
    alipayPublicCertPath: process.env.ALIPAY_PUBLIC_CERT_PATH || '',
    alipayRootCertPath: process.env.ALIPAY_ROOT_CERT_PATH || '',
    notifyUrl: process.env.ALIPAY_NOTIFY_URL || 'https://openelfai.com/api/v1/android/alipay/notify',
  },

  appleIap: {
    enabled: bool('APPLE_IAP_ENABLED', false),
    sandboxOnly: bool('APPLE_IAP_SANDBOX_ONLY', false),
    productsJson: process.env.APPLE_IAP_PRODUCTS_JSON || '{}',
    bundleId: process.env.APPLE_IAP_BUNDLE_ID || '',
    appId: process.env.APPLE_IAP_APP_ID || '',
    keyId: process.env.APPLE_IAP_KEY_ID || '',
    issuerId: process.env.APPLE_IAP_ISSUER_ID || '',
    privateKeyPath: process.env.APPLE_IAP_PRIVATE_KEY_PATH || '',
    rootCertPaths: process.env.APPLE_IAP_ROOT_CERT_PATHS || '',
    allowSandbox: bool('APPLE_IAP_ALLOW_SANDBOX', false),
  },
};
