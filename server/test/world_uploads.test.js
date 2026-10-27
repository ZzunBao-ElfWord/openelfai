const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createWorldUploadService } = require('../src/world_uploads');

/// 内存版 payment_store：只需 transaction/get/put。
function memoryStore() {
  const objects = new Map();
  const tx = {
    async get(kind, id) {
      const row = objects.get(`${kind}:${id}`);
      return row ? JSON.parse(JSON.stringify(row)) : null;
    },
    async put(kind, id, payload) {
      objects.set(`${kind}:${id}`, JSON.parse(JSON.stringify(payload)));
      return payload;
    },
  };
  return {
    transaction: async (_scope, fn) => fn(tx),
    seed(kind, id, payload) {
      objects.set(`${kind}:${id}`, JSON.parse(JSON.stringify(payload)));
    },
    objects,
  };
}

/// 构造一个带 ftyp 头的假 MP4，足够通过魔数校验。
function fakeMp4(size = 32 * 1024) {
  const buffer = Buffer.alloc(size);
  buffer.write('0000ftypisom', 0, 'latin1');
  return buffer;
}

function newService(store) {
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'world-upload-'));
  const service = createWorldUploadService({
    store,
    mediaDir,
    assetBaseUrl: 'https://openelfai.com',
    logger: { warn() {}, info() {} },
    // 假视频抽帧必然失败，正好覆盖“无封面也能发布”的分支。
    ffmpegPath: 'ffmpeg-definitely-missing',
  });
  return { service, mediaDir };
}

function ownedElfStore() {
  const store = memoryStore();
  store.seed('elf', 'elf-1', { id: 'elf-1', ownerId: 'user-1', status: 'owned', works: 3 });
  return store;
}

const BASE = {
  user: { id: 'user-1' },
  environment: 'production',
  elfId: 'elf-1',
  caption: '海面安静，像有人把光调低了。',
  aiGenerated: 'true',
};

test('未声明 AI 生成时拒绝上传', async () => {
  const { service } = newService(ownedElfStore());
  await assert.rejects(
    () => service.publishUserVideo({ ...BASE, aiGenerated: undefined, buffer: fakeMp4() }),
    (error) => error.code === 'AI_GENERATED_REQUIRED',
  );
});

test('非视频内容按魔数拒绝', async () => {
  const { service } = newService(ownedElfStore());
  await assert.rejects(
    () => service.publishUserVideo({ ...BASE, buffer: Buffer.alloc(32 * 1024) }),
    (error) => error.code === 'UNSUPPORTED_MEDIA',
  );
});

test('超过上限时拒绝', async () => {
  const { service } = newService(ownedElfStore());
  await assert.rejects(
    () => service.publishUserVideo({ ...BASE, buffer: fakeMp4(20 * 1024 * 1024 + 1) }),
    (error) => error.code === 'FILE_TOO_LARGE',
  );
});

test('不能上传到别人的 AI 名下', async () => {
  const store = ownedElfStore();
  store.seed('elf', 'elf-2', { id: 'elf-2', ownerId: 'user-2', status: 'owned', works: 0 });
  const { service } = newService(store);
  await assert.rejects(
    () => service.publishUserVideo({ ...BASE, elfId: 'elf-2', buffer: fakeMp4() }),
    (error) => error.code === 'ELF_NOT_OWNED',
  );
});

test('校验通过后落盘并发布一条视频动态', async () => {
  const store = ownedElfStore();
  const { service, mediaDir } = newService(store);
  const { post } = await service.publishUserVideo({ ...BASE, buffer: fakeMp4() });

  assert.equal(post.kind, 'video');
  assert.equal(post.elfId, 'elf-1');
  assert.equal(post.aiGenerated, true);
  assert.match(post.videoUrl, /^https:\/\/openelfai\.com\/api\/v1\/world-assets\/videos\/u-[a-f0-9]+\.mp4$/);
  assert.equal(post.coverUrl, null);
  assert.equal(fs.existsSync(path.join(mediaDir, path.basename(post.videoUrl))), true);

  const saved = [...store.objects.entries()].find(([key]) => key.startsWith('post:'));
  assert.ok(saved, '应写入帖子记录');
  const elf = store.objects.get('elf:elf-1');
  assert.equal(elf.works, 4);
});
