'use strict';
const crypto = require('node:crypto');
const { randomUUID } = crypto;
const config = require('./config');

function randomSecret(len) {
  return crypto.randomBytes(len).toString('base64url');
}

function hashKey(plain) {
  return crypto.createHmac('sha256', config.key.pepper).update(plain).digest('hex');
}

function keyPrefix(plain) {
  return plain.slice(0, config.key.prefixLength);
}

function generateKey() {
  const id = randomUUID();
  const secret = randomSecret(config.key.secretLength);
  const plain = `oe-sk-${secret}`;
  return { id, plain, prefix: keyPrefix(plain) };
}

function verifyKey(plain, hash) {
  if (!plain || !hash) return false;
  const actual = hashKey(plain);
  try {
    return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(hash, 'hex'));
  } catch {
    return false;
  }
}

module.exports = { generateKey, hashKey, verifyKey, keyPrefix };
