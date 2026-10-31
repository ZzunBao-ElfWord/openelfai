'use strict';

// B2B 千人千面系列发行：一批形象共用一份链上 IP 授权，
// 渲染落盘 → 授权登记与校验 → 逐条分配 tokenId 并 B2B 铸造。
// 链上凭证（authId / txHash）只来自 linksprite 返回值，任何失败都不伪造。
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs/promises');

const render = require('./render');
const partsStore = require('./parts_store');
const { claimComposition, DEFAULT_ASSETS_DIR, MAX_GENERATE_ATTEMPTS } = require('./store');
const { allocateTokenIds } = require('./token_alloc');

const MIN_TOTAL = 1;
const MAX_TOTAL = 10000;
const DEFAULT_RENDER_LIMIT = 50;
const MAX_RENDER_LIMIT = 200;
const DEFAULT_MINT_LIMIT = 50;
const MAX_MINT_LIMIT = 50;
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 200;
const DEFAULT_STYLE = 'anime';
const STYLE_RE = /^[a-z0-9_-]{1,24}$/i;
const MAX_NAME = 64;
const MAX_CREATED_BY = 40;
const SERIES_STATUSES = new Set(['draft', 'rendering', 'ready', 'minting', 'minted', 'failed']);
const MINTABLE_STATUSES = new Set(['ready', 'minting', 'failed']);

function fail(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function assetsRoot(assetsDir) {
  return assetsDir || process.env.CHARACTER_ASSETS_DIR || DEFAULT_ASSETS_DIR;
}

function publicBase(value) {
  const raw = value === undefined
    ? process.env.CHARACTER_PUBLIC_ASSET_BASE || 'https://openelfai.com'
    : value || '';
  return String(raw).replace(/\/+$/, '');
}

function assetUrl(key) {
  return key ? `/api/v1/character-assets/${key}` : null;
}

function publicSeries(row) {
  return {
    id: row.id,
    name: row.name || '',
    style: row.style || DEFAULT_STYLE,
    total: Number(row.total || 0),
    seedStart: Number(row.seed_start || 0),
    coverKey: row.cover_key || null,
    ipOwner: row.ip_owner || null,
    contractNo: row.contract_no || null,
    scope: row.scope === null || row.scope === undefined ? null : Number(row.scope),
    maxMint: row.max_mint === null || row.max_mint === undefined ? null : Number(row.max_mint),
    startTime: row.start_time === null || row.start_time === undefined ? null : Number(row.start_time),
    endTime: row.end_time === null || row.end_time === undefined ? null : Number(row.end_time),
    authId: row.auth_id === null || row.auth_id === undefined ? null : Number(row.auth_id),
    authStatus: row.auth_status || 'none',
    status: row.status || 'draft',
    treasuryAddress: row.treasury_address || null,
    createdBy: row.created_by || '',
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0),
  };
}

function publicItem(row) {
  return {
    id: row.id,
    seriesId: row.series_id,
    idx: Number(row.idx || 0),
    seed: Number(row.seed || 0),
    compositionHash: row.composition_hash || null,
    imageKey: row.image_key || null,
    thumbKey: row.thumb_key || null,
    workHash: row.work_hash || null,
    tokenId: row.token_id === null || row.token_id === undefined ? null : Number(row.token_id),
    txHash: row.tx_hash || null,
    status: row.status || 'pending',
    error: row.error || null,
    imageUrl: assetUrl(row.image_key),
    thumbUrl: assetUrl(row.thumb_key),
  };
}

async function loadSeries(db, id) {
  const [rows] = await db.execute('SELECT * FROM character_series WHERE id = ?', [id]);
  return rows[0] || null;
}

async function requireSeries(db, id) {
  const row = await loadSeries(db, id);
  if (!row) throw fail(404, 'SERIES_NOT_FOUND', '系列不存在');
  return row;
}

/// 统计 pending/minted/failed；未知状态不计入。
async function seriesProgress(db, seriesId) {
  const [rows] = await db.execute(
    'SELECT status, COUNT(*) AS count FROM character_series_items WHERE series_id = ? GROUP BY status',
    [seriesId],
  );
  const progress = { pending: 0, minted: 0, failed: 0 };
  for (const row of rows) {
    if (Object.prototype.hasOwnProperty.call(progress, row.status)) {
      progress[row.status] = Number(row.count || 0);
    }
  }
  return progress;
}

