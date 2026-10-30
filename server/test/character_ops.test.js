'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Fastify = require('fastify');

const { registerOpsRoutes } = require('../src/character/ops_routes');

// 内存版 DB：只实现运营配件、组合预占与批次三张表用到的 SQL。
function makeDb() {
  const state = {
    parts: new Map(),
    compositions: new Map(),
    batches: [],
  };

  function query(sql) {
    return String(sql).replace(/\s+/g, ' ').trim();
  }

  async function execute(rawSql, params = []) {
    const sql = query(rawSql);

    if (sql.startsWith('INSERT INTO character_parts')) {
      const [id, slot, name, weight, rarity, draw, sort, status] = params;
      if (!state.parts.has(id)) {
        state.parts.set(id, { id, slot, name, weight, rarity, draw, sort, status });
      }
      return [{ affectedRows: 1 }, []];
    }

    if (sql.startsWith("SELECT * FROM character_parts WHERE status = ?")) {
      const rows = [...state.parts.values()]
        .filter((row) => row.status === params[0])
        .sort((left, right) => Number(left.sort) - Number(right.sort) || (left.id < right.id ? -1 : 1));
      return [rows, []];
    }

    if (sql.startsWith('SELECT * FROM character_parts WHERE id = ?')) {
      const row = state.parts.get(params[0]);
      return [row ? [row] : [], []];
    }

    if (sql.startsWith('SELECT * FROM character_parts ORDER BY sort ASC')) {
      const rows = [...state.parts.values()]
        .sort((left, right) => Number(left.sort) - Number(right.sort) || (left.id < right.id ? -1 : 1));
      return [rows, []];
    }

    if (sql.startsWith('UPDATE character_parts SET ')) {
      const setPart = sql.slice('UPDATE character_parts SET '.length, sql.indexOf(' WHERE '));
      const fields = [...setPart.matchAll(/(\w+) = \?/g)].map((match) => match[1]);
      const id = params[params.length - 1];
      const row = state.parts.get(id);
      if (row) fields.forEach((field, index) => { row[field] = params[index]; });
      return [{ affectedRows: row ? 1 : 0 }, []];
    }

    if (sql.startsWith('INSERT INTO character_compositions')) {
      const [hash, ownerId, createdAt] = params;
      if (state.compositions.has(hash)) {
        const error = new Error('duplicate composition');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      state.compositions.set(hash, { card_id: ownerId, created_at: createdAt });
      return [{ affectedRows: 1 }, []];
    }

    if (sql.startsWith('INSERT INTO character_batches')) {
      const [id, name, style, count, seedStart, sheetKey, createdBy, createdAt] = params;
      state.batches.push({
        id, name, style, count, seed_start: seedStart,
        sheet_key: sheetKey, created_by: createdBy, created_at: createdAt,
      });
      return [{ affectedRows: 1 }, []];
    }

    if (sql.startsWith('SELECT * FROM character_batches WHERE id = ?')) {
      return [state.batches.filter((row) => row.id === params[0]), []];
    }

    if (sql.startsWith('SELECT * FROM character_batches ORDER BY created_at DESC LIMIT ?')) {
      const rows = state.batches
        .slice()
        .sort((left, right) => Number(right.created_at) - Number(left.created_at))
        .slice(0, Number(params[0]));
      return [rows, []];
    }

    throw new Error(`unexpected sql: ${sql}`);
  }

  return {
    execute,
    inspect() {
      return state;
    },
  };
}

function tempAssetsDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'character-ops-test-'));
}

const SMALL_RENDER = { width: 128, height: 192, scale: 1, thumbWidth: 64, thumbHeight: 96, thumbScale: 1 };

function pngMagic(buffer) {
  return [...buffer.subarray(0, 8)];
}

async function buildOpsApp(db, { token, assetsDir } = {}) {
  if (token === undefined) delete process.env.OPS_TOKEN;
  else process.env.OPS_TOKEN = token;
  const app = Fastify({ logger: false });
  registerOpsRoutes(app, { db, assetsDir, renderOptions: SMALL_RENDER });
  await app.ready();
  return app;
}

function opsHeaders(token) {
  return { 'x-ops-token': token };
}

test('未配置 OPS_TOKEN 时运营接口返回 503', async () => {
  const app = await buildOpsApp(makeDb());
  try {
    const response = await app.inject({ method: 'GET', url: '/internal/ops/character/parts' });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().code, 'OPS_DISABLED');
  } finally {
    await app.close();
  }
});

