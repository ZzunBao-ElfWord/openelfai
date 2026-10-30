'use strict';

const crypto = require('node:crypto');

const partsStore = require('./parts_store');
const { createBatch, listBatches, getBatch } = require('./batch');

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

function registerOpsRoutes(app, { db, assetsDir, renderOptions } = {}) {
  const assetRoot = process.env.CHARACTER_ASSETS_DIR || assetsDir;

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
}

module.exports = { PREFIX, registerOpsRoutes, requireOpsToken };
