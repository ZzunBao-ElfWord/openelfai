'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Fastify = require('fastify');

const { registerMcpRoutes } = require('../src/mcp/server');
const { createVideoTools } = require('../src/mcp/video_tools');
const { generateKey, hashKey } = require('../src/platform/api_key');

const TOOL_NAMES = [
  'probe_media',
  'transcribe_audio',
  'find_hooks',
  'cut_video',
  'burn_subtitles',
  'export_clips',
  'list_clips',
  'delete_clip',
  'concat_clips',
];

// 内存版 DB：只实现 API Key 查表用到的 SQL，行为对齐 MySQL2 的 [rows] 返回。
function makeDb() {
  const state = { keys: [] };
  async function execute(rawSql, params = []) {
    const sql = String(rawSql).replace(/\s+/g, ' ').trim();
    if (sql.startsWith('SELECT id, user_id, key_hash, revoked_at FROM platform_api_keys')) {
      const rows = state.keys.filter((row) => row.key_prefix === params[0]);
      return [rows.slice(0, 1), []];
    }
    throw new Error(`unexpected sql: ${sql}`);
  }
  return {
    execute,
    addKey(key, { userId = 'u1', revokedAt = null } = {}) {
      state.keys.push({
        id: key.id,
        user_id: userId,
        key_prefix: key.prefix,
        key_hash: hashKey(key.plain),
        revoked_at: revokedAt,
      });
      return key;
    },
  };
}

async function buildApp(db, workRoot, overrides = {}) {
  const app = Fastify({ logger: false });
  const tools = createVideoTools({
    db,
    mediaDir: path.join(workRoot, 'media'),
    workDir: path.join(workRoot, 'work'),
    asr: { url: '', baseUrl: '', apiKey: '', model: 'whisper-1' },
    ...overrides,
  });
  registerMcpRoutes(app, {
    db,
    routePath: '/mcp/video',
    serverInfo: { name: 'openelf-video', version: '1.0.0' },
    tools,
  });
  await app.ready();
  return app;
}

function rpcPayload(method, params, id = 1) {
  return { jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) };
}

async function callTool(app, key, name, args, id = 2) {
  return app.inject({
    method: 'POST',
    url: '/mcp/video',
    headers: key ? { authorization: `Bearer ${key.plain}` } : {},
    payload: rpcPayload('tools/call', { name, arguments: args }, id),
  });
}

async function withApp(fn, overrides) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'openelf-video-'));
  const db = makeDb();
  const key = db.addKey(generateKey());
  const app = await buildApp(db, dir, overrides);
  try {
    await fn({ app, db, key, dir });
  } finally {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('initialize 返回 openelf-video 服务信息', async () => {
  await withApp(async ({ app, key }) => {
    const response = await app.inject({
      method: 'POST',
      url: '/mcp/video',
      headers: { authorization: `Bearer ${key.plain}` },
      payload: rpcPayload('initialize'),
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().result.serverInfo.name, 'openelf-video');
    assert.equal(response.json().result.serverInfo.version, '1.0.0');
  });
});

test('tools/list 返回 9 个视频工具且描述不含禁用词', async () => {
  await withApp(async ({ app, key }) => {
    const response = await app.inject({
      method: 'POST',
      url: '/mcp/video',
      headers: { authorization: `Bearer ${key.plain}` },
      payload: rpcPayload('tools/list'),
    });
    assert.equal(response.statusCode, 200);
    const tools = response.json().result.tools;
    assert.equal(tools.length, 9);
    assert.deepEqual(tools.map((tool) => tool.name), TOOL_NAMES);
    for (const tool of tools) {
      assert.equal(tool.inputSchema.type, 'object');
      assert.ok(tool.description.length > 0);
      assert.doesNotMatch(tool.description, /NFT|区块链|链上|身份证/i);
    }
  });
});

test('缺少 API Key 返回 401 与 -32001', async () => {
  await withApp(async ({ app, key }) => {
    const anonymous = await app.inject({
      method: 'POST', url: '/mcp/video', payload: rpcPayload('initialize'),
    });
    assert.equal(anonymous.statusCode, 401);
    assert.equal(anonymous.json().error.code, -32001);

    const revoked = dbRevokedKey();
    const revokedResponse = await callTool(app, revoked, 'list_clips', {});
    assert.equal(revokedResponse.statusCode, 401);
    assert.equal(revokedResponse.json().error.code, -32001);
    assert.ok(key);
  });
});

function dbRevokedKey() {
  const key = generateKey();
  key.revokedAt = 1;
  return key;
}

test('find_hooks 按 segments 返回候选区间', async () => {
  await withApp(async ({ app, key }) => {
    const response = await callTool(app, key, 'find_hooks', {
      count: 2,
      minSec: 10,
      maxSec: 20,
      segments: [
        { start: 0, end: 4, text: '大家好，今天聊一个很多人都会遇到的问题。' },
        { start: 4, end: 9, text: '为什么你每天很忙却没有结果？' },
        { start: 9, end: 14, text: '其实问题不在努力，而在选题。' },
        { start: 14, end: 20, text: '第一，先确定一个主轴，不要什么都做。' },
        { start: 20, end: 26, text: '第二，把重复的动作固定成流程。' },
        { start: 26, end: 30, text: '记住这两点，你的效率会明显提升。' },
      ],
    });
    assert.equal(response.statusCode, 200);
    const result = response.json().result;
    assert.equal(result.isError, undefined);
    const content = result.structuredContent;
    assert.equal(content.count, 2);
    assert.equal(content.hooks.length, 2);
    for (const hook of content.hooks) {
      assert.ok(hook.end - hook.start >= 10);
      assert.ok(hook.end - hook.start <= 20);
      assert.equal(typeof hook.score, 'number');
      assert.ok(hook.reason.length > 0);
    }
  });
});

test('find_hooks 缺少 transcriptId 与 segments 返回 -32602', async () => {
  await withApp(async ({ app, key }) => {
    const response = await callTool(app, key, 'find_hooks', { count: 1 });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().error.code, -32602);
  });
});

test('cut_video 超过 20 段在下载前直接拒绝', async () => {
  await withApp(async ({ app, key }) => {
    const ranges = Array.from({ length: 21 }, (_v, i) => ({ start: i, end: i + 1 }));
    const response = await callTool(app, key, 'cut_video', {
      sourceUrl: 'https://example.com/video.mp4',
      ranges,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().error.code, -32602);
  });
});

test('probe_media 拒绝内网地址', async () => {
  await withApp(async ({ app, key }) => {
    const response = await callTool(app, key, 'probe_media', { sourceUrl: 'http://127.0.0.1/video.mp4' });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().error.code, -32602);
  });
});

test('burn_subtitles 缺少 transcriptId 返回 -32602', async () => {
  await withApp(async ({ app, key }) => {
    const response = await callTool(app, key, 'burn_subtitles', { clipIds: ['vc-abc123'] });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().error.code, -32602);
  });
});

