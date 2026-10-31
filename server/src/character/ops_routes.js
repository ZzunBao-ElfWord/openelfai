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

function registerOpsRoutes(app, { db, assetsDir, renderOptions, chainClient } = {}) {
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
}

module.exports = { PREFIX, registerOpsRoutes, requireOpsToken };
