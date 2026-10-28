'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { prepare } = require('./install.cjs');
const { applyResourceDelta } = require('./asset-delta.cjs');
const root = path.join(__dirname, '../..');
function current() { return Object.fromEntries(Object.entries({ app: 'app.js', commerce: 'commerce.js', deletion: 'account_deletion.js', gateway: 'alipay_gateway.js' }).map(([key, name]) => [key, fs.readFileSync(root + '/server/src/' + name, 'utf8').replace(/\r\n/g, '\n')])); }
test('current integrated source is idempotent', () => assert.deepEqual(prepare(current()), current()));
test('unknown source is rejected without applying full repository files', () => {
  assert.throws(() => prepare({ app: '// unknown', commerce: '', deletion: '' }));
});
test('unrelated production changes and CORS stay intact', () => {
  const input = current();
  input.app += '\n// preserved production-only realname patch\n';
  const output = prepare(input);
  assert.equal(output.app, input.app);
  assert.ok(output.app.includes('OPENELF_WEB_CORS_20261028'));
  assert.equal(output.commerce, input.commerce);
});
test('known unpatched source receives only the exact incremental changes', () => {
  const expected = current();
  const baseline = applyResourceDelta(expected, true);
  const old = {
    app: baseline.app.replace("\nconst { wrapStore, registerCommunity } = require('./community');", '')
      .replace('  const communityReviewStore = options.paymentStore || createPaymentStore(db);\n  const paymentStore = wrapStore(communityReviewStore);', '  const paymentStore = options.paymentStore || createPaymentStore(db);')
      .replace("\n  registerCommunity(app, { store: paymentStore, reviewStore: communityReviewStore,\n    authenticate, reviewToken: process.env.COMMUNITY_REVIEW_TOKEN || '' });", ''),
    commerce: baseline.commerce.replace('communityViewer: user.id, ', '')
      .replace("\n        // Content restrictions do not alter ownership, balances or withdrawals.\n        if ((await tx.get('community_sanction', 'elf:' + elf.id))?.active ||\n            (await tx.get('community_sanction', 'user:' + elf.ownerId))?.active) continue;", ''),
    deletion: expected.deletion.replace(",\n  'community_block', 'community_terms', 'community_report', 'community_queue'", ''),
    gateway: baseline.gateway,
  };
  assert.deepEqual(prepare(old), expected);
});
test('resource delta roundtrips and rejects unknown gateway code', () => {
  const expected = current();
  assert.deepEqual(applyResourceDelta(applyResourceDelta(expected, true)), expected);
  assert.throws(() => applyResourceDelta({ ...expected, gateway: '// unknown gateway' }));
});
