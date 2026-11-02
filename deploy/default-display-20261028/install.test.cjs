'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { prepare, baseline } = require('./install.cjs');
const next = fs.readFileSync(__dirname + '/../../server/src/community.js', 'utf8');
const feed = fs.readFileSync(__dirname + '/../../server/src/public_feed.js', 'utf8');
const original = (fs.readFileSync(__dirname + '/../public-feed-20261028/community-v2.fixture.js', 'utf8').trimEnd() + '\n')
  .replace("  app.get('/api/v1/community', guarded((user, query) => service.snapshot(user, query.environment)));",
    "  app.get('/api/v1/community', guarded((user, query) => service.snapshot(user, query.environment)));\n  app.get('/api/v1/community/feed', guarded((user, query) =>\n    require('./public_feed').publicFeed(reviewStore, user, query)));");
test('known installed build16 module upgrades without a database migration', () => {
  assert.equal(crypto.createHash('sha256').update(original).digest('hex'), baseline);
  assert.equal(prepare(original, next, feed), next);
});
test('idempotent install and explicit hidden-state protection', () => {
  assert.equal(prepare(next, next, feed), next);
  assert.ok(next.includes("'hidden', 'rejected', 'removed', 'deleted', 'blocked', 'draft', 'private'"));
});
test('unknown versions and malformed packages fail before writes', () => {
  assert.throws(() => prepare(original + '// unknown', next, feed));
  assert.throws(() => prepare(original, next, feed + '// unknown'));
  assert.throws(() => prepare(original, 'broken {', feed));
});
