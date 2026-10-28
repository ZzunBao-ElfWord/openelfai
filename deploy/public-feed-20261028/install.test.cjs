'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { prepare, baseline } = require('./install.cjs');
const current = fs.readFileSync(__dirname + '/../../server/src/community.js', 'utf8');
const feed = fs.readFileSync(__dirname + '/../../server/src/public_feed.js', 'utf8');
const old = fs.readFileSync(__dirname + '/community-v2.fixture.js', 'utf8').replace(/\r\n/g, '\n').trimEnd() + '\n';
test('baseline matches the exact community module installed by v2', () => {
  assert.equal(crypto.createHash('sha256').update(old).digest('hex'), baseline);
});
test('known v2 upgrades only the two declared modules and is idempotent', () => {
  const result = prepare(old, current, null, feed);
  assert.deepEqual(Object.keys(result), ['community.js', 'public_feed.js']);
  assert.deepEqual(prepare(current, current, feed, feed), result);
});
test('unknown modules and syntax errors fail before any filesystem mutation', () => {
  assert.throws(() => prepare(old + '// unknown modification', current, null, feed));
  assert.throws(() => prepare(old, current, '// unknown feed', feed));
  assert.throws(() => prepare(old, current, null, 'invalid {'));
});