/// 铸造结束后收敛状态：有失败即 failed；仍有待铸即 minting；否则 minted。
async function settleSeriesStatus(db, seriesId) {
  const progress = await seriesProgress(db, seriesId);
  let status = 'minted';
  if (progress.failed > 0) status = 'failed';
  else if (progress.pending > 0) status = 'minting';
  await db.execute(
    'UPDATE character_series SET status = ?, updated_at = ? WHERE id = ?',
    [status, Date.now(), seriesId],
  );
  return { status, progress };
}

async function createSeries(db, input = {}) {
  if (!db) throw fail(500, 'DB_UNAVAILABLE', '数据库未就绪');
  const name = String(input.name || '').trim().slice(0, MAX_NAME);
  if (!name) throw fail(400, 'INVALID_NAME', '请输入 1-64 字的系列名');
  const total = Number(input.total);
  if (!Number.isInteger(total) || total < MIN_TOTAL || total > MAX_TOTAL) {
    throw fail(400, 'INVALID_TOTAL', `total 必须是 ${MIN_TOTAL}-${MAX_TOTAL} 的整数`);
  }
  const style = input.style === undefined || input.style === null ? DEFAULT_STYLE : String(input.style);
  if (!STYLE_RE.test(style)) {
    throw fail(400, 'INVALID_STYLE', 'style 只能由字母、数字、下划线或短横线组成（1-24 位）');
  }
  let seedStart = Number(input.seedStart);
  if (input.seedStart === undefined || input.seedStart === null) {
    seedStart = Math.floor(Math.random() * 0x7fffffff);
  } else if (!Number.isSafeInteger(seedStart) || seedStart < 0) {
    throw fail(400, 'INVALID_SEED', 'seedStart 必须是非负整数');
  }
  const createdBy = String(input.createdBy || 'ops').trim().slice(0, MAX_CREATED_BY);

  const id = crypto.randomUUID();
  const now = Date.now();
  const treasury = String(process.env.PLATFORM_TREASURY_ADDRESS || '').trim() || null;
  await db.execute(
    `INSERT INTO character_series
       (id, name, style, total, seed_start, cover_key, ip_owner, contract_no, scope, max_mint,
        start_time, end_time, auth_id, auth_status, status, treasury_address, created_by,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, name, style, total, seedStart, null, null, null, null, null,
      null, null, null, 'none', 'draft', treasury, createdBy, now, now,
    ],
  );
  return publicSeries(await requireSeries(db, id));
}

/// 按 idx 递增继续渲染：每次最多 limit 张，全部渲染完成才进入 ready。
async function renderChunk(db, { seriesId, limit } = {}, options = {}) {
  if (!db) throw fail(500, 'DB_UNAVAILABLE', '数据库未就绪');
  const series = await requireSeries(db, seriesId);
  if (!['draft', 'ready'].includes(series.status)) {
    throw fail(409, 'SERIES_NOT_RENDERABLE', '当前状态不允许继续渲染');
  }

  const total = Number(series.total);
  const size = Math.min(
    MAX_RENDER_LIMIT,
    Math.max(1, Number.isFinite(Number(limit)) ? Number(limit) : DEFAULT_RENDER_LIMIT),
  );
  const [idxRows] = await db.execute(
    'SELECT MAX(idx) AS max_idx FROM character_series_items WHERE series_id = ?',
    [seriesId],
  );
  const maxIdx = idxRows[0]?.max_idx;
  const nextIdx = maxIdx === null || maxIdx === undefined ? 0 : Number(maxIdx) + 1;
  const remaining = Math.max(0, total - nextIdx);
  const count = Math.min(size, remaining);
  if (count === 0) {
    return {
      series: publicSeries(series), rendered: 0, itemCount: nextIdx, remaining: 0,
    };
  }

  const dir = assetsRoot(options.assetsDir);
  const catalog = options.catalog || await partsStore.getCatalog(db);
  const renderOptions = options.renderOptions || {};
  let rendered = 0;

  for (let offset = 0; offset < count; offset += 1) {
    const idx = nextIdx + offset;
    let seed = Number(series.seed_start) + idx;
    let candidate = null;
    let lastError = null;
    for (let attempt = 0; attempt < MAX_GENERATE_ATTEMPTS; attempt += 1) {
      try {
        candidate = render.renderCard({ style: series.style, seed }, { ...renderOptions, catalog });
      } catch (error) {
        lastError = error;
        candidate = null;
        break;
      }
      if (await claimComposition(db, candidate.compositionHash, seriesId, Date.now())) break;
      // 组合撞车时递增 seed 重试，保证全平台 hash 唯一。
      candidate = null;
      seed += 1;
    }
    if (!candidate) {
      throw fail(500, 'SERIES_RENDER_FAILED', lastError?.message || '系列渲染失败');
    }

    const hash = candidate.compositionHash;
    const imageKey = `char_${hash}.png`;
    const thumbKey = `char_${hash}_thumb.png`;
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, imageKey), candidate.png);
      await fs.writeFile(path.join(dir, thumbKey), candidate.thumbPng);
    } catch (error) {
      throw fail(500, 'SERIES_RENDER_FAILED', error.message || '系列图片写入失败');
    }

    const workHash = crypto.createHash('sha256').update(candidate.png).digest('hex');
    const now = Date.now();
    await db.execute(
      `INSERT INTO character_series_items
         (id, series_id, idx, seed, composition_hash, image_key, thumb_key, work_hash,
          status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), seriesId, idx, seed, hash, imageKey, thumbKey, workHash, 'pending', now, now],
    );
    rendered += 1;
  }

  const itemCount = nextIdx + rendered;
  const status = itemCount >= total ? 'ready' : 'draft';
  await db.execute(
    'UPDATE character_series SET status = ?, updated_at = ? WHERE id = ?',
    [status, Date.now(), seriesId],
  );
  const fresh = await requireSeries(db, seriesId);
  return {
    series: publicSeries(fresh),
    rendered,
    itemCount,
    remaining: Math.max(0, total - itemCount),
  };
}

