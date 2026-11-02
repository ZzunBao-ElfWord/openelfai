'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createComfyService, fillPlaceholders, DEFAULT_WORKFLOW } = require('../src/media/comfy');

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

function readJson(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => resolve(JSON.parse(raw || '{}')));
  });
}

async function tmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'openelf-comfy-'));
}

test('占位替换保持类型：数字占位替换后仍是数字', () => {
  const vars = { __SEED__: 42, __PROMPT__: '一只猫', __WIDTH__: 1024 };
  const filled = fillPlaceholders(DEFAULT_WORKFLOW, vars);
  assert.equal(filled['3'].inputs.seed, 42);
  assert.equal(filled['5'].inputs.width, 1024);
  assert.equal(filled['6'].inputs.text, '一只猫');
  // 未提供的占位保持原样，交给运维在 workflow 模板里自查。
  assert.equal(filled['4'].inputs.ckpt_name, '__CHECKPOINT__');
});

test('未配置 baseUrl 时能力关闭', async () => {
  const service = createComfyService({ settings: {}, mediaDir: await tmpDir() });
  assert.equal(service.isEnabled(), false);
  await assert.rejects(() => service.generateImage({ prompt: '一只猫' }), /未启用/);
});

test('prompt 为空或超长在本地被拒绝', async () => {
  const service = createComfyService({
    settings: { enabled: true, baseUrl: 'http://127.0.0.1:1' },
    mediaDir: await tmpDir(),
  });
  await assert.rejects(() => service.generateImage({ prompt: '  ' }), /prompt 不能为空/);
  await assert.rejects(() => service.generateImage({ prompt: 'x'.repeat(501) }), /超过 500 字/);
});

test('完整出图链路：提交 → 轮询 history → 取图落盘', async () => {
  const calls = [];
  const png = Buffer.from('fake png bytes');
  let polls = 0;
  const { server, url } = await listen(async (req, res) => {
    calls.push(req.url);
    if (req.url === '/prompt') {
      const body = await readJson(req);
      // 校验占位确实被替换成了运行时值。
      assert.equal(body.prompt['6'].inputs.text, '赛博朋克城市');
      assert.equal(body.prompt['3'].inputs.seed, 12345);
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ prompt_id: 'p_1' }));
    }
    if (req.url === '/history/p_1') {
      polls += 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      // 第一次还没出图，模拟真实轮询。
      if (polls <= 1) return res.end('{}');
      return res.end(JSON.stringify({
        p_1: { outputs: { 9: { images: [{ filename: 'out.png', subfolder: 'x', type: 'output' }] } } },
      }));
    }
    if (req.url.startsWith('/view')) {
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end(png);
    }
    res.writeHead(404);
    res.end();
  });
  try {
    const dir = await tmpDir();
    const service = createComfyService({
      settings: { enabled: true, baseUrl: url, pollMs: 500, timeoutMs: 5000 },
      mediaDir: dir,
      assetBaseUrl: 'https://example.com',
    });
    const result = await service.generateImage({ prompt: '赛博朋克城市', seed: 12345 });
    assert.equal(result.seed, 12345);
    assert.equal(result.promptId, 'p_1');
    assert.match(result.imageUrl, /^https:\/\/example\.com\/api\/v1\/world-assets\/comfy_.+\.png$/);

    const file = result.imageUrl.split('/').pop();
    const saved = await fs.readFile(path.join(dir, file));
    assert.equal(saved.length, png.length);
    assert.ok(polls >= 2);
  } finally {
    server.close();
  }
});

test('轮询超时按 502 失败，不无限等待', async () => {
  const { server, url } = await listen((req, res) => {
    if (req.url === '/prompt') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ prompt_id: 'p_timeout' }));
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  try {
    const service = createComfyService({
      settings: { enabled: true, baseUrl: url, pollMs: 500, timeoutMs: 1200 },
      mediaDir: await tmpDir(),
    });
    await assert.rejects(
      () => service.generateImage({ prompt: '一只猫' }),
      (error) => error.statusCode === 502 && /超时/.test(error.message),
    );
  } finally {
    server.close();
  }
});
