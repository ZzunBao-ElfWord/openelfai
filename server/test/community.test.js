'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { memoryStore } = require('./helpers/payment_memory');
const { wrapStore, createCommunityService, filterResult, registerCommunity } = require('../src/community');

const alice = { id: 'u_alice', nickname: 'Alice' };
const bob = { id: 'u_bob', nickname: 'Bob' };
async function fixture() {
  const raw = memoryStore(); raw.addUser(alice); raw.addUser(bob);
  const store = wrapStore(raw);
  const service = createCommunityService(store);
  const admin = createCommunityService(raw);
  await raw.transaction('Production', async tx => {
    await tx.put('elf', 'e_bob', { id: 'e_bob', ownerId: bob.id, name: 'Bob AI', moderationStatus: 'approved' }, { owner: bob.id });
    await tx.put('elf', 'e_alice', { id: 'e_alice', ownerId: alice.id, name: 'Alice AI', moderationStatus: 'approved' }, { owner: alice.id });
  });
  await service.acceptTerms(bob, { accepted: true, version: '2026-10-28' });
  const post = { id: 'p_bob', elfId: 'e_bob', body: 'Public AI content', moderationStatus: 'approved' };
  await store.transaction('Production', tx => tx.put('post', post.id, post, { owner: bob.id }));
  return { raw, store, service, admin, post };
}
const input = { requestId: 'test_request_123', targetKind: 'post', targetId: 'p_bob', reason: '其他', details: 'please review' };

