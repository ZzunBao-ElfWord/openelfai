'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCommerceService, address } = require('../src/commerce');
const { memoryStore } = require('./helpers/payment_memory');
const { RESOURCE_POLICY } = require('../src/resource_policy');

test('character mint cannot treat a legacy deterministic display ID as a registered wallet', async () => {
  const store = memoryStore();
  const user = { id: 'u_merge_recipient', nickname: 'merge fixture' };
  store.addUser(user);
  const service = createCommerceService({ store, settings: { enabled: true } });
  await store.transaction('Production', tx => tx.put('profile', user.id,
    { humanAddress: address('user:' + user.id) }, { owner: user.id }));
  assert.equal(await service.characterAddress(user, 'Production'), null);
  const registered = '0x' + 'a'.repeat(40);
  await store.transaction('Production', tx => tx.put('profile', user.id,
    { humanAddress: registered }, { owner: user.id }));
  assert.equal(await service.characterAddress(user, 'Production'), registered);
});

test('selected character chain workflow does not reopen resale or balance cashout', () => {
  assert.equal(RESOURCE_POLICY.characterMint.onChain, true);
  assert.equal(RESOURCE_POLICY.characterMint.requiresConfiguredProvider, true);
  assert.equal(RESOURCE_POLICY.characterMint.requiresRegisteredRecipient, true);
  assert.equal(RESOURCE_POLICY.resale, false);
  assert.equal(RESOURCE_POLICY.diamondCashout, false);
  assert.equal(RESOURCE_POLICY.earningsTransfer, false);
});
