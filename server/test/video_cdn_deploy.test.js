'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const os = require('node:os');
const { createRequire } = require('node:module');
const { prepare } = require('../deploy/video_cdn/install.cjs');
test('CDN deploy is incremental, idempotent and preserves line endings', () => {
  const originals = {
    'commerce.js': "const crypto = require('node:crypto');\nfunction normalizePost(post) {\n  return post;\n}\n// KEEP_PAYMENT_CAPTCHA_BUSINESS\n",
    'world_uploads.js': "const crypto = require('node:crypto');\n      return { post, reviewState: 'pending_review' };\n// KEEP_MODERATION\n",
    'world_videos.js': "const crypto = require('crypto');\n      await tx.put('elf', ELF_ID, elf, { owner: null });\n      return post;\n// KEEP_GENERATION\n",
  };
  for (const [name, original] of Object.entries(originals)) {
    for (const input of [original, original.replace(/\n/g, '\r\n')]) {
      const next = prepare(name, input);
      assert.ok(next.includes(input.split('// KEEP')[1]));
      assert.equal(prepare(name, next), next);
      assert.equal(next.includes('\r\n'), input.includes('\r\n'));
      assert.throws(() => prepare(name, input + input));
      assert.throws(() => prepare(name, input + '\nvideoDeliveryUrl();'));
    }
    const integrated = fs.readFileSync(require.resolve('../src/' + name), 'utf8');
    assert.equal(prepare(name, integrated), integrated);
  }
  assert.throws(() => prepare('app.js', 'unknown'));
  assert.throws(() => prepare('commerce.js', 'unknown'));
});

test('exact deployed legacy upload is patched without adding review gates', async t => {
  const fixture = fs.readFileSync(path.join(__dirname, 'helpers/world_uploads_legacy.fixture.cjs'), 'utf8');
  assert.equal(crypto.createHash('sha256').update(fixture).digest('hex'),
    'c565ca47ba239f1aacc56a0261114716274ee0003620d23e0f8501462ef6e79e');
  const next = prepare('world_uploads.js', fixture);
  const oldReturn = '      return { post };';
  const nextReturn = '      return { post: { ...post, videoUrl: videoDeliveryUrl(post.videoUrl) } };';
  assert.equal(next.replace("const { videoDeliveryUrl } = require('./video_delivery');\n", '')
    .replace(nextReturn, oldReturn), fixture);
  assert.equal(prepare('world_uploads.js', next), next);
  assert.equal(prepare('world_uploads.js', next.replace(/\n/g, '\r\n')), next.replace(/\n/g, '\r\n'));
  assert.throws(() => prepare('world_uploads.js', fixture + '// unknown concurrent edit\n'));
  assert.throws(() => prepare('world_uploads.js', next + '// unknown concurrent edit\n'));
  assert.ok(!next.includes('pending_review'));
  const legacy = { exports: {} };
  new Function('require', 'module', 'exports', next)(
    createRequire(require.resolve('../src/world_uploads')), legacy, legacy.exports);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cdn-legacy-upload-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const objects = new Map([['elf:e_test', { id: 'e_test', ownerId: 'u_test', status: 'owned', works: 0 }]]);
  const putOptions = [];
  const store = { transaction: async (_, work) => work({
    get: async (kind, id) => structuredClone(objects.get(kind + ':' + id)),
    put: async (kind, id, value, options) => {
      objects.set(kind + ':' + id, structuredClone(value));
      putOptions.push({ kind, options });
    },
  }) };
  const service = legacy.exports.createWorldUploadService({ store, mediaDir: directory,
    assetBaseUrl: 'https://openelfai.com', ffmpegPath: 'ffmpeg-definitely-missing' });
  const buffer = Buffer.alloc(32768); buffer.write('0000ftypisom');
  const request = { user: { id: 'u_test' }, elfId: 'e_test', environment: 'production',
    caption: 'CDN兼容测试', aiGenerated: 'true', buffer };
  const result = await service.publishUserVideo(request);
  assert.equal(result.reviewState, undefined);
  assert.match(result.post.videoUrl, /^https:\/\/media\.openelfai\.com\/api\/v1\/world-assets\/videos\/u-[a-f0-9]+\.mp4$/);
  const saved = [...objects.entries()].find(([key]) => key.startsWith('post:'))[1];
  assert.equal(saved.videoUrl, result.post.videoUrl.replace('media.openelfai.com', 'openelfai.com'));
  assert.equal(putOptions.find(row => row.kind === 'post').options.state, undefined);
  assert.ok(fs.existsSync(path.join(directory, path.basename(saved.videoUrl))));
  await assert.rejects(() => service.publishUserVideo({ ...request, aiGenerated: undefined }),
    error => error.code === 'AI_GENERATED_REQUIRED');
  await assert.rejects(() => service.publishUserVideo({ ...request, user: { id: 'other_user' } }),
    error => error.code === 'ELF_NOT_OWNED');
});
