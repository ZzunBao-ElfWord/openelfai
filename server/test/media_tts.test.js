'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createTtsService } = require('../src/media/tts');
const { createMediaUsage, dayKey } = require('../src/media/usage');

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

async function tmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'openelf-tts-'));
}

test('未配置上游时能力关闭，调用直接 503', async () => {
  const service = createTtsService({ settings: {}, mediaDir: await tmpDir() });
  assert.equal(service.isEnabled(), false);
  await assert.rejects(() => service.synthesize({ text: '你好' }), /未启用/);
});

test('空文本、超长文本与未知音色都在本地被拒绝', async () => {
  const service = createTtsService({
    settings: { enabled: true, baseUrl: 'http://127.0.0.1:1', apiKey: 'k', maxChars: 10 },
    mediaDir: await tmpDir(),
  });
  await assert.rejects(() => service.synthesize({ text: '   ' }), /不能为空/);
  await assert.rejects(() => service.synthesize({ text: 'x'.repeat(11) }), /超过 10 字/);
  await assert.rejects(() => service.synthesize({ text: '你好', voice: 'unknown' }), /不支持的音色/);
});

test('合成成功落盘 mp3，并返回可播放地址', async () => {
  const requests = [];
  const audio = Buffer.from('ID3 fake mp3 payload');
  const { server, url } = await listen((req, res) => {
    requests.push({ url: req.url, auth: req.headers.authorization });
    res.writeHead(200, { 'content-type': 'audio/mpeg' });
    res.end(audio);
  });
  try {
    const dir = await tmpDir();
    const service = createTtsService({
      settings: { enabled: true, baseUrl: url, apiKey: 'test-key', model: 'tts-1', maxChars: 1000 },
      mediaDir: dir,
      assetBaseUrl: 'https://example.com',
    });
    const result = await service.synthesize({ text: '你好，欢迎来到 OpenElf', voice: 'nova' });
    assert.equal(result.chars, '你好，欢迎来到 OpenElf'.length);
    assert.equal(result.voice, 'nova');
    assert.match(result.audioUrl, /^https:\/\/example\.com\/api\/v1\/world-assets\/audio\/tts_.+\.mp3$/);
    assert.match(requests[0].url, /^\/v1\/audio\/speech$/);
    assert.equal(requests[0].auth, 'Bearer test-key');

    const file = result.audioUrl.split('/').pop();
    const saved = await fs.readFile(path.join(dir, file));
    assert.equal(saved.length, audio.length);
  } finally {
    server.close();
  }
});

test('上游返回非音频内容时按 502 失败', async () => {
  const { server, url } = await listen((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"error":"bad"}');
  });
  try {
    const service = createTtsService({
      settings: { enabled: true, baseUrl: url, apiKey: 'k' },
      mediaDir: await tmpDir(),
    });
    await assert.rejects(() => service.synthesize({ text: '你好' }), /不是音频/);
  } finally {
    server.close();
  }
});

/// 最小内存库：只覆盖媒体日用量表。
function createMemoryDb() {
  const rows = new Map();
  return {
    rows,
    async execute(sql, params) {
      if (sql.includes('FROM media_daily_usage')) {
        const row = rows.get(params[0]);
        return [row ? [row] : [], []];
      }
      if (sql.includes('INSERT INTO media_daily_usage')) {
        const [id, userId, kind, day, units, updatedAt] = params;
        const row = rows.get(id) || { id, user_id: userId, kind, day, calls: 0, units: 0 };
        row.calls += 1;
        row.units += units;
        row.updated_at = updatedAt;
        rows.set(id, row);
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

test('媒体日配额先校验再自增，超出后返回 429', async () => {
  const db = createMemoryDb();
  const usage = createMediaUsage({ db });
  const first = await usage.consume('u_1', 'tts', { limit: 2, units: 100 });
  assert.equal(first.used, 1);
  assert.equal((await usage.consume('u_1', 'tts', { limit: 2, units: 50 })).used, 2);
  await assert.rejects(
    () => usage.consume('u_1', 'tts', { limit: 2 }),
    (error) => error.statusCode === 429,
  );
  const row = db.rows.get(`u_1:tts:${dayKey()}`);
  assert.equal(row.units, 150);
});
