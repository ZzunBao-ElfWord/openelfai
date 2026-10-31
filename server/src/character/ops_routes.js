'use strict';

const crypto = require('node:crypto');

const partsStore = require('./parts_store');
const { createBatch, listBatches, getBatch } = require('./batch');
const { createLinkspriteClient } = require('./linksprite');
const {
  createSeries,
  renderChunk,
  authorizeSeries,
  mintChunk,
  retryFailed,
  getSeries,
  listSeries,
} = require('./series');

const PREFIX = '/internal/ops/character';

function fail(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

// 内部运营接口只认 x-ops-token；未配置 OPS_TOKEN 时整体关闭，避免误开放。
function requireOpsToken(request) {
  const token = process.env.OPS_TOKEN || '';
  if (!token) throw fail(503, 'OPS_DISABLED', '运营接口未开启');
  const expected = Buffer.from(token);
  const given = Buffer.from(String(request.headers['x-ops-token'] || ''));
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    throw fail(401, 'UNAUTHORIZED', '运营令牌无效');
  }
}

/// 与 commerce 相同的日界：服务器本地自然日（YYYY-MM-DD）。
function localDay(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function registerOpsRoutes(app, { db, assetsDir, renderOptions, chainClient, commerce } = {}) {
  const assetRoot = process.env.CHARACTER_ASSETS_DIR || assetsDir;
  const client = chainClient || createLinkspriteClient();

  /// 运营后台直接展示：封面也补成相对资源 URL。
  const withCoverUrl = (series) => ({
    ...series,
    coverUrl: series.coverKey ? `/api/v1/character-assets/${series.coverKey}` : null,
  });

  app.get(`${PREFIX}/parts`, async (request) => {
    requireOpsToken(request);
    return partsStore.listParts(db);
  });

  app.put(`${PREFIX}/parts/:id`, { bodyLimit: 32 * 1024 }, async (request) => {
    requireOpsToken(request);
    return partsStore.updatePart(db, request.params.id, request.body || {});
  });

  app.post(`${PREFIX}/batches`, { bodyLimit: 1024 * 1024 }, async (request) => {
    requireOpsToken(request);
    return createBatch(db, request.body || {}, { assetsDir: assetRoot, renderOptions });
  });

  app.get(`${PREFIX}/batches`, async (request) => {
    requireOpsToken(request);
    return { batches: await listBatches(db, request.query?.limit) };
  });

  app.get(`${PREFIX}/batches/:id`, async (request) => {
    requireOpsToken(request);
    return getBatch(db, request.params.id, { assetsDir: assetRoot });
  });

  // —— P4 B2B 系列发行 ——

  app.post(`${PREFIX}/series`, { bodyLimit: 32 * 1024 }, async (request) => {
    requireOpsToken(request);
    return withCoverUrl(await createSeries(db, request.body || {}));
  });

  app.get(`${PREFIX}/series`, async (request) => {
    requireOpsToken(request);
    const series = await listSeries(db, request.query?.limit);
    return { series: series.map(withCoverUrl) };
  });

  app.get(`${PREFIX}/series/:id`, async (request) => {
    requireOpsToken(request);
    const detail = await getSeries(db, request.params.id);
    return {
      ...withCoverUrl(detail),
      items: detail.items.map((item) => ({
        ...item,
        imageUrl: item.imageUrl === undefined ? null : item.imageUrl,
        thumbUrl: item.thumbUrl === undefined ? null : item.thumbUrl,
      })),
    };
  });

  app.post(`${PREFIX}/series/:id/render`, { bodyLimit: 16 * 1024 }, async (request) => {
    requireOpsToken(request);
    const result = await renderChunk(
      db,
      { seriesId: request.params.id, limit: request.body?.limit },
      { assetsDir: assetRoot, renderOptions },
    );
    return { ...result, series: withCoverUrl(result.series) };
  });

  app.post(`${PREFIX}/series/:id/authorize`, { bodyLimit: 32 * 1024 }, async (request) => {
    requireOpsToken(request);
    const body = request.body || {};
    return withCoverUrl(await authorizeSeries(db, {
      seriesId: request.params.id,
      client,
      ipOwner: body.ipOwner,
      contractNo: body.contractNo,
      scope: body.scope,
      startTime: body.startTime,
      endTime: body.endTime,
      maxMint: body.maxMint,
    }));
  });

  app.post(`${PREFIX}/series/:id/mint`, { bodyLimit: 16 * 1024 }, async (request) => {
    requireOpsToken(request);
    const result = await mintChunk(
      db,
      { seriesId: request.params.id, limit: request.body?.limit, client },
      { assetsDir: assetRoot, publicAssetBase: request.body?.publicAssetBase },
    );
    return { ...result, series: withCoverUrl(result.series) };
  });

  app.post(`${PREFIX}/series/:id/retry`, { bodyLimit: 16 * 1024 }, async (request) => {
    requireOpsToken(request);
    const result = await retryFailed(
      db,
      { seriesId: request.params.id, limit: request.body?.limit, client },
      { assetsDir: assetRoot, publicAssetBase: request.body?.publicAssetBase },
    );
    return { ...result, series: withCoverUrl(result.series) };
  });

  // —— 平台推理成本日报：单精灵日成本 = 当日总成本 / 当日活跃精灵数（目标 ≤ 0.08 元）——

  app.get('/ops/elf-cost-daily', async (request) => {
    requireOpsToken(request);
    if (!commerce?.listElfCostDaily) throw fail(503, 'COST_METER_UNAVAILABLE', '成本计量未接入');
    const queryDay = typeof request.query?.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(request.query.day)
      ? request.query.day : null;
    const day = queryDay || localDay();
    const elves = await commerce.listElfCostDaily(day);
    const totalMicro = elves.reduce((sum, row) => sum + (Number(row.totalMicro) || 0), 0);
    // 活跃精灵 = 当日有任意成本记录的精灵数（每只精灵一天一条记录）。
    const activeElves = elves.length;
    const perElfMicro = activeElves ? Math.round(totalMicro / activeElves) : 0;
    const warnMicro = Math.max(1, Number(process.env.ELF_COST_WARN_MICRO) || 80000);
    if (activeElves && perElfMicro > warnMicro) {
      app.log?.warn?.({ day, activeElves, totalMicro, perElfMicro, warnMicro },
        'elf daily cost per active elf exceeds warn threshold');
    }
    return { day, elves, activeElves, totalMicro, perElfMicro, warnMicro };
  });
}

module.exports = { PREFIX, registerOpsRoutes, requireOpsToken };
