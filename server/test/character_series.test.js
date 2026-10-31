'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Fastify = require('fastify');

const parts = require('../src/character/parts');
const {
  createSeries,
  renderChunk,
  authorizeSeries,
  mintChunk,
  retryFailed,
  getSeries,
} = require('../src/character/series');
const { createLinkspriteClient } = require('../src/character/linksprite');
const { registerOpsRoutes } = require('../src/character/ops_routes');

const SMALL_RENDER = { width: 128, height: 192, scale: 1, thumbWidth: 64, thumbHeight: 96, thumbScale: 1 };

function query(sql) {
  return String(sql).replace(/\s+/g, ' ').trim();
}

// 内存版 DB：覆盖系列表、明细表、组合预占、共享 tokenId 分配器与 UGC 铸造记录。
function makeDb() {
  const state = {
    series: [],
    items: [],
    mints: [],
    compositions: new Set(),
    tokenAlloc: null,
  };

  async function execute(rawSql, params = []) {
    const sql = query(rawSql);

    if (sql.startsWith('INSERT INTO character_series ')) {
      const [
        id, name, style, total, seedStart, coverKey, ipOwner, contractNo, scope, maxMint,
        startTime, endTime, authId, authStatus, status, treasuryAddress, createdBy,
        createdAt, updatedAt,
      ] = params;
      state.series.push({
        id, name, style, total, seed_start: seedStart, cover_key: coverKey,
        ip_owner: ipOwner, contract_no: contractNo, scope, max_mint: maxMint,
        start_time: startTime, end_time: endTime, auth_id: authId, auth_status: authStatus,
        status, treasury_address: treasuryAddress, created_by: createdBy,
        created_at: createdAt, updated_at: updatedAt,
      });
      return [{ affectedRows: 1 }, []];
    }

    if (sql.startsWith('SELECT * FROM character_series WHERE id = ?')) {
      return [state.series.filter((row) => row.id === params[0]), []];
    }

    if (sql.startsWith('SELECT * FROM character_series ORDER BY created_at DESC LIMIT ?')) {
      const rows = state.series.slice().sort((a, b) => Number(b.created_at) - Number(a.created_at))
        .slice(0, Number(params[0]));
      return [rows, []];
    }

    if (sql.startsWith('UPDATE character_series SET ')) {
      const setPart = sql.slice('UPDATE character_series SET '.length, sql.indexOf(' WHERE '));
      const fields = [...setPart.matchAll(/(\w+) = \?/g)].map((match) => match[1]);
      const id = params[params.length - 1];
      const row = state.series.find((item) => item.id === id);
      if (row) fields.forEach((field, index) => { row[field] = params[index]; });
      return [{ affectedRows: row ? 1 : 0 }, []];
    }

    if (sql.startsWith('SELECT MAX(idx) AS max_idx FROM character_series_items WHERE series_id = ?')) {
      const rows = state.items.filter((row) => row.series_id === params[0]);
      const max = rows.reduce((value, row) => Math.max(value, Number(row.idx)), -1);
      return [[{ max_idx: rows.length ? max : null }], []];
    }

    if (sql.startsWith('INSERT INTO character_series_items')) {
      const [
        id, seriesId, idx, seed, compositionHash, imageKey, thumbKey, workHash,
        status, createdAt, updatedAt,
      ] = params;
      if (state.items.some((row) => row.series_id === seriesId && row.idx === idx)) {
        const error = new Error('duplicate idx');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      state.items.push({
        id, series_id: seriesId, idx: Number(idx), seed: Number(seed),
        composition_hash: compositionHash, image_key: imageKey, thumb_key: thumbKey,
        work_hash: workHash, token_id: null, tx_hash: null, status,
        error: null, created_at: createdAt, updated_at: updatedAt,
      });
      return [{ affectedRows: 1 }, []];
    }

    if (sql.startsWith('SELECT * FROM character_series_items WHERE series_id = ? ORDER BY idx ASC')) {
      const rows = state.items.filter((row) => row.series_id === params[0])
        .sort((a, b) => Number(a.idx) - Number(b.idx));
      return [rows, []];
    }

    if (sql.startsWith('SELECT * FROM character_series_items WHERE series_id = ? AND status = ? ORDER BY idx ASC LIMIT ?')) {
      const rows = state.items
        .filter((row) => row.series_id === params[0] && row.status === params[1])
        .sort((a, b) => Number(a.idx) - Number(b.idx))
        .slice(0, Number(params[2]));
      return [rows, []];
    }

    if (sql.startsWith('SELECT status, COUNT(*) AS count FROM character_series_items WHERE series_id = ? GROUP BY status')) {
      const counts = new Map();
      for (const row of state.items.filter((item) => item.series_id === params[0])) {
        counts.set(row.status, (counts.get(row.status) || 0) + 1);
      }
      return [[...counts.entries()].map(([status, count]) => ({ status, count })), []];
    }

    if (sql.startsWith('UPDATE character_series_items SET ')) {
      const setPart = sql.slice('UPDATE character_series_items SET '.length, sql.indexOf(' WHERE '));
      const fields = [...setPart.matchAll(/(\w+) = \?/g)].map((match) => match[1]);
      const id = params[params.length - 1];
      const row = state.items.find((item) => item.id === id);
      if (row) fields.forEach((field, index) => { row[field] = params[index]; });
      return [{ affectedRows: row ? 1 : 0 }, []];
    }

    if (sql.startsWith('SELECT next_id FROM character_token_alloc WHERE id = 1 FOR UPDATE')) {
      return [state.tokenAlloc === null ? [] : [{ next_id: state.tokenAlloc }], []];
    }

    if (sql.startsWith('SELECT MAX(token_id) AS max_token FROM character_mints')) {
      const max = state.mints.reduce((value, row) => Math.max(value, Number(row.token_id) || 0), 0);
      return [[{ max_token: max || null }], []];
    }

    if (sql.startsWith('SELECT MAX(token_id) AS max_token FROM character_series_items')) {
      const max = state.items.reduce((value, row) => Math.max(value, Number(row.token_id) || 0), 0);
      return [[{ max_token: max || null }], []];
    }

    if (sql.startsWith('INSERT INTO character_token_alloc (id, next_id)')) {
      state.tokenAlloc = Number(params[0]);
      return [{ affectedRows: 1 }, []];
    }

    if (sql.startsWith('UPDATE character_token_alloc SET next_id = ? WHERE id = 1')) {
      state.tokenAlloc = Number(params[0]);
      return [{ affectedRows: 1 }, []];
    }

    if (sql.startsWith('INSERT INTO character_compositions')) {
      const [hash, ownerId, createdAt] = params;
      if (state.compositions.has(hash)) {
        const error = new Error('duplicate composition');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      state.compositions.add(hash);
      return [{ affectedRows: 1 }, []];
    }

    throw new Error(`unexpected sql: ${sql}`);
  }

  return {
    execute,
    seedMint(tokenId) {
      state.mints.push({ token_id: Number(tokenId), card_id: 'ugc_existing', status: 'minted' });
    },
    inspect() {
      return state;
    },
  };
}

function tempAssetsDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'character-series-test-'));
}

