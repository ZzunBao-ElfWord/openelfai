'use strict';

const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const ISSUER = 'openelf-api';
const AUDIENCE = 'openelf-app';

function hmacHex(pepper, value) {
  return crypto.createHmac('sha256', pepper).update(value).digest('hex');
}

function secureEqualHex(a, b) {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  if (left.length !== right.length || left.length === 0) return false;
  return crypto.timingSafeEqual(left, right);
}

function generateSmsCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function generateRefreshToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashRefreshToken(pepper, token) {
  return hmacHex(pepper, token);
}

function signAccessToken({ secret, userId, sessionId, ttlSec }) {
  return jwt.sign(
    { sub: userId, sid: sessionId, typ: 'access' },
    secret,
    {
      algorithm: 'HS256',
      expiresIn: ttlSec,
      issuer: ISSUER,
      audience: AUDIENCE,
    },
  );
}

function verifyAccessToken(secret, token) {
  return jwt.verify(token, secret, {
    algorithms: ['HS256'],
    issuer: ISSUER,
    audience: AUDIENCE,
  });
}

module.exports = {
  AUDIENCE,
  ISSUER,
  generateRefreshToken,
  generateSmsCode,
  hashRefreshToken,
  hmacHex,
  secureEqualHex,
  signAccessToken,
  verifyAccessToken,
};