/// 系列级工作哈希：由系列清单字段确定性派生，用于授权登记与追溯，不是链上凭证。
function seriesWorkHash(series) {
  return crypto.createHash('sha256').update(JSON.stringify({
    id: series.id,
    total: Number(series.total),
    seedStart: Number(series.seed_start),
    style: series.style,
  })).digest('hex');
}

async function markAuthInvalid(db, seriesId) {
  await db.execute(
    'UPDATE character_series SET auth_status = ?, updated_at = ? WHERE id = ?',
    ['invalid', Date.now(), seriesId],
  );
}

/// 校验状态/上限/时间窗 → 登记授权 → 反查 authId → 有效性校验 → 落库。
async function authorizeSeries(db, {
  seriesId, client, ipOwner, contractNo, scope, startTime, endTime, maxMint,
} = {}) {
  const series = await requireSeries(db, seriesId);
  if (series.status !== 'ready') {
    throw fail(409, 'SERIES_NOT_READY', '系列尚未渲染完成，暂不能授权');
  }
  if (!client || client.enabled === false) throw fail(503, 'CHAIN_DISABLED', '链服务未开通');

  const total = Number(series.total);
  const mintLimit = Number(maxMint);
  if (!Number.isSafeInteger(mintLimit) || mintLimit <= 0) {
    throw fail(400, 'INVALID_MAX_MINT', 'maxMint 必须是正整数');
  }
  if (mintLimit < total) {
    throw fail(409, 'INVALID_MAX_MINT', `授权上限 ${mintLimit} 低于系列总量 ${total}，拒绝授权`);
  }
  const scopeValue = Number(scope);
  if (![0, 1, 2].includes(scopeValue)) {
    throw fail(400, 'INVALID_SCOPE', '授权范围只能是 0/1/2');
  }
  const start = Number(startTime);
  const end = Number(endTime);
  if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(end) || end <= start) {
    throw fail(400, 'INVALID_TIME_WINDOW', '授权时间窗不合法');
  }
  const owner = String(ipOwner || '').trim();
  const contract = String(contractNo || '').trim();
  if (!owner) throw fail(400, 'INVALID_IP_OWNER', '缺少 IP 权利方');
  if (!contract) throw fail(400, 'INVALID_CONTRACT_NO', '缺少授权合同编号');

  const workHash = seriesWorkHash(series);
  await client.registerAuth({
    ipOwner: owner,
    contractNo: contract,
    workHash,
    startTime: start,
    endTime: end,
    scope: scopeValue,
    maxMint: mintLimit,
  });

  let authId;
  try {
    // 上游注册接口不返回 authId，只能按 contractNo + workHash 反查。
    const found = await client.findAuthId({ contractNo: contract, workHash });
    authId = Number(found?.authId);
  } catch (error) {
    await markAuthInvalid(db, seriesId);
    throw error;
  }
  if (!Number.isSafeInteger(authId) || authId <= 0) {
    await markAuthInvalid(db, seriesId);
    throw fail(404, 'AUTH_NOT_FOUND', '链上未找到对应授权记录');
  }

  let valid;
  try {
    valid = await client.isAuthValid(authId);
  } catch (error) {
    await markAuthInvalid(db, seriesId);
    throw error;
  }
  if (!valid) {
    await markAuthInvalid(db, seriesId);
    throw fail(409, 'AUTH_INVALID', '链上授权不可用');
  }

  await db.execute(
    `UPDATE character_series
       SET ip_owner = ?, contract_no = ?, scope = ?, max_mint = ?, start_time = ?, end_time = ?,
           auth_id = ?, auth_status = ?, updated_at = ?
     WHERE id = ?`,
    [
      owner, contract, scopeValue, mintLimit, start, end,
      authId, 'registered', Date.now(), seriesId,
    ],
  );
  return publicSeries(await requireSeries(db, seriesId));
}

