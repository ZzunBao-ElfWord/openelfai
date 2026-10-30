'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Fastify = require('fastify');

const { registerMcpRoutes } = require('../src/mcp/server');
const { generateKey, hashKey } = require('../src/platform/api_key');

const TOOL_NAMES = [
  'fetch_layers',
  'generate_preview',
  'generate_batch',
  'create_character',
  'generate_character',
  'get_character',
  'list_my_characters',
];

// 内存版 DB：只实现 API Key 查表用到的 SQL，行为对齐 MySQL2 的 [rows] 返回。
function makeDb() {
  const state = { keys: [] };

  function query(sql) {
    return String(sql).replace(/\s+/g, ' ').trim();
  }

  async function execute(rawSql, params = []) {
    const sql = query(rawSql);

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
    inspect() {
      return state;
    },
  };
}

async function buildApp(db) {
  const app = Fastify({ logger: false });
  registerMcpRoutes(app, { db });
  await app.ready();
  return app;
}

function rpcPayload(method, params, id = 1) {
  return { jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) };
}

async function callTool(app, key, name, args, id = 2) {
  return app.inject({
    method: 'POST',
    url: '/mcp',
    headers: key ? { authorization: `Bearer ${key.plain}` } : {},
    payload: rpcPayload('tools/call', { name, arguments: args }, id),
  });
}

test('initialize 返回协议版本、工具能力与服务信息', async () => {
  const db = makeDb();
  const key = db.addKey(generateKey());
  const app = await buildApp(db);
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { authorization: `Bearer ${key.plain}` },
      payload: rpcPayload('initialize'),
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.jsonrpc, '2.0');
    assert.equal(body.id, 1);
    assert.equal(body.result.protocolVersion, '2024-11-05');
    assert.ok(body.result.capabilities.tools);
    assert.equal(body.result.serverInfo.name, 'openelf-character');
    assert.equal(body.result.serverInfo.version, '0.1.0');
  } finally {
    await app.close();
  }
});

test('tools/list 返回 7 个工具且描述不含禁用词', async () => {
  const db = makeDb();
  const key = db.addKey(generateKey());
  const app = await buildApp(db);
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { authorization: `Bearer ${key.plain}` },
      payload: rpcPayload('tools/list'),
    });
    assert.equal(response.statusCode, 200);
    const tools = response.json().result.tools;
    assert.equal(tools.length, 7);
    assert.deepEqual(tools.map((tool) => tool.name), TOOL_NAMES);
    for (const tool of tools) {
      assert.equal(tool.inputSchema.type, 'object');
      assert.ok(tool.description.length > 0);
      assert.doesNotMatch(tool.description, /NFT|区块链|链上|身份证/i);
    }
  } finally {
    await app.close();
  }
});

test('缺少或无效的 API Key 返回 401 与 -32001', async () => {
  const db = makeDb();
  const key = generateKey();
  db.addKey(key, { revokedAt: 123 });
  const app = await buildApp(db);
  try {
    const anonymous = await app.inject({
      method: 'POST', url: '/mcp', payload: rpcPayload('initialize', undefined, 'abc'),
    });
    assert.equal(anonymous.statusCode, 401);
    const body = anonymous.json();
    assert.equal(body.jsonrpc, '2.0');
    assert.equal(body.id, 'abc');
    assert.equal(body.error.code, -32001);

    const revoked = await callTool(app, key, 'fetch_layers', {});
    assert.equal(revoked.statusCode, 401);
    assert.equal(revoked.json().error.code, -32001);

    const wrong = await callTool(app, generateKey(), 'fetch_layers', {});
    assert.equal(wrong.statusCode, 401);
  } finally {
    await app.close();
  }
});

test('未知工具返回 -32601', async () => {
  const db = makeDb();
  const key = db.addKey(generateKey());
  const app = await buildApp(db);
  try {
    const response = await callTool(app, key, 'mint_character', {});
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().error.code, -32601);
  } finally {
    await app.close();
  }
});

test('generate_preview 返回可解析的 PNG dataUrl 且不落库', async () => {
  const db = makeDb();
  const key = db.addKey(generateKey());
  const app = await buildApp(db);
  try {
    const response = await callTool(app, key, 'generate_preview', { style: 'general', seed: 42 });
    assert.equal(response.statusCode, 200);
    const result = response.json().result;
    assert.equal(result.isError, undefined);
    const content = result.structuredContent;
    assert.match(content.thumbDataUrl, /^data:image\/png;base64,/);
    const png = Buffer.from(content.thumbDataUrl.split(',')[1], 'base64');
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.match(content.compositionHash, /^[a-f0-9]{64}$/);
    assert.equal(content.planted, false);
    assert.equal(typeof content.rarityScore, 'number');
    assert.equal(typeof content.rarityTier, 'string');
    assert.equal(result.content[0].type, 'text');
    assert.deepEqual(JSON.parse(result.content[0].text), content);
  } finally {
    await app.close();
  }
});

test('generate_batch count=11 超出对外上限返回 -32602', async () => {
  const db = makeDb();
  const key = db.addKey(generateKey());
  const app = await buildApp(db);
  try {
    const response = await callTool(app, key, 'generate_batch', { count: 11 });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().error.code, -32602);
  } finally {
    await app.close();
  }
});

test('GET /mcp 返回 405 且声明 Allow: POST', async () => {
  const app = await buildApp(makeDb());
  try {
    const response = await app.inject({ method: 'GET', url: '/mcp' });
    assert.equal(response.statusCode, 405);
    assert.equal(response.headers.allow, 'POST');
  } finally {
    await app.close();
  }
});

test('notifications/initialized 返回 202 空响应', async () => {
  const db = makeDb();
  const key = db.addKey(generateKey());
  const app = await buildApp(db);
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { authorization: `Bearer ${key.plain}` },
      payload: rpcPayload('notifications/initialized'),
    });
    assert.equal(response.statusCode, 202);
    assert.equal(response.body, '');
  } finally {
    await app.close();
  }
});
