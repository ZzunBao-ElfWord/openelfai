'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');

const parts = require('./parts');
const render = require('./render');
const { createCharacterStore } = require('./store');
const { refineCharacter, buildRefinePrompt } = require('./refine');
const { prepareAndMint, META_FILE_RE } = require('./mint');
const { createLinkspriteClient } = require('./linksprite');

const ASSET_FILE_RE = /^(char_[a-f0-9]{64}(_thumb)?\.png|batch_[a-f0-9]{32}_sheet\.png)$/;

function fail(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function readTraits(input) {
  if (input === undefined) return undefined;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw fail(400, 'INVALID_TRAITS', 'traits 必须是 {slot: partId} 对象');
  }
  const result = {};
  for (const slot of parts.SLOT_ORDER) {
    if (input[slot] === undefined) continue;
    const id = String(input[slot]);
    if (!parts.getTrait(slot, id)) {
      throw fail(400, 'INVALID_TRAITS', `配件 ${id} 不属于 ${slot}`);
    }
    result[slot] = id;
  }
  return result;
}

function readSeed(input) {
  if (input === undefined || input === null) return undefined;
  const seed = Number(input);
  if (!Number.isSafeInteger(seed) || seed < 0) {
    throw fail(400, 'INVALID_SEED', 'seed 必须是非负整数');
  }
  return seed;
}

function readDraftBody(body) {
  const payload = body && typeof body === 'object' ? body : {};
  const patch = {};
  if (payload.name !== undefined) patch.name = payload.name;
  if (payload.source !== undefined) patch.source = payload.source;
  if (payload.style !== undefined) patch.style = payload.style;
  if (payload.prompt !== undefined) patch.prompt = payload.prompt;
  if (payload.persona !== undefined) patch.persona = payload.persona;
  if (payload.fear !== undefined) patch.fear = payload.fear;
  if (payload.habit !== undefined) patch.habit = payload.habit;
  if (payload.traits !== undefined) patch.traits = readTraits(payload.traits);
  if (payload.seed !== undefined) patch.seed = readSeed(payload.seed);
  return patch;
}

function assetUrl(key) {
  return key ? `/api/v1/character-assets/${key}` : null;
}

// 局部覆盖时保留卡上已有的其他配件，避免只改一个 slot 把其余选择重掷掉。
function mergeTraits(base, patch) {
  if (patch === undefined) return base === undefined || base === null ? {} : base;
  return { ...(base && typeof base === 'object' ? base : {}), ...patch };
}

