'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { prepare } = require('./install.cjs');
const root = path.join(__dirname, '../..');
function current() { return { app: fs.readFileSync(root + '/server/src/app.js', 'utf8').replace(/\r\n/g, '\n'), commerce: fs.readFileSync(root + '/server/src/commerce.js', 'utf8').replace(/\r\n/g, '\n'), deletion: fs.readFileSync(root + '/server/src/account_deletion.js', 'utf8').replace(/\r\n/g, '\n') }; }
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
  const old = {
    app: expected.app.replace("\nconst { wrapStore, registerCommunity } = require('./community');", '')
      .replace('  const communityReviewStore = options.paymentStore || createPaymentStore(db);\n  const paymentStore = wrapStore(communityReviewStore);', '  const paymentStore = options.paymentStore || createPaymentStore(db);')
      .replace("\n  registerCommunity(app, { store: paymentStore, reviewStore: communityReviewStore,\n    authenticate, reviewToken: process.env.COMMUNITY_REVIEW_TOKEN || '' });", ''),
    commerce: expected.commerce.replace('communityViewer: user.id, ', '')
      .replace("\n        // Content restrictions do not alter ownership, balances or withdrawals.\n        if ((await tx.get('community_sanction', 'elf:' + elf.id))?.active ||\n            (await tx.get('community_sanction', 'user:' + elf.ownerId))?.active) continue;", ''),
    deletion: expected.deletion.replace(",\n  'community_block', 'community_terms', 'community_report', 'community_queue'", ''),
  };
  assert.deepEqual(prepare(old), expected);
});
