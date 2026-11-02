'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Fastify = require('fastify');

const { registerMcpRoutes } = require('../src/mcp/server');
const { createGeneratorTools } = require('../src/generator/tools');
const { crc32, PNG_SIGNATURE } = require('../src/character/png');
const { generateKey, hashKey } = require('../src/platform/api_key');

const TOOL_NAMES = [
  'fetch_layers',
  'update_weight',
  'generate_preview',
  'generate_batch',
  'download_item',
  'download_batch',
  'submit_work_submission',
];

// 内存版 DB：覆盖 API Key 查表与 generator 三表的 SQL，行为对齐 mysql2 的 [rows] 返回。
function makeDb() {
  const state = { keys: [], weights: [], items: [], submissions: [] };
  async function execute(rawSql, params = []) {
    const sql = String(rawSql).replace(/\s+/g, ' ').trim();
    if (sql.startsWith('SELECT id, user_id, key_hash, revoked_at FROM platform_api_keys')) {
      const rows = state.keys.filter((row) => row.key_prefix === params[0]);
      return [rows.slice(0, 1), []];
    }
    if (sql.startsWith('SELECT layer_id, trait_id, weight FROM generator_weights')) {
      return [state.weights.filter((row) => row.user_id === params[0]), []];
    }
    if (sql.startsWith('INSERT INTO generator_weights')) {
      const [userId, layerId, traitId, weight, updatedAt] = params;
      const found = state.weights.find(
        (row) => row.user_id === userId && row.layer_id === layerId && row.trait_id === traitId,
      );
      if (found) {
        found.weight = weight;
        found.updated_at = updatedAt;
      } else {
        state.weights.push({ user_id: userId, layer_id: layerId, trait_id: traitId, weight, updated_at: updatedAt });
      }
      return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith('INSERT INTO generator_items')) {
      const [id, userId, batchId, idx, seed, traits, rarityScore, rarityTier, imageKey, thumbKey, createdAt] = params;
      state.items.push({
        id, user_id: userId, batch_id: batchId, idx, seed, traits,
        rarity_score: rarityScore, rarity_tier: rarityTier,
        image_key: imageKey, thumb_key: thumbKey, created_at: createdAt,
      });
      return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith('SELECT * FROM generator_items WHERE id = ? AND user_id = ?')) {
      return [state.items.filter((row) => row.id === params[0] && row.user_id === params[1]), []];
    }
    if (sql.startsWith('SELECT * FROM generator_items WHERE user_id = ? AND id IN')) {
      const [userId, ...ids] = params;
      const rows = state.items
        .filter((row) => row.user_id === userId && ids.includes(row.id))
        .sort((a, b) => a.idx - b.idx);
      return [rows, []];
    }
    if (sql.startsWith('INSERT INTO generator_submissions')) {
      const [id, userId, payload, createdAt] = params;
      state.submissions.push({ id, user_id: userId, payload, created_at: createdAt });
      return [{ affectedRows: 1 }, []];
    }
    throw new Error(`unexpected sql: ${sql}`);
  }
  return {
    execute,
    state,
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

async function buildApp(db, workRoot) {
  const app = Fastify({ logger: false });
  const tools = createGeneratorTools({ db, mediaDir: workRoot });
  registerMcpRoutes(app, {
    db,
    routePath: '/mcp/generator',
    serverInfo: { name: 'openelf-generator', version: '1.0.0' },
    tools,
  });
  await app.ready();
  return app;
}

function rpcPayload(method, params, id = 1) {
  return { jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) };
}

async function callTool(app, key, name, args, id = 2) {
  const res = await app.inject({
    method: 'POST',
    url: '/mcp/generator',
    headers: key ? { authorization: `Bearer ${key.plain}` } : {},
    payload: rpcPayload('tools/call', { name, arguments: args }, id),
  });
  return res.json();
}

function resultOf(body) {
  if (body.error) return { error: body.error };
  return { result: body.result?.structuredContent };
}

test('tools/list 暴露 7 个生成器工具', async () => {
  const db = makeDb();
  const key = db.addKey(generateKey());
  const app = await buildApp(db, await fs.mkdtemp(path.join(os.tmpdir(), 'gen-')));

  const res = await app.inject({
    method: 'POST',
    url: '/mcp/generator',
    headers: { authorization: `Bearer ${key.plain}` },
    payload: rpcPayload('tools/list'),
  });
  const body = res.json();
  assert.deepEqual(body.result.tools.map((tool) => tool.name).sort(), TOOL_NAMES.slice().sort());
  await app.close();
});

test('fetch_layers 返回 5 层目录，update_weight 后权重生效', async () => {
  const db = makeDb();
  const key = db.addKey(generateKey());
  const app = await buildApp(db, await fs.mkdtemp(path.join(os.tmpdir(), 'gen-')));

  let body = await callTool(app, key, 'fetch_layers', {});
  let layers = resultOf(body).result.layers;
  assert.equal(layers.length, 5);
  const bg1 = layers[0].traits.find((trait) => trait.id === 'bg1');
  assert.equal(bg1.weight, 30);
  assert.equal(bg1.overridden, false);

  body = await callTool(app, key, 'update_weight', { layerId: 'background', traitId: 'bg1', weight: 5 });
  assert.deepEqual(resultOf(body).result, { ok: true, layerId: 'background', traitId: 'bg1', weight: 5 });

  body = await callTool(app, key, 'fetch_layers', {});
  layers = resultOf(body).result.layers;
  const updated = layers[0].traits.find((trait) => trait.id === 'bg1');
  assert.equal(updated.weight, 5);
  assert.equal(updated.baseWeight, 30);
  assert.equal(updated.overridden, true);
  await app.close();
});

test('update_weight 参数校验：未知图层 / 越界权重 / 未知配件', async () => {
  const db = makeDb();
  const key = db.addKey(generateKey());
  const app = await buildApp(db, await fs.mkdtemp(path.join(os.tmpdir(), 'gen-')));

  let body = await callTool(app, key, 'update_weight', { layerId: 'nope', traitId: 'bg1', weight: 10 });
  assert.equal(resultOf(body).error.code, -32602);

  body = await callTool(app, key, 'update_weight', { layerId: 'background', traitId: 'bg1', weight: 101 });
  assert.equal(resultOf(body).error.code, -32602);

  body = await callTool(app, key, 'update_weight', { layerId: 'background', traitId: 'nope', weight: 10 });
  assert.equal(resultOf(body).error.code, -32602);
  await app.close();
});

test('generate_preview 返回 PNG data URL，同 seed 组合一致', async () => {
  const db = makeDb();
  const key = db.addKey(generateKey());
  const app = await buildApp(db, await fs.mkdtemp(path.join(os.tmpdir(), 'gen-')));

  const first = resultOf(await callTool(app, key, 'generate_preview', {})).result;
  assert.ok(first.imageDataUrl.startsWith('data:image/png;base64,'));
  const png = Buffer.from(first.imageDataUrl.slice('data:image/png;base64,'.length), 'base64');
  assert.ok(png.subarray(0, 8).equals(PNG_SIGNATURE));
  assert.equal(first.combo.length, 5);
  assert.ok(first.rarity.score > 0);
  assert.ok(['common', 'rare', 'epic', 'legendary'].includes(first.rarity.tier));

  const second = resultOf(await callTool(app, key, 'generate_preview', { seed: 'fixed-seed' })).result;
  const third = resultOf(await callTool(app, key, 'generate_preview', { seed: 'fixed-seed' })).result;
  assert.deepEqual(second.combo, third.combo);
  assert.equal(second.seed, 'fixed-seed');
  await app.close();
});

test('权重为 0 的配件在批量生成中不会出现', async () => {
  const db = makeDb();
  const key = db.addKey(generateKey());
  const app = await buildApp(db, await fs.mkdtemp(path.join(os.tmpdir(), 'gen-')));

  // 只留 ey3 一个有效权重，其余全部清零。
  for (const id of ['ey1', 'ey2', 'ey4', 'ey5']) {
    await callTool(app, key, 'update_weight', { layerId: 'eyes', traitId: id, weight: 0 });
  }
  const body = await callTool(app, key, 'generate_batch', { count: 5 });
  const { result } = resultOf(body);
  assert.equal(result.count, 5);
  for (const item of result.items) {
    const eyes = item.traits.find((trait) => trait.layerId === 'eyes');
    assert.equal(eyes.traitId, 'ey3');
  }
  await app.close();
});

test('generate_batch 上限校验与落盘', async () => {
  const db = makeDb();
  const key = db.addKey(generateKey());
  const mediaDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gen-'));
  const app = await buildApp(db, mediaDir);

  let body = await callTool(app, key, 'generate_batch', { count: 101 });
  assert.equal(resultOf(body).error.code, -32602);

  body = await callTool(app, key, 'generate_batch', { count: 2 });
  const { result } = resultOf(body);
  assert.equal(result.count, 2);
  assert.ok(result.batchId);
  assert.equal(db.state.items.length, 2);
  for (const item of result.items) {
    assert.match(item.imageUrl, /^\/api\/v1\/world-assets\/gen-[a-f0-9-]+\.png$/);
    const file = item.imageUrl.replace('/api/v1/world-assets/', '');
    const buf = await fs.readFile(path.join(mediaDir, file));
    assert.ok(buf.subarray(0, 8).equals(PNG_SIGNATURE));
  }
  await app.close();
});

test('download_item 只能取自己的作品', async () => {
  const db = makeDb();
  const key = db.addKey(generateKey(), { userId: 'u1' });
  const other = db.addKey(generateKey(), { userId: 'u2' });
  const app = await buildApp(db, await fs.mkdtemp(path.join(os.tmpdir(), 'gen-')));

  const { result } = resultOf(await callTool(app, key, 'generate_batch', { count: 1 }));
  const id = result.items[0].id;

  const own = resultOf(await callTool(app, key, 'download_item', { id })).result;
  assert.equal(own.id, id);
  assert.ok(own.imageUrl);

  const stolen = await callTool(app, other, 'download_item', { id });
  assert.equal(stolen.result.isError, true);
  assert.equal(stolen.result.structuredContent.error.code, 'ITEM_NOT_FOUND');
  await app.close();
});

test('download_batch 产出合法 STORE zip', async () => {
  const db = makeDb();
  const key = db.addKey(generateKey());
  const mediaDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gen-'));
  const app = await buildApp(db, mediaDir);

  const { result: batch } = resultOf(await callTool(app, key, 'generate_batch', { count: 2 }));
  const ids = batch.items.map((item) => item.id);

  const { result } = resultOf(await callTool(app, key, 'download_batch', { ids }));
  assert.equal(result.count, 2);
  const zipFile = result.zipUrl.replace('/api/v1/world-assets/', '');
  const zip = await fs.readFile(path.join(mediaDir, zipFile));

  // EOCD
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
  const entryCount = zip.readUInt16LE(zip.length - 22 + 10);
  assert.equal(entryCount, 4); // 2 png + 2 json
  const centralSize = zip.readUInt32LE(zip.length - 22 + 12);
  const centralOffset = zip.readUInt32LE(zip.length - 22 + 16);
  assert.equal(centralOffset + centralSize, zip.length - 22);

  // 逐个走 local header，校验 STORE 数据与 CRC
  let offset = 0;
  const names = [];
  for (let i = 0; i < entryCount; i += 1) {
    assert.equal(zip.readUInt32LE(offset), 0x04034b50);
    assert.equal(zip.readUInt16LE(offset + 8), 0); // STORE
    const crc = zip.readUInt32LE(offset + 14);
    const size = zip.readUInt32LE(offset + 18);
    const nameLen = zip.readUInt16LE(offset + 26);
    const name = zip.subarray(offset + 30, offset + 30 + nameLen).toString('utf8');
    const data = zip.subarray(offset + 30 + nameLen, offset + 30 + nameLen + size);
    assert.equal(crc32(data), crc, `CRC 校验失败：${name}`);
    names.push(name);
    offset += 30 + nameLen + size;
  }
  assert.ok(names.some((name) => name.endsWith('.png')));
  assert.ok(names.some((name) => name.endsWith('.json')));
  assert.equal(offset, centralOffset);

  // 超过上限的 ids
  const tooMany = await callTool(app, key, 'download_batch', { ids: Array.from({ length: 101 }, (_, i) => `id-${i}`) });
  assert.equal(resultOf(tooMany).error.code, -32602);
  await app.close();
});

test('submit_work_submission 落库并返回收单编号', async () => {
  const db = makeDb();
  const key = db.addKey(generateKey());
  const app = await buildApp(db, await fs.mkdtemp(path.join(os.tmpdir(), 'gen-')));

  let body = await callTool(app, key, 'submit_work_submission', { payload: 'not-an-object' });
  assert.equal(resultOf(body).error.code, -32602);

  body = await callTool(app, key, 'submit_work_submission', { payload: { title: '测试系列', count: 3 } });
  const { result } = resultOf(body);
  assert.ok(result.submissionId);
  assert.equal(result.received, true);
  assert.equal(db.state.submissions.length, 1);
  assert.equal(db.state.submissions[0].user_id, 'u1');
  await app.close();
});

test('未授权请求返回 401', async () => {
  const db = makeDb();
  const app = await buildApp(db, await fs.mkdtemp(path.join(os.tmpdir(), 'gen-')));
  const body = await callTool(app, null, 'fetch_layers', {});
  assert.equal(body.error.code, -32001);
  await app.close();
});