test('list_clips 初始为空', async () => {
  await withApp(async ({ app, key }) => {
    const response = await callTool(app, key, 'list_clips', {});
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().result.structuredContent.count, 0);
  });
});

test('GET /mcp/video 返回 405 且声明 Allow: POST', async () => {
  await withApp(async ({ app }) => {
    const response = await app.inject({ method: 'GET', url: '/mcp/video' });
    assert.equal(response.statusCode, 405);
    assert.equal(response.headers.allow, 'POST');
  });
});

// 模拟百炼的「提交 → 轮询 → 下载结果」三段式响应。
function dashscopeFetch(transcriptionUrl = 'https://1.1.1.1/result.json') {
  const calls = [];
  const json = (payload) => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  const fetchImpl = async (url, init = {}) => {
    const target = String(url);
    calls.push({
      target,
      method: (init.method || 'GET').toUpperCase(),
      headers: init.headers || {},
      body: init.body,
    });
    if (target.includes('/services/audio/asr/transcription')) {
      return json({ output: { task_id: 'task-1', task_status: 'PENDING' } });
    }
    if (target.includes('/tasks/task-1')) {
      return json({
        output: {
          task_status: 'SUCCEEDED',
          results: [{ subtask_status: 'SUCCEEDED', transcription_url: transcriptionUrl }],
        },
      });
    }
    if (target.includes('result.json')) {
      return json({
        properties: { original_duration_in_milliseconds: 12000 },
        transcripts: [{
          text: '今天聊聊选题。为什么你每天很忙却没有结果？',
          sentences: [
            { begin_time: 0, end_time: 4000, text: '今天聊聊选题。' },
            { begin_time: 4000, end_time: 9000, text: '为什么你每天很忙却没有结果？' },
          ],
        }],
      });
    }
    return new Response('not found', { status: 404 });
  };
  return { fetchImpl, calls };
}

test('transcribe_audio 走百炼异步任务并返回句级时间戳', async () => {
  const { fetchImpl, calls } = dashscopeFetch();
  await withApp(async ({ app, key }) => {
    const response = await callTool(app, key, 'transcribe_audio', {
      sourceUrl: 'https://1.1.1.1/video.mp4',
    });
    assert.equal(response.statusCode, 200);
    const content = response.json().result.structuredContent;
    assert.ok(content.transcriptId.startsWith('tr-'));
    assert.equal(content.segmentCount, 2);
    assert.equal(content.durationSec, 12);
    assert.deepEqual(content.segments.map((item) => [item.start, item.end]), [[0, 4], [4, 9]]);

    assert.equal(calls.length, 3);
    const submitted = JSON.parse(calls[0].body);
    assert.equal(submitted.model, 'qwen-audio-3.1-asr-flash-filetrans');
    assert.deepEqual(submitted.input.file_urls, ['https://1.1.1.1/video.mp4']);
    assert.equal(calls[0].headers['x-dashscope-async'], 'enable');
  }, {
    asr: {
      provider: 'dashscope',
      baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
      apiKey: 'sk-test',
      model: 'qwen-audio-3.1-asr-flash-filetrans',
      timeoutMs: 5000,
    },
    fetchImpl,
  });
});

test('transcribe_audio 未配置 ASR 返回 ASR_NOT_CONFIGURED', async () => {
  await withApp(async ({ app, key }) => {
    const response = await callTool(app, key, 'transcribe_audio', {
      sourceUrl: 'https://1.1.1.1/video.mp4',
    });
    assert.equal(response.statusCode, 200);
    const result = response.json().result;
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.error.code, 'ASR_NOT_CONFIGURED');
  });
});