function renderOptions() {
  return { assetsDir: tempAssetsDir(), renderOptions: SMALL_RENDER, catalog: parts.getCatalog() };
}

async function buildReadySeries(db, { total = 3, seedStart = 1000, options } = {}) {
  const series = await createSeries(db, {
    name: `系列-${total}`, total, style: 'anime', seedStart, createdBy: 'qa',
  });
  await renderChunk(db, { seriesId: series.id, limit: total }, options);
  return getSeries(db, series.id);
}

function makeClient({ enabled = true, faults } = {}) {
  const state = {
    registerCalls: 0,
    authId: 7,
    validCalls: [],
    mintCalls: [],
    txCounter: 0,
  };
  const failure = faults || { failTokenIds: new Set() };
  return {
    enabled,
    state,
    faults: failure,
    async registerAuth(payload) {
      state.registerCalls += 1;
      state.lastRegister = payload;
      return { txHash: '0x' + '1'.repeat(64), status: 0, blockNumber: 1 };
    },
    async findAuthId({ contractNo, workHash }) {
      return { authId: state.authId, record: { contractNo, workHash } };
    },
    async isAuthValid(authId) {
      state.validCalls.push(Number(authId));
      return true;
    },
    async mintB2B(args) {
      state.mintCalls.push(args);
      if (failure.failTokenIds.has(Number(args.tokenId))) {
        const error = new Error('链上铸造失败：授权额度不足');
        error.statusCode = 502;
        error.code = 'CHAIN_MINT_FAILED';
        throw error;
      }
      state.txCounter += 1;
      return { txHash: '0x' + String(state.txCounter).padStart(64, '0'), status: 0 };
    },
  };
}

