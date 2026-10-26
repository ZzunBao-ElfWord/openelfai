'use strict';
const crypto = require('node:crypto');

const ALGORITHM = 'aes-256-gcm';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

let cachedKey = null;
let cachedSource = null;

function deriveKey() {
  const source = process.env.PLATFORM_SECRETS_KEY || '';
  if (cachedKey && cachedSource === source) return cachedKey;

  let key;
  if (source) {
    key = Buffer.from(source, 'base64');
    if (key.length !== 32) {
      throw new Error('PLATFORM_SECRETS_KEY 必须是 32 字节的 base64 密钥');
    }
  } else {
    key = crypto.scryptSync(
      process.env.PLATFORM_KEY_PEPPER || 'dev-pepper-change-me',
      'openelf-platform-secrets',
      32,
    );
  }

  cachedKey = key;
  cachedSource = source;
  return key;
}

function encrypt(plain) {
  if (typeof plain !== 'string' || !plain) throw new Error('明文密钥不能为空');
  const nonce = crypto.randomBytes(NONCE_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, deriveKey(), nonce);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  // 存储格式：base64(nonce12 + tag16 + ciphertext)
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString('base64');
}

function decrypt(stored) {
  if (typeof stored !== 'string' || !stored) throw new Error('密文不能为空');
  const raw = Buffer.from(stored, 'base64');
  if (raw.length <= NONCE_BYTES + TAG_BYTES) throw new Error('密文格式无效');

  const nonce = raw.subarray(0, NONCE_BYTES);
  const tag = raw.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES);
  const ciphertext = raw.subarray(NONCE_BYTES + TAG_BYTES);

  const decipher = crypto.createDecipheriv(ALGORITHM, deriveKey(), nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function keyHint(plain) {
  if (typeof plain !== 'string' || plain.length < 12) return '****';
  // 平台 Key 形如 oe-sk-<40 位随机串>，掩码保留可辨识的 key_prefix 与尾 4 位。
  if (plain.startsWith('oe-sk-')) return `${plain.slice(0, 12)}…${plain.slice(-4)}`;
  return `${plain.slice(0, 4)}****${plain.slice(-4)}`;
}

module.exports = { encrypt, decrypt, keyHint };