function registerCharacterRoutes(app, { db, authenticate, commerce, androidCommerce, chainClient } = {}) {
  const store = createCharacterStore({
    db,
    assetsDir: process.env.CHARACTER_ASSETS_DIR || undefined,
  });
  const auth = (request) => authenticate(request);
  const mintClient = chainClient || createLinkspriteClient();

  const safeInsertRun = async (payload) => {
    try {
      await store.insertRun(payload);
    } catch (error) {
      app.log?.warn?.({ err: error, action: payload?.action }, 'character run record failed');
    }
  };

  app.get('/api/v1/character/parts', async (request) => {
    await auth(request);
    return { slots: parts.listSlots(), comboSpace: parts.comboSpace() };
  });

  // 身份证授权线必须以服务端实名记录为准，客户端声明不采信。
  const assertIdCardVerified = async (user, source) => {
    if (source !== 'idCard') return;
    if (!commerce || typeof commerce.identityVerified !== 'function') {
      throw fail(503, 'REALNAME_UNAVAILABLE', '实名服务不可用');
    }
    if (!await commerce.identityVerified(user)) {
      throw fail(403, 'IDENTITY_REQUIRED', '请先完成实名认证');
    }
  };

  app.post('/api/v1/character/drafts', { bodyLimit: 32 * 1024 }, async (request) => {
    const { user } = await auth(request);
    const patch = readDraftBody(request.body);
    await assertIdCardVerified(user, patch.source);
    return store.createCard(user.id, patch);
  });

  app.put('/api/v1/character/drafts/:id', { bodyLimit: 32 * 1024 }, async (request) => {
    const { user } = await auth(request);
    const patch = readDraftBody(request.body);
    await assertIdCardVerified(user, patch.source);
    return store.updateCard(user.id, request.params.id, patch);
  });

  app.get('/api/v1/character/cards', async (request) => {
    const { user } = await auth(request);
    const cards = await store.listCards(user.id, { limit: request.query?.limit });
    return { cards };
  });

  // 预览：本地合成缩略图，不落库、不收费。
  app.post('/api/v1/character/drafts/:id/preview', { bodyLimit: 16 * 1024 }, async (request) => {
    const { user } = await auth(request);
    const card = await store.getCard(user.id, request.params.id);
    const traits = readTraits(request.body?.traits);
    const seed = readSeed(request.body?.seed);
    const preview = render.renderPreview({
      ...card,
      traits: mergeTraits(card.traits, traits),
      seed: seed === undefined ? card.seed : seed,
    });
    return {
      thumbDataUrl: `data:image/png;base64,${preview.png.toString('base64')}`,
      compositionHash: preview.compositionHash,
      rarity: preview.rarity,
      traits: preview.traits,
    };
  });

  // 生成：本地合成为主（免费）；refine 走用户自己的 Key，失败自动降级。
  app.post('/api/v1/character/drafts/:id/generate', { bodyLimit: 32 * 1024 }, async (request) => {
    const { user } = await auth(request);
    const startedAt = Date.now();
    let result;
    try {
      const traits = readTraits(request.body?.traits);
      const seed = readSeed(request.body?.seed);
      const card = await store.getCard(user.id, request.params.id);
      result = await store.saveGenerated(user.id, request.params.id, {
        traits: mergeTraits(card.traits, traits),
        seed,
      });
    } catch (error) {
      await safeInsertRun({
        userId: user.id, cardId: request.params.id, action: 'generate', status: 'failed',
        durationMs: Date.now() - startedAt, error: error.message,
      });
      throw error;
    }

    let refine = { skipped: true, reason: 'not_requested' };
    if (request.body?.refine) {
      const refineStarted = Date.now();
      refine = await refineCharacter({
        db,
        userId: user.id,
        png: result.render.png,
        prompt: buildRefinePrompt(result.card, result.render.traits),
      });
      await safeInsertRun({
        userId: user.id, cardId: result.card.id, action: 'refine',
        status: refine.skipped ? 'skipped' : 'success',
        costMicro: refine.costMicro || 0,
        durationMs: Date.now() - refineStarted,
        error: refine.skipped ? refine.reason : null,
      });
    }

    await safeInsertRun({
      userId: user.id, cardId: result.card.id, action: 'generate', status: 'success',
      costMicro: 0, durationMs: Date.now() - startedAt,
    });

    return {
      card: result.card,
      imageUrl: assetUrl(result.card.image_key),
      thumbUrl: assetUrl(result.card.thumb_key),
      refine,
    };
  });

  app.get('/api/v1/character/cards/:id', async (request) => {
    const { user } = await auth(request);
    const card = await store.getCard(user.id, request.params.id);
    return { ...card, imageUrl: assetUrl(card.image_key), thumbUrl: assetUrl(card.thumb_key) };
  });

  // UGC 单角色铸造：链上成功后扣 200 钻石并建 AI；重复铸造直接返回同一结果。
  app.post('/api/v1/character/cards/:id/mint', { bodyLimit: 16 * 1024 }, async (request) => {
    const { user } = await auth(request);
    const service = request.body?.platform === 'android' && androidCommerce
      ? androidCommerce : commerce;
    if (!service) throw fail(503, 'COMMERCE_DISABLED', '消费服务尚未开放');
    return prepareAndMint(db, {
      userId: user.id,
      user,
      cardId: request.params.id,
      commerce: service,
      client: mintClient,
      assetsDir: store.assetsDir,
    });
  });

  // 形象图片与元数据白名单：char_<sha256>.png / 缩略图 / 批次联系表 / meta_<hash>.json。
  app.get('/api/v1/character-assets/:file', async (request, reply) => {
    const file = String(request.params.file || '');
    if (META_FILE_RE.test(file)) {
      let text;
      try {
        text = await fs.readFile(path.join(store.assetsDir, path.basename(file)), 'utf8');
      } catch (_) {
        throw fail(404, 'NOT_FOUND', '元数据不存在');
      }
      return reply
        .type('application/json; charset=utf-8')
        .header('cache-control', 'no-store')
        .send(text);
    }
    if (!ASSET_FILE_RE.test(file)) {
      throw fail(404, 'NOT_FOUND', '图片不存在');
    }
    let buffer;
    try {
      buffer = await fs.readFile(path.join(store.assetsDir, path.basename(file)));
    } catch (_) {
      throw fail(404, 'NOT_FOUND', '图片不存在');
    }
    return reply
      .type('image/png')
      .header('cache-control', 'public, max-age=31536000, immutable')
      .send(buffer);
  });

  return store;
}

module.exports = { registerCharacterRoutes, ASSET_FILE_RE, META_FILE_RE };
