'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { prepare, TAG, ANCHOR } = require('../deploy/push/install.cjs');
const base = "async function authenticate(request) {}\n" + ANCHOR + '\n}\n';
test('push deploy changes only one registration and is idempotent', () => {
  const next = prepare(base);
  assert.equal(next.replace(TAG + '\n\n', ''), base);
  assert.equal(prepare(next), next);
});
test('push deploy preserves Windows line endings and rejects unknown or duplicate registrations', () => {
  const crlf = base.replace(/\n/g, '\r\n');
  assert.equal(prepare(crlf).replace(TAG + '\r\n\r\n', ''), crlf);
  assert.throws(() => prepare(base + '\ncreatePushService();'));
  assert.throws(() => prepare(base + '\n' + TAG + '\n' + TAG));
  assert.throws(() => prepare(base.replace(ANCHOR, 'other function')));
});
test('push deploy recognizes integrated current source without overwriting it', () => {
  const source = fs.readFileSync(require.resolve('../src/app'), 'utf8');
  assert.equal(prepare(source), source);
  assert.ok(source.includes("require('./platform')"));
  assert.ok(source.includes('registerCommunity'));
  assert.ok(source.includes('OPENELF_WEB_CORS_20261028'));
});
