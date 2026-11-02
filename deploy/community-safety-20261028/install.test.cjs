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

test('confirmed production OCR adapter stays byte-for-byte and needs no deletion registration anchor', () => {
  const integrated = current();
  const baseline = applyResourceDelta(integrated, true);
  const registration = "  registerCommunity(app, { store: paymentStore, reviewStore: communityReviewStore,\n    authenticate, reviewToken: process.env.COMMUNITY_REVIEW_TOKEN || '' });";
  baseline.app = baseline.app.replace("\nconst { wrapStore, registerCommunity } = require('./community');", '')
    .replace('  const communityReviewStore = options.paymentStore || createPaymentStore(db);\n  const paymentStore = wrapStore(communityReviewStore);', '  const paymentStore = options.paymentStore || createPaymentStore(db);')
    .replace(registration + '\n', '')
    .replace("  require('./account_deletion').registerAccountDeletion(app, { db, authenticate });\n", '');
  baseline.commerce = baseline.commerce.replace('communityViewer: user.id, ', '')
    .replace("\n        // Content restrictions do not alter ownership, balances or withdrawals.\n        if ((await tx.get('community_sanction', 'elf:' + elf.id))?.active ||\n            (await tx.get('community_sanction', 'user:' + elf.ownerId))?.active) continue;", '')
    .replace('function createCommerceService({ store, settings, payout = null, realname = null,\n  identityPolicy = {} }) {', 'function createCommerceService({ store, settings, payout = null }) {');
  const ocr = "  async function verifyIdentity(user, body) {\n    return require('./realname_ocr').verifyIdentity({\n      store, settings, environment, validateRealName, validateIdNumber,\n    }, user, body);\n  }\n";
  const originalIdentity = /  async function verifyIdentity\(user, body\) \{[\s\S]*?\n  \}\n(?=  return \{ snapshot)/;
  assert.ok(originalIdentity.test(baseline.commerce));
  baseline.commerce = baseline.commerce.replace(originalIdentity, ocr)
    .replace('module.exports = { createCommerceService, CATALOG, MODULES, MODULE_PRICES, FORGET_COST };', '');
  const output = prepare(baseline);
  assert.ok(output.commerce.includes(ocr));
  assert.ok(output.commerce.includes('function createCommerceService({ store, settings, payout = null, payoutQuery = null }) {'));
  assert.ok(output.commerce.includes('reviewWithdrawal, reconcileWithdrawal, listWithdrawals'));
  assert.ok(output.app.includes(registration + '\n\n  async function ensureUser(phone) {'));
  assert.ok(!output.app.includes("require('./account_deletion').registerAccountDeletion"));
  assert.ok(output.app.includes('OPENELF_WEB_CORS_20261028'));
  assert.deepEqual(prepare(output), output);
  assert.deepEqual(applyResourceDelta(applyResourceDelta(baseline), true), baseline);
});

test('unknown or ambiguous authentication and service declarations remain rejected', () => {
  const baseline = applyResourceDelta(current(), true);
  const registration = "  registerCommunity(app, { store: paymentStore, reviewStore: communityReviewStore,\n    authenticate, reviewToken: process.env.COMMUNITY_REVIEW_TOKEN || '' });";
  const app = baseline.app.replace(registration + '\n', '')
    .replace("  require('./account_deletion').registerAccountDeletion(app, { db, authenticate });\n", '')
    .replace('  async function authenticate(request) {', '  async function unknownAuthenticate(request) {');
  assert.throws(() => prepare({ ...baseline, app }), /认证函数/);
  assert.throws(() => applyResourceDelta({ ...baseline, commerce: baseline.commerce.replace('payout = null, realname = null,', 'payout = customPayout, realname = null,') }), /不匹配/);
  assert.throws(() => applyResourceDelta({ ...baseline, commerce: baseline.commerce + '\nfunction createCommerceService({ store, settings, payout = null }) {}' }), /歧义/);
});