function metadataOf(series, item, imageUrl) {
  return {
    name: `${series.name} #${Number(item.idx) + 1}`,
    description: `${series.name} 系列形象`,
    seriesId: series.id,
    index: Number(item.idx),
    seed: Number(item.seed),
    image: imageUrl,
    generator: 'OpenElf 形象工坊',
  };
}

/// 领取一批 pending 明细的 tokenId 并逐条 B2B 铸造；单条失败不影响后续。
async function mintChunk(db, { seriesId, limit, client } = {}, options = {}) {
  const series = await requireSeries(db, seriesId);
  if (!MINTABLE_STATUSES.has(series.status)) {
    throw fail(409, 'SERIES_NOT_MINTABLE', '当前状态不允许铸造');
  }
  if (!client || client.enabled === false) throw fail(503, 'CHAIN_DISABLED', '链服务未开通');

  const treasury = String(series.treasury_address || process.env.PLATFORM_TREASURY_ADDRESS || '').trim();
  if (!treasury) throw fail(503, 'TREASURY_NOT_CONFIGURED', '未配置系列铸造接收地址');

  if (series.auth_status === 'invalid') throw fail(409, 'AUTH_INVALID', '链上授权不可用');
  const authId = Number(series.auth_id);
  if (!Number.isSafeInteger(authId) || authId <= 0 || series.auth_status !== 'registered') {
    throw fail(409, 'AUTH_REQUIRED', '请先完成系列授权登记');
  }
  if (typeof client.isAuthValid === 'function') {
    const valid = await client.isAuthValid(authId);
    if (!valid) {
      await markAuthInvalid(db, seriesId);
      throw fail(409, 'AUTH_INVALID', '链上授权不可用');
    }
  }

  const size = Math.min(
    MAX_MINT_LIMIT,
    Math.max(1, Number.isFinite(Number(limit)) ? Number(limit) : DEFAULT_MINT_LIMIT),
  );
  const [pendingRows] = await db.execute(
    'SELECT * FROM character_series_items WHERE series_id = ? AND status = ? ORDER BY idx ASC LIMIT ?',
    [seriesId, 'pending', size],
  );
  if (!pendingRows.length) {
    const settled = await settleSeriesStatus(db, seriesId);
    return {
      series: publicSeries(await requireSeries(db, seriesId)),
      progress: settled.progress,
      attempted: 0,
      minted: 0,
      failed: 0,
    };
  }

  await db.execute(
    'UPDATE character_series SET status = ?, updated_at = ? WHERE id = ?',
    ['minting', Date.now(), seriesId],
  );

  // 只为尚无 tokenId 的明细分配连续段；重试中的明细沿用已分配的 tokenId。
  const needIds = pendingRows.filter((row) => !(Number(row.token_id) > 0));
  if (needIds.length) {
    const { start } = await allocateTokenIds(db, needIds.length);
    for (let index = 0; index < needIds.length; index += 1) {
      const tokenId = Number(start) + index;
      await db.execute(
        'UPDATE character_series_items SET token_id = ?, updated_at = ? WHERE id = ?',
        [tokenId, Date.now(), needIds[index].id],
      );
      needIds[index].token_id = tokenId;
    }
  }

  const dir = assetsRoot(options.assetsDir);
  const base = publicBase(options.publicAssetBase);
  let minted = 0;
  let failed = 0;

  for (const item of pendingRows) {
    const tokenId = Number(item.token_id);
    const workHash = String(item.work_hash || item.composition_hash || '');
    const metaKey = `meta_${workHash}.json`;
    const tokenURI = base + `/api/v1/character-assets/${metaKey}`;
    try {
      if (!Number.isSafeInteger(tokenId) || tokenId <= 0) {
        throw fail(500, 'TOKEN_NOT_ALLOCATED', '明细缺少 tokenId');
      }
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, metaKey),
        JSON.stringify(metadataOf(series, item, assetUrl(item.image_key)), null, 2),
        'utf8',
      );
      const chain = await client.mintB2B({
        to: treasury,
        tokenId,
        tokenURI,
        authId,
        workHash,
      });
      if (!chain?.txHash) {
        throw fail(502, 'CHAIN_TX_MISSING', '链上未返回交易哈希');
      }
      await db.execute(
        'UPDATE character_series_items SET status = ?, tx_hash = ?, error = ?, updated_at = ? WHERE id = ?',
        ['minted', chain.txHash, null, Date.now(), item.id],
      );
      minted += 1;
    } catch (error) {
      await db.execute(
        'UPDATE character_series_items SET status = ?, tx_hash = ?, error = ?, updated_at = ? WHERE id = ?',
        ['failed', null, String(error.message || '链上铸造失败').slice(0, 255), Date.now(), item.id],
      );
      failed += 1;
    }
  }

  const settled = await settleSeriesStatus(db, seriesId);
  if (minted === 0 && failed > 0) {
    throw fail(500, 'SERIES_MINT_FAILED', '本批铸造全部失败，请排查后重试');
  }
  return {
    series: publicSeries(await requireSeries(db, seriesId)),
    progress: settled.progress,
    attempted: minted + failed,
    minted,
    failed,
  };
}

