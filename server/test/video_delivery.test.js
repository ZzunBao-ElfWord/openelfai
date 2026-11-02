'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { videoDeliveryUrl } = require('../src/video_delivery');
const { publicFeed } = require('../src/public_feed');
const { memoryStore } = require('./helpers/payment_memory');
const origin = 'https://openelfai.com/api/v1/world-assets/videos/doubao-2026-10-28-26330b01.mp4';
const cdn = origin.replace('https://openelfai.com', 'https://media.openelfai.com');

test('only public MP4 assets map to CDN, idempotently and reversibly', () => {
  assert.equal(videoDeliveryUrl(origin, true), cdn);
  assert.equal(videoDeliveryUrl(cdn, true), cdn);
  assert.equal(videoDeliveryUrl(origin, false), origin);
  for (const url of [null, '', 'invalid', origin.replace('https:', 'http:'),
    origin.replace('openelfai.com', 'evil.test'), origin + '?token=private',
    origin.replace('https://', 'https://user:password@'),
    origin.replace('.mp4', '.jpg'), 'https://openelfai.com/app/media/sample.mp4',
    'https://openelfai.com/api/v1/account',
    origin.replace('openelfai.com', 'openelfai.com:444')]) {
    assert.equal(videoDeliveryUrl(url, true), url);
  }
});

test('old stored video is delivered through CDN without DB or balance writes', async () => {
  const store = memoryStore(), user = { id: 'u_cdn_reader' };
  store.addUser(user);
  await store.transaction('Production', async tx => {
    await tx.put('elf', 'e_cdn', { id: 'e_cdn', ownerId: user.id, status: 'owned' });
    await tx.put('post', 'p_cdn', { id: 'p_cdn', elfId: 'e_cdn', kind: 'video', videoUrl: origin });
  });
  const before = store.inspect();
  const result = await publicFeed(store, user, { channel: 'video' });
  assert.equal(result.posts[0].videoUrl, cdn);
  assert.deepEqual(store.inspect(), before);
});
