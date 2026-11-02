'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Fastify = require('fastify');

const { registerGeneratorRoutes } = require('../src/generator/routes');

// 内存版 DB：只覆盖画廊 / 我的作品两个查询（含 COUNT），行为对齐 mysql2 的 [rows] 返回。
function makeDb() {
  const state = { items: [], users: [] };

  function pageSlice(rows, sql) {
    const match = /LIMIT (\d+) OFFSET (\d+)/.exec(sql);
    const limit = Number(match[1]);
    const offset = Number(match[2]);
    return rows.slice(offset, offset + limit);
  }

  function byLatest(a, b) {
    if (b.created_at !== a.created_at) return b.created_at - a.created_at;
    return a.id < b.id ? 1 : -1;
  }

  async function execute(rawSql, params = []) {
    const sql = String(rawSql).replace(/\s+/g, ' ').trim();
    if (sql.startsWith('SELECT COUNT(*) AS total FROM generator_items WHERE user_id = ?')) {
      return [[{ total: state.items.filter((row) => row.user_id === params[0]).length }], []];
    }
    if (sql.startsWith('SELECT COUNT(*) AS total FROM generator_items')) {
      return [[{ total: state.items.length }], []];
    }
    if (sql.startsWith('SELECT gi.*, u.nickname AS author_nickname FROM generator_items')) {
      const sorted = state.items.slice().sort(byLatest);
      const rows = pageSlice(sorted, sql).map((row) => {
        const author = state.users.find((user) => user.id === row.user_id);
        return { ...row, author_nickname: author ? author.nickname : null };
      });
      return [rows, []];
    }
    if (sql.startsWith('SELECT * FROM generator_items WHERE user_id = ? ORDER BY created_at DESC')) {
      const sorted = state.items.filter((row) => row.user_id === params[0]).sort(byLatest);
      return [pageSlice(sorted, sql), []];
    }
    throw new Error(`unexpected sql: ${sql}`);
  }

  return { execute, state };
}

// 简化版登录态：只有 Bearer ok 能通过，返回固定用户 u1。
async function authenticate(request) {
  if (String(request.headers.authorization || '') !== 'Bearer ok') {
    const error = new Error('请先登录');
    error.statusCode = 401;
    throw error;
  }
  return { user: { id: 'u1', nickname: '作者甲' } };
}

async function buildApp(db) {
  const app = Fastify({ logger: false });
  registerGeneratorRoutes(app, { db, authenticate });
  await app.ready();
  return app;
}

function makeItem(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    user_id: 'u1',
    batch_id: crypto.randomUUID(),
    idx: 0,
    seed: 'seed-1',
    traits: JSON.stringify([{ layerId: 'eyes', layer: '眼睛', traitId: 'ey3', trait: '星星眼' }]),
    rarity_score: 12.5,
    rarity_tier: 'rare',
    image_key: 'gen-abc-0.png',
    thumb_key: 'gen-abc-0-t.png',
    created_at: 1700000000000,
    ...overrides,
  };
}

test('feed 按最新优先返回全量作品，带作者昵称与图片地址', async () => {
  const db = makeDb();
  db.state.users.push({ id: 'u1', nickname: '作者甲' }, { id: 'u2', nickname: '作者乙' });
  const older = makeItem({ id: 'item-old', user_id: 'u2', created_at: 1700000000000 });
  const newer = makeItem({ id: 'item-new', user_id: 'u1', created_at: 1700000001000 });
  db.state.items.push(older, newer);
  const app = await buildApp(db);

  const res = await app.inject({ method: 'GET', url: '/api/v1/generator/feed' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.total, 2);
  assert.equal(body.limit, 20);
  assert.equal(body.offset, 0);
  assert.deepEqual(body.items.map((item) => item.id), ['item-new', 'item-old']);

  const first = body.items[0];
  assert.equal(first.author.nickname, '作者甲');
  assert.equal(first.imageUrl, '/api/v1/world-assets/gen-abc-0.png');
  assert.equal(first.thumbUrl, '/api/v1/world-assets/gen-abc-0-t.png');
  assert.deepEqual(first.rarity, { score: 12.5, tier: 'rare' });
  assert.deepEqual(first.traits, [{ layerId: 'eyes', layer: '眼睛', traitId: 'ey3', trait: '星星眼' }]);
  assert.equal(first.createdAt, 1700000001000);
  await app.close();
});

test('feed 分页：limit/offset 生效，limit 超上限钳制到 50', async () => {
  const db = makeDb();
  for (let i = 0; i < 60; i += 1) {
    db.state.items.push(makeItem({ id: `item-${String(i).padStart(3, '0')}`, created_at: 1700000000000 + i }));
  }
  const app = await buildApp(db);

  let res = await app.inject({ method: 'GET', url: '/api/v1/generator/feed?limit=5&offset=5' });
  let body = res.json();
  assert.equal(body.items.length, 5);
  assert.equal(body.total, 60);
  // 最新优先：第 6 条应是 created_at 第 55 大（item-054）。
  assert.equal(body.items[0].id, 'item-054');

  res = await app.inject({ method: 'GET', url: '/api/v1/generator/feed?limit=999' });
  body = res.json();
  assert.equal(body.limit, 50);
  assert.equal(body.items.length, 50);

  res = await app.inject({ method: 'GET', url: '/api/v1/generator/feed?limit=abc&offset=-3' });
  body = res.json();
  assert.equal(body.limit, 20);
  assert.equal(body.offset, 0);
  await app.close();
});

test('mine 未登录返回 401', async () => {
  const db = makeDb();
  const app = await buildApp(db);
  const res = await app.inject({ method: 'GET', url: '/api/v1/generator/mine' });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test('mine 只返回本人作品，不泄露他人内容', async () => {
  const db = makeDb();
  db.state.items.push(
    makeItem({ id: 'mine-1', user_id: 'u1', created_at: 1700000000000 }),
    makeItem({ id: 'mine-2', user_id: 'u1', created_at: 1700000001000 }),
    makeItem({ id: 'other-1', user_id: 'u2', created_at: 1700000002000 }),
  );
  const app = await buildApp(db);

  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/generator/mine',
    headers: { authorization: 'Bearer ok' },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.total, 2);
  assert.deepEqual(body.items.map((item) => item.id), ['mine-2', 'mine-1']);
  // mine 不附作者信息（本人无需展示）。
  assert.equal(body.items[0].author, undefined);
  await app.close();
});