const AUTHORIZE = {
  ipOwner: 'IP 权利方',
  contractNo: 'HT-2026-001',
  scope: 1,
  startTime: 1,
  endTime: 2 ** 40,
  maxMint: 100,
};

function setTreasury(value) {
  if (value === undefined) delete process.env.PLATFORM_TREASURY_ADDRESS;
  else process.env.PLATFORM_TREASURY_ADDRESS = value;
}

test('渲染分片按 idx 递增、不重复，全部完成后状态为 ready 且 hash 唯一', async () => {
  const db = makeDb();
  const options = renderOptions();
  const series = await createSeries(db, { name: '递增系列', total: 4, style: 'anime', seedStart: 1000 });

  const first = await renderChunk(db, { seriesId: series.id, limit: 2 }, options);
  assert.equal(first.rendered, 2);
  assert.equal(first.series.status, 'draft');
  assert.equal(first.remaining, 2);

  const mid = await getSeries(db, series.id);
  assert.deepEqual(mid.items.map((item) => item.idx), [0, 1]);
  assert.equal(new Set(mid.items.map((item) => item.compositionHash)).size, 2);

  const second = await renderChunk(db, { seriesId: series.id, limit: 2 }, options);
  assert.equal(second.rendered, 2);
  assert.equal(second.series.status, 'ready');

  const detail = await getSeries(db, series.id);
  assert.deepEqual(detail.items.map((item) => item.idx), [0, 1, 2, 3]);
  assert.equal(new Set(detail.items.map((item) => item.compositionHash)).size, 4);
  assert.equal(detail.progress.pending, 4);
  for (const item of detail.items) {
    assert.ok(fs.existsSync(path.join(options.assetsDir, item.imageKey)));
    assert.ok(fs.existsSync(path.join(options.assetsDir, item.thumbKey)));
    assert.match(item.imageUrl, /^\/api\/v1\/character-assets\/char_[a-f0-9]{64}\.png$/);
  }
});

test('maxMint 小于 total 拒绝授权；授权成功后写入 auth_id 与 registered 状态', async () => {
  const db = makeDb();
  const options = renderOptions();
  const series = await buildReadySeries(db, { total: 2, options });
  const client = makeClient();

  await assert.rejects(
    () => authorizeSeries(db, { seriesId: series.id, client, ...AUTHORIZE, maxMint: 1 }),
    (error) => error.statusCode === 409 && error.code === 'INVALID_MAX_MINT',
  );
  assert.equal(client.state.registerCalls, 0);
  assert.equal(db.inspect().series[0].auth_status, 'none');

  const authorized = await authorizeSeries(db, { seriesId: series.id, client, ...AUTHORIZE, maxMint: 5 });
  assert.equal(authorized.authId, 7);
  assert.equal(authorized.authStatus, 'registered');
  assert.equal(client.state.registerCalls, 1);
  assert.equal(db.inspect().series[0].auth_id, 7);
});

test('系列铸造分配连续 tokenId，且不占用已有 UGC token', async () => {
  const db = makeDb();
  const options = renderOptions();
  setTreasury('0xtreasury');
  try {
    const series = await buildReadySeries(db, { total: 3, options });
    // 先构造一条 UGC 已占用 token_id=100 的记录。
    db.seedMint(100);
    const client = makeClient();
    await authorizeSeries(db, { seriesId: series.id, client, ...AUTHORIZE, maxMint: 10 });

    const result = await mintChunk(db, { seriesId: series.id, limit: 50, client }, options);
    assert.equal(result.minted, 3);
    assert.equal(result.failed, 0);
    assert.equal(result.progress.minted, 3);
    assert.equal(result.series.status, 'minted');

    const detail = await getSeries(db, series.id);
    assert.deepEqual(detail.items.map((item) => item.tokenId), [101, 102, 103]);
    assert.equal(new Set(detail.items.map((item) => item.txHash)).size, 3);
    assert.equal(db.inspect().tokenAlloc, 104);
  } finally {
    setTreasury(undefined);
  }
});

