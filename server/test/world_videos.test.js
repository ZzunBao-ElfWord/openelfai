const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createWorldVideoService, PENDING_ID } = require('../src/world_videos');

/// 内存版 payment_store：只为视频引擎用到的最小能力（transaction/get/put/list）。
function memoryStore() {
  const objects = new Map();
  function keyOf(kind, id) {
    return `${kind}:${id}`;
  }
  const tx = {
    async get(kind, id) {
      const row = objects.get(keyOf(kind, id));
      return row ? JSON.parse(JSON.stringify(row)) : null;
    },
    async put(kind, id, payload) {
      objects.set(keyOf(kind, id), JSON.parse(JSON.stringify(payload)));
      return payload;
    },
    async list(kind) {
      const prefix = `${kind}:`;
      return [...objects.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([, value]) => JSON.parse(JSON.stringify(value)));
    },
  };
  return {
    objects,
    transaction: async (_scope, fn) => fn(tx),
    seed(kind, id, payload) {
      objects.set(keyOf(kind, id), JSON.parse(JSON.stringify(payload)));
    },
  };
}

/// 12:00 北京时间，已过 9 点档位但未到 15 点。
const NOON = Date.parse('2026-10-27T04:00:00Z');

function newService({ store, ark, upstream, settings = {} }) {
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'world-video-'));
  const service = createWorldVideoService({
    store,
    ark,
    upstream: upstream || { chatCompletions: async () => ({ choices: [{ message: { content: '海面安静，像有人把光调低了。' } }] }) },
    mediaDir,
    settings: { perDay: 3, duration: 12, slots: [9, 15, 21], ...settings },
    logger: { warn() {}, info() {} },
    assetBaseUrl: 'https://openelfai.com',
    fetchImpl: async () => new Response(Buffer.alloc(4096), { status: 200 }),
  });
  return { service, mediaDir };
}

test('未到首个档位时不创建视频任务', async () => {
  const store = memoryStore();
  let created = 0;
  const ark = {
    createTask: async () => { created++; return { id: 't1' }; },
    getTask: async () => ({ status: 'running' }),
  };
  const { service } = newService({ store, ark });
  const morning = Date.parse('2026-10-26T23:30:00Z'); // 北京 07:30
  const result = await service.cycle({ now: morning });
  assert.equal(result.due, 0);
  assert.equal(created, 0);
});

test('过了档位后创建任务，并写入待轮询记录', async () => {
  const store = memoryStore();
  const calls = [];
  const ark = {
    createTask: async (body) => {
      calls.push(body);
      return { id: 'cgt-test-1' };
    },
    getTask: async () => ({ status: 'running' }),
  };
  const { service } = newService({ store, ark });
  const result = await service.cycle({ now: NOON });
  assert.equal(result.created, 'cgt-test-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].duration, 12);
  assert.equal(calls[0].ratio, 'adaptive');
  assert.equal(calls[0].content[1].role, 'first_frame');
  assert.match(calls[0].content[1].image_url.url, /jingling\.jpg$/);
  const job = store.objects.get(`video_job:${PENDING_ID}`);
  assert.equal(job.taskId, 'cgt-test-1');
  assert.equal(job.state, 'running');

  // 同一周期再次进入只轮询，不重复建任务。
  await service.cycle({ now: NOON });
  assert.equal(calls.length, 1);
});

test('任务成功后下载并发布成视频动态', async () => {
  const store = memoryStore();
  store.seed('elf', 'off_doubao', { id: 'off_doubao', isOfficial: true, works: 4 });
  const ark = {
    createTask: async () => ({ id: 'cgt-test-2' }),
    getTask: async () => ({
      status: 'succeeded',
      content: { video_url: 'https://ark.example.com/v.mp4?sign=1' },
    }),
  };
  const { service, mediaDir } = newService({ store, ark });
  await service.cycle({ now: NOON });
  const published = await service.cycle({ now: NOON });
  assert.ok(published.published, '应发布一条视频动态');
  const posts = await store.transaction('Production', async (tx) => tx.list('post'));
  assert.equal(posts.length, 1);
  const post = posts[0];
  assert.equal(post.kind, 'video');
  assert.equal(post.vendorAgent, 'volcengine');
  assert.equal(post.elfId, 'off_doubao');
  assert.equal(post.videoDuration, 12);
  assert.match(post.videoUrl, /^https:\/\/openelfai\.com\/api\/v1\/world-assets\/videos\/doubao-\d{4}-\d{2}-\d{2}-[a-z0-9]+\.mp4$/);
  const file = path.basename(new URL(post.videoUrl).pathname);
  assert.ok(fs.existsSync(path.join(mediaDir, file)), '视频文件应已落盘');
  const elf = await store.transaction('Production', async (tx) => tx.get('elf', 'off_doubao'));
  assert.equal(elf.works, 5);
  const job = store.objects.get(`video_job:${PENDING_ID}`);
  assert.equal(job.state, 'done');
});

test('任务失败时清理待轮询记录并进入冷却', async () => {
  const store = memoryStore();
  let created = 0;
  const ark = {
    createTask: async () => { created++; return { id: `cgt-${created}` }; },
    getTask: async () => ({ status: 'failed', error: { message: 'content blocked' } }),
  };
  const { service } = newService({ store, ark, settings: { failureCooldownMs: 30 * 60000 } });
  await service.cycle({ now: NOON });
  const result = await service.cycle({ now: NOON + 1000 });
  assert.equal(result.failed, 'task');
  // 冷却期内不再建新任务。
  const cooling = await service.cycle({ now: NOON + 2000 });
  assert.equal(cooling.cooling, true);
  assert.equal(created, 1);
});

test('当天配额发满后不再创建', async () => {
  const store = memoryStore();
  const now = Date.parse('2026-10-27T13:30:00Z'); // 北京 21:30，三个档位全部放开
  for (let i = 0; i < 3; i++) {
    store.seed('post', `p_existing_${i}`, {
      id: `p_existing_${i}`,
      vendorAgent: 'volcengine',
      kind: 'video',
      createdAt: new Date(now - (i + 1) * 3600000).toISOString(),
    });
  }
  let created = 0;
  const ark = {
    createTask: async () => { created++; return { id: 'x' }; },
    getTask: async () => ({ status: 'running' }),
  };
  const { service } = newService({ store, ark });
  const result = await service.cycle({ now });
  assert.equal(result.due, 3);
  assert.equal(result.done, 3);
  assert.equal(created, 0);
});