test('client approval is ignored and new content is pending until privileged review', async () => {
  const { raw, store, admin, post } = await fixture();
  const read = () => store.transaction('Production', () => ({ communityViewer: alice.id, posts: [post] }));
  assert.deepEqual((await read()).posts, []);
  assert.equal((await admin.queue()).items[0].status, 'pending');
  await admin.review({ id: 'post:p_bob', action: 'approve', reason: 'checked text and media' }, 'reviewer');
  assert.equal((await read()).posts.length, 1);
  await store.transaction('Production', tx => tx.put('post', post.id, { ...post, likes: 1 }, { owner: bob.id }));
  assert.equal((await read()).posts.length, 1);
  assert.equal([...raw.inspect().objects.values()].filter(r => r.kind === 'community_audit').length, 1);
});
test('publishing requires affirmative community terms without spending funds', async () => {
  const { raw, store } = await fixture();
  await assert.rejects(store.transaction('Production', async tx => {
    await tx.lockWallet(alice.id);
    return tx.put('post', 'new_post', { id: 'new_post', elfId: 'e_alice' }, { owner: alice.id });
  }), { code: 'COMMUNITY_AGREEMENT_REQUIRED' });
  assert.equal([...raw.inspect().objects.values()].some(r => r.id === 'new_post'), false);
});
test('report persistence, idempotency, privacy and conflicting reuse', async () => {
  const { service } = await fixture();
  const first = await service.submit(alice, input);
  assert.deepEqual(await service.submit(alice, input), first);
  const mine = await service.snapshot(alice);
  assert.equal(mine.reports.length, 1);
  assert.equal(mine.reports[0].evidence, undefined);
  assert.equal(mine.reports[0].hash, undefined);
  assert.equal((await service.snapshot(bob)).reports.length, 0);
  await assert.rejects(service.submit(alice, { ...input, details: 'changed' }), { code: 'REQUEST_REUSED' });
});
test('reject fabricated target, malformed reason, oversize and invalid environment', async () => {
  const { service } = await fixture();
  await assert.rejects(service.submit(alice, { ...input, targetId: 'missing' }), { code: 'UNKNOWN_TARGET' });
  await assert.rejects(service.submit(alice, { ...input, reason: 'bad' }), { code: 'INVALID_REASON' });
  await assert.rejects(service.submit(alice, { ...input, details: 'x'.repeat(1001) }), { code: 'INVALID_DETAILS' });
  await assert.rejects(service.submit(alice, { ...input, environment: 'anything' }), { code: 'INVALID_ENVIRONMENT' });
});
test('server-backed block/unblock filters both AI and all author content', async () => {
  const { raw, service, admin, post } = await fixture();
  await admin.review({ id: 'post:p_bob', action: 'approve', reason: 'checked' }, 'reviewer');
  await service.setBlock(alice, { targetKind: 'user', targetId: bob.id, blocked: true });
  assert.equal((await service.snapshot(alice)).blocks.length, 1);
  await raw.transaction('Production', async tx => {
    assert.equal((await filterResult(tx, { posts: [post] }, alice.id)).posts.length, 0);
    assert.equal((await filterResult(tx, { posts: [post] }, bob.id)).posts.length, 1);
  });
  await service.setBlock(alice, { targetKind: 'user', targetId: bob.id, blocked: false });
  assert.equal((await service.snapshot(alice)).blocks.length, 0);
  await assert.rejects(service.setBlock(alice, { targetKind: 'user', targetId: alice.id, blocked: true }), { code: 'SELF_BLOCK' });
});
test('report decision hides content globally and records resolution and audit', async () => {
  const { store, service, admin, post } = await fixture();
  await admin.review({ id: 'post:p_bob', action: 'approve', reason: 'checked' }, 'reviewer');
  const report = await service.submit(alice, input);
  await admin.review({ kind: 'report', id: report.id, action: 'hide', reason: 'confirmed harassment' }, 'reviewer');
  const result = await store.transaction('Production', () => ({ communityViewer: bob.id, posts: [post] }));
  assert.equal(result.posts.length, 0);
  assert.equal(result.communityViewer, undefined);
  assert.equal((await service.snapshot(alice)).reports[0].resolution, 'confirmed harassment');
  await assert.rejects(admin.review({ kind: 'report', id: report.id, action: 'dismiss', reason: 'retry' }, 'reviewer'), { code: 'ALREADY_REVIEWED' });
});
test('legacy content is hidden and imported into pending review instead of auto-approved', async () => {
  const { raw, admin } = await fixture();
  await raw.transaction('Production', async tx => {
    await tx.put('post', 'legacy', { id: 'legacy', elfId: 'e_bob', body: 'old' });
    assert.equal((await filterResult(tx, { posts: [{ id: 'legacy' }] }, alice.id)).posts.length, 0);
  });
  assert.ok((await admin.queue()).items.some(row => row.id === 'post:legacy'));
});
test('pending comments and comments under a removed parent never leak', async () => {
  const { raw, store, admin } = await fixture();
  await admin.review({ id: 'post:p_bob', action: 'approve', reason: 'checked' }, 'reviewer');
  await store.transaction('Production', tx => tx.put('comment', 'c_bob', { id: 'c_bob', postId: 'p_bob', userId: bob.id, text: 'hello' }, { owner: bob.id }));
  await raw.transaction('Production', async tx => assert.equal((await filterResult(tx, { comments: [{ id: 'c_bob' }] }, alice.id)).comments.length, 0));
  await admin.review({ id: 'comment:c_bob', action: 'approve', reason: 'checked' }, 'reviewer');
  await raw.transaction('Production', async tx => {
    assert.equal((await filterResult(tx, { comments: [{ id: 'c_bob' }] }, alice.id)).comments[0].userId, bob.id);
    const parent = await tx.get('post', 'p_bob');
    await tx.put('post', 'p_bob', { ...parent, moderationStatus: 'hidden' });
    assert.equal((await filterResult(tx, { comments: [{ id: 'c_bob' }] }, alice.id)).comments.length, 0);
  });
});
test('operator token required, no review bypass via public body', async () => {
  const Fastify = require('fastify');
  const { raw, store } = await fixture();
  const app = Fastify();
  registerCommunity(app, { store, reviewStore: raw, reviewToken: 'z'.repeat(40), authenticate: async request => {
    if (request.headers.authorization !== 'Bearer alice-session') throw Object.assign(new Error('login'), { statusCode: 401 });
    return { user: alice };
  } });
  assert.equal((await app.inject({ url: '/api/v1/community' })).statusCode, 401);
  assert.equal((await app.inject({ url: '/internal/community/queue' })).statusCode, 401);
  assert.equal((await app.inject({ url: '/internal/community/queue', headers: { authorization: 'Bearer ' + 'z'.repeat(40) } })).statusCode, 200);
  const response = await app.inject({ method: 'POST', url: '/api/v1/community/reports', headers: { authorization: 'Bearer alice-session' }, payload: { ...input, status: 'approved', reporterId: bob.id } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().status, 'pending');
  await app.close();
});
test('withdrawals, wallet balances and ownership are not mutated by moderation', async () => {
  const { raw, service, admin } = await fixture();
  const before = raw.inspect();
  const report = await service.submit(alice, { ...input, targetKind: 'elf', targetId: 'e_bob' });
  await admin.review({ kind: 'report', id: report.id, action: 'hide', reason: 'confirmed harmful AI' }, 'reviewer');
  const after = raw.inspect();
  assert.deepEqual(after.objects.get('Production:elf:e_bob'), before.objects.get('Production:elf:e_bob'));
  assert.equal([...after.objects.values()].filter(row => row.kind === 'withdrawal').length, 0);
  assert.equal(after.wallets.get('Production:u_alice').diamonds, 0);
  assert.equal(after.wallets.get('Production:u_alice').pendingCents, 0);
});
test('public AI profile and post require independent approval', async () => {
  const { raw, store, admin, post } = await fixture();
  await raw.transaction('Production', async tx => {
    const elf = await tx.get('elf', 'e_bob');
    await tx.put('elf', 'e_bob', { ...elf, moderationStatus: undefined });
  });
  await admin.queue();
  await admin.review({ id: 'post:p_bob', action: 'approve', reason: 'checked post' }, 'reviewer');
  const read = () => store.transaction('Production', () => ({ communityViewer: alice.id, posts: [post], elves: [{ id: 'e_bob' }] }));
  assert.equal((await read()).posts.length, 0);
  assert.equal((await read()).elves.length, 0);
  await admin.review({ id: 'elf:e_bob', action: 'approve', reason: 'checked public profile and image' }, 'reviewer');
  assert.equal((await read()).posts.length, 1);
});