test('单条失败只记 failed 并继续；retry 只重跑 failed 明细', async () => {
  const db = makeDb();
  const options = renderOptions();
  setTreasury('0xtreasury');
  try {
    const series = await buildReadySeries(db, { total: 3, options });
    const client = makeClient({ faults: { failTokenIds: new Set([2]) } });
    await authorizeSeries(db, { seriesId: series.id, client, ...AUTHORIZE, maxMint: 10 });

    const first = await mintChunk(db, { seriesId: series.id, limit: 50, client }, options);
    assert.equal(first.minted, 2);
    assert.equal(first.failed, 1);
    assert.equal(first.progress.failed, 1);
    assert.equal(first.series.status, 'failed');

    const afterFirst = await getSeries(db, series.id);
    const failedItem = afterFirst.items.find((item) => item.status === 'failed');
    assert.equal(failedItem.tokenId, 2);
    assert.match(failedItem.error, /链上铸造失败/);
    assert.equal(client.state.mintCalls.length, 3);

    client.faults.failTokenIds.clear();
    const retried = await retryFailed(db, { seriesId: series.id, limit: 50, client }, options);
    assert.equal(retried.minted, 1);
    assert.equal(retried.series.status, 'minted');
    assert.equal(retried.progress.minted, 3);
    // 只重跑失败的那一条，不重复铸造已成功明细。
    assert.equal(client.state.mintCalls.length, 4);

    const detail = await getSeries(db, series.id);
    assert.equal(detail.items.every((item) => item.status === 'minted'), true);
    assert.deepEqual(detail.items.map((item) => item.tokenId), [1, 2, 3]);
  } finally {
    setTreasury(undefined);
  }
});

test('链未配置返回 503 CHAIN_DISABLED；未配接收地址返回 503 TREASURY_NOT_CONFIGURED', async () => {
  const db = makeDb();
  const options = renderOptions();
  setTreasury(undefined);
  try {
    const series = await buildReadySeries(db, { total: 1, options });

    const disabled = createLinkspriteClient({ baseUrl: '', apiKey: '' });
    await assert.rejects(
      () => mintChunk(db, { seriesId: series.id, limit: 10, client: disabled }, options),
      (error) => error.statusCode === 503 && error.code === 'CHAIN_DISABLED',
    );

    const client = makeClient();
    await assert.rejects(
      () => mintChunk(db, { seriesId: series.id, limit: 10, client }, options),
      (error) => error.statusCode === 503 && error.code === 'TREASURY_NOT_CONFIGURED',
    );
    assert.equal(db.inspect().tokenAlloc, null, '失败时不得占用 tokenId');
  } finally {
    setTreasury(undefined);
  }
});

test('运营接口 GET /series/:id 返回相对 imageUrl / thumbUrl', async () => {
  const db = makeDb();
  const options = renderOptions();
  const previous = process.env.OPS_TOKEN;
  process.env.OPS_TOKEN = 'ops-secret';
  const app = Fastify({ logger: false });
  registerOpsRoutes(app, { db, assetsDir: options.assetsDir, renderOptions: SMALL_RENDER, chainClient: makeClient() });
  await app.ready();
  try {
    const series = await buildReadySeries(db, { total: 2, options });
    const response = await app.inject({
      method: 'GET',
      url: `/internal/ops/character/series/${series.id}`,
      headers: { 'x-ops-token': 'ops-secret' },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.items.length, 2);
    for (const item of body.items) {
      assert.match(item.imageUrl, /^\/api\/v1\/character-assets\/char_/);
      assert.match(item.thumbUrl, /^\/api\/v1\/character-assets\/char_/);
    }
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.OPS_TOKEN;
    else process.env.OPS_TOKEN = previous;
  }
});
