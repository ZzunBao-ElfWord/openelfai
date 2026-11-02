'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { memoryStore } = require('./helpers/payment_memory');
const { publicFeed } = require('../src/public_feed');
const user = { id: 'u_reader' };
test('new compliance blocks also apply to cross-platform public content', async () => {
  const store = await fixture();
  const before = store.inspect();
  const compliance = { blockedSets: async () => ({ elves: new Set(['e_public']), users: new Set() }) };
  const result = await publicFeed(store, user, {}, compliance);
  assert.deepEqual(result.posts, []);
  assert.deepEqual(store.inspect(), before);
});
async function fixture() {
  const store = memoryStore(); store.addUser(user);
  await store.transaction('Production', async tx => {
    await tx.put('elf', 'e_public', { id: 'e_public', name: 'Public', ownerId: user.id,
      status: 'owned', moderationStatus: 'approved' }, { owner: user.id });
    await tx.put('post', 'p_approved', { id: 'p_approved', elfId: 'e_public',
      kind: 'video', body: 'Approved public content', moderationStatus: 'approved' });
    for (let i = 0; i < 25; i++) await tx.put('post', 'pending_' + i,
      { id: 'pending_' + i, elfId: 'e_public', views: 10000, moderationStatus: 'hidden' });
  });
  await store.transaction('Sandbox', tx => tx.put('post', 'p_sandbox',
    { id: 'p_sandbox', elfId: 'e_public', moderationStatus: 'approved' }));
  return store;
}
test('public feed ignores payment environment and cannot touch wallets, orders or earnings', async () => {
  const store = await fixture(), before = store.inspect();
  const result = await publicFeed(store, user, { environment: 'Sandbox', size: 1 });
  assert.equal(result.contentEnvironment, 'production');
  assert.equal(result.protocol, 1);
  assert.deepEqual(result.posts.map(p => p.id), ['p_approved']);
  assert.equal(result.elves[0].isMine, false);
  assert.equal(result.community.version, 1);
  assert.equal(result.communityViewer, undefined);
  assert.equal(result.hasMore, false);
  assert.deepEqual(store.inspect(), before);
});
test('takedown and author/user block filters run BEFORE pagination on every client', async () => {
  const store = await fixture();
  await store.transaction('Production', tx => tx.put('community_block', 'b1',
    { targetKind: 'elf', targetId: 'e_public' }, { owner: user.id, state: 'active' }));
  assert.deepEqual((await publicFeed(store, user, { channel: 'video' })).posts, []);
});
test('no unreviewed demo posts are synthesized and empty feed succeeds honestly', async () => {
  const store = await fixture();
  await store.transaction('Production', async tx => {
    const elf = await tx.get('elf', 'e_public');
    await tx.put('elf', elf.id, { ...elf, moderationStatus: 'hidden' });
  });
  const result = await publicFeed(store, user);
  assert.deepEqual(result.posts, []);
  assert.deepEqual(result.elves, []);
});

test('legacy unreviewed and pending rows appear without changing content or any balances', async () => {
  const store = await fixture();
  await store.transaction('Production', async tx => {
    const elf = await tx.get('elf', 'e_public');
    await tx.put('elf', elf.id, { ...elf, moderationStatus: undefined });
    const post = await tx.get('post', 'p_approved');
    await tx.put('post', post.id, { ...post, moderationStatus: 'pending' });
  });
  const before = store.inspect();
  assert.deepEqual((await publicFeed(store, user)).posts.map(row => row.id), ['p_approved']);
  assert.deepEqual(store.inspect(), before);
});