test('配置 OPS_TOKEN 后错误令牌返回 401', async () => {
  const app = await buildOpsApp(makeDb(), { token: 'ops-secret' });
  try {
    const response = await app.inject({
      method: 'GET',
      url: '/internal/ops/character/parts',
      headers: opsHeaders('wrong-token'),
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().code, 'UNAUTHORIZED');
  } finally {
    await app.close();
  }
});

test('配件目录默认入库，更新后 listParts 反映新值', async () => {
  const db = makeDb();
  const app = await buildOpsApp(db, { token: 'ops-secret' });
  try {
    const list = await app.inject({
      method: 'GET', url: '/internal/ops/character/parts', headers: opsHeaders('ops-secret'),
    });
    const body = list.json();
    assert.equal(body.slots.length, 9);
    assert.ok(body.comboSpace > 0);
    const background = body.slots.find((item) => item.slot === 'background');
    assert.equal(background.label, '背景');
    assert.ok(background.parts.some((part) => part.id === 'bg_aurora'));

    const updated = await app.inject({
      method: 'PUT',
      url: '/internal/ops/character/parts/bg_aurora',
      headers: opsHeaders('ops-secret'),
      payload: { weight: 77, rarity: 'legendary', status: 'enabled' },
    });
    assert.equal(updated.statusCode, 200);
    assert.equal(updated.json().weight, 77);

    const after = await app.inject({
      method: 'GET', url: '/internal/ops/character/parts', headers: opsHeaders('ops-secret'),
    });
    const part = after.json().slots
      .find((item) => item.slot === 'background')
      .parts.find((item) => item.id === 'bg_aurora');
    assert.equal(part.weight, 77);
    assert.equal(part.rarity, 'legendary');
  } finally {
    await app.close();
  }
});

test('weight 越界与非法 rarity 返回 400，不存在的配件返回 404', async () => {
  const db = makeDb();
  const app = await buildOpsApp(db, { token: 'ops-secret' });
  try {
    for (const payload of [{ weight: 0 }, { weight: 101 }, { rarity: 'godlike' }, { status: 'unknown' }]) {
      const response = await app.inject({
        method: 'PUT',
        url: '/internal/ops/character/parts/bg_aurora',
        headers: opsHeaders('ops-secret'),
        payload,
      });
      assert.equal(response.statusCode, 400);
    }
    const missing = await app.inject({
      method: 'PUT',
      url: '/internal/ops/character/parts/not_exists',
      headers: opsHeaders('ops-secret'),
      payload: { weight: 10 },
    });
    assert.equal(missing.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('批量 count=3 产出 3 个唯一 hash 与合法联系表', async () => {
  const db = makeDb();
  const assetsDir = tempAssetsDir();
  const app = await buildOpsApp(db, { token: 'ops-secret', assetsDir });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/ops/character/batches',
      headers: opsHeaders('ops-secret'),
      payload: { count: 3, style: 'anime', seedStart: 1000, name: '三连测', createdBy: 'qa' },
    });
    assert.equal(response.statusCode, 200);
    const batch = response.json();
    assert.equal(batch.items.length, 3);
    const hashes = batch.items.map((item) => item.compositionHash);
    assert.equal(new Set(hashes).size, 3);
    for (const hash of hashes) assert.match(hash, /^[a-f0-9]{64}$/);

    for (const item of batch.items) {
      assert.ok(fs.existsSync(path.join(assetsDir, item.imageKey)));
      assert.ok(fs.existsSync(path.join(assetsDir, item.thumbKey)));
      assert.equal(item.rarityTier, item.rarityTier.toLowerCase());
    }

    assert.match(batch.sheetKey, /^batch_[a-f0-9]{32}_sheet\.png$/);
    const sheetPath = path.join(assetsDir, batch.sheetKey);
    assert.ok(fs.existsSync(sheetPath));
    const sheet = fs.readFileSync(sheetPath);
    assert.deepEqual(pngMagic(sheet), [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(sheet.readUInt32BE(16), 3 * 256 + 4 * 8);

    assert.ok(fs.existsSync(path.join(assetsDir, 'batches', `${batch.id}.json`)));
    assert.equal(db.inspect().compositions.size, 3);
    assert.equal(db.inspect().batches.length, 1);

    const list = await app.inject({
      method: 'GET',
      url: '/internal/ops/character/batches?limit=20',
      headers: opsHeaders('ops-secret'),
    });
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().batches.length, 1);

    const detail = await app.inject({
      method: 'GET',
      url: `/internal/ops/character/batches/${batch.id}`,
      headers: opsHeaders('ops-secret'),
    });
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.json().items.length, 3);
  } finally {
    await app.close();
  }
});

test('count 超过 200 返回 400', async () => {
  const db = makeDb();
  const app = await buildOpsApp(db, { token: 'ops-secret', assetsDir: tempAssetsDir() });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/ops/character/batches',
      headers: opsHeaders('ops-secret'),
      payload: { count: 201, style: 'anime', seedStart: 1 },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().code, 'INVALID_COUNT');
  } finally {
    await app.close();
  }
});