/// 只重跑 failed 明细：先复位为 pending，再复用 mintChunk 的取号/铸造流程。
async function retryFailed(db, { seriesId, limit, client } = {}, options = {}) {
  const series = await requireSeries(db, seriesId);
  if (series.status !== 'failed') {
    throw fail(409, 'SERIES_NOT_FAILED', '仅失败状态的系列可以重试');
  }
  const size = Math.min(
    MAX_MINT_LIMIT,
    Math.max(1, Number.isFinite(Number(limit)) ? Number(limit) : DEFAULT_MINT_LIMIT),
  );
  const [rows] = await db.execute(
    'SELECT * FROM character_series_items WHERE series_id = ? AND status = ? ORDER BY idx ASC LIMIT ?',
    [seriesId, 'failed', size],
  );
  if (!rows.length) {
    const settled = await settleSeriesStatus(db, seriesId);
    return {
      series: publicSeries(await requireSeries(db, seriesId)),
      progress: settled.progress,
      attempted: 0,
      minted: 0,
      failed: 0,
    };
  }
  for (const row of rows) {
    await db.execute(
      'UPDATE character_series_items SET status = ?, error = ?, updated_at = ? WHERE id = ?',
      ['pending', null, Date.now(), row.id],
    );
  }
  return mintChunk(db, { seriesId, limit: rows.length, client }, options);
}

async function getSeries(db, id) {
  const row = await requireSeries(db, id);
  const [items] = await db.execute(
    'SELECT * FROM character_series_items WHERE series_id = ? ORDER BY idx ASC',
    [id],
  );
  const progress = await seriesProgress(db, id);
  return { ...publicSeries(row), progress, items: items.map(publicItem) };
}

async function listSeries(db, limit) {
  const size = Math.max(1, Math.min(MAX_LIST_LIMIT, Number(limit) || DEFAULT_LIST_LIMIT));
  const [rows] = await db.execute(
    'SELECT * FROM character_series ORDER BY created_at DESC LIMIT ?',
    [size],
  );
  return rows.map(publicSeries);
}

module.exports = {
  MIN_TOTAL,
  MAX_TOTAL,
  MAX_RENDER_LIMIT,
  MAX_MINT_LIMIT,
  SERIES_STATUSES,
  createSeries,
  renderChunk,
  authorizeSeries,
  mintChunk,
  retryFailed,
  getSeries,
  listSeries,
  seriesProgress,
  publicSeries,
  publicItem,
};
