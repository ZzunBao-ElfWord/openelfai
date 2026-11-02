'use strict';

// 千人千面生成器的 App 端 REST 路由：发现页画廊 + 我的作品列表。
// 与 MCP 连接器（/mcp/generator，API Key 鉴权）分离，这里走 App 用户登录态（JWT）。
// 作品数据由连接器生成时落库（generator_items），这两个接口只做只读查询。

const store = require('./store');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function assetUrl(file) {
  return `/api/v1/world-assets/${file}`;
}

function itemPayload(item) {
  return {
    id: item.id,
    batchId: item.batchId,
    idx: item.idx,
    seed: item.seed,
    traits: item.traits,
    rarity: item.rarity,
    imageUrl: item.imageKey ? assetUrl(item.imageKey) : null,
    thumbUrl: item.thumbKey ? assetUrl(item.thumbKey) : null,
    createdAt: item.createdAt,
  };
}

// 分页参数兜底：limit 默认 20、上限 50，offset 默认 0，非法值一律回落默认。
function readPage(query) {
  const rawLimit = Number(query?.limit);
  const rawOffset = Number(query?.offset);
  const limit = Number.isSafeInteger(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, MAX_LIMIT)
    : DEFAULT_LIMIT;
  const offset = Number.isSafeInteger(rawOffset) && rawOffset > 0 ? rawOffset : 0;
  return { limit, offset };
}

function registerGeneratorRoutes(app, { db, authenticate } = {}) {
  if (!db || typeof authenticate !== 'function') {
    throw new Error('生成器路由缺少 db / authenticate');
  }

  // 发现页画廊：全量作品按最新优先，游客可看，无需登录。
  app.get(
    '/api/v1/generator/feed',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request) => {
      const page = readPage(request.query);
      const { items, total } = await store.listFeed(db, page);
      return {
        items: items.map((item) => ({ ...itemPayload(item), author: item.author || null })),
        total,
        ...page,
      };
    },
  );

  // 我的作品：仅本人可见，走用户登录态。
  app.get(
    '/api/v1/generator/mine',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request) => {
      const { user } = await authenticate(request);
      const page = readPage(request.query);
      const { items, total } = await store.listMine(db, user.id, page);
      return { items: items.map(itemPayload), total, ...page };
    },
  );
}

module.exports = { registerGeneratorRoutes };
