'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateKey, hashKey, verifyKey, keyPrefix } = require('../src/platform/api_key');

test('generateKey 返回 oe-sk- 前缀且可校验', () => {
  const { id, plain, prefix } = generateKey();
  assert.ok(plain.startsWith('oe-sk-'));
  assert.equal(prefix.length, 12);
  const h = hashKey(plain);
  assert.ok(verifyKey(plain, h));
});

test('verifyKey 对错误密钥返回 false', () => {
  const { plain } = generateKey();
  const h = hashKey(plain);
  assert.equal(verifyKey(plain + 'x', h), false);
});

test('keyPrefix 提取前 12 字符', () => {
  assert.equal(keyPrefix('oe-sk-abcdef012345.rest'), 'oe-sk-abcdef');
});
