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
};
