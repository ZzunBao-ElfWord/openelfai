'use strict';

/// Civitai 闭环的管理接口（登录态）：
/// 搜索/详情 → 收藏到个人库 → 出图时通过 favoriteIds 引用。
/// 搜索走日配额，避免被当成免费的内容代理反复刷。
function registerCivitaiRoutes(app, {
  authenticate, civitai, favorites, usage, dailyLimit = 200, enabled = true,
} = {}) {
  if (typeof authenticate !== 'function' || !civitai || !favorites || !usage) {
    throw new Error('Civitai 路由缺少依赖');
  }

  app.get('/api/v1/media/civitai/search', async (request) => {
    const { user } = await authenticate(request);
    if (!enabled) return { enabled: false, models: [] };
    const query = request.query || {};
    await usage.consume(user.id, 'civitai', { limit: dailyLimit });
    const types = typeof query.type === 'string' && query.type ? [query.type] : [];
    const baseModels = typeof query.baseModel === 'string' && query.baseModel ? [query.baseModel] : [];
    return civitai.searchModels({
      query: typeof query.q === 'string' ? query.q : '',
      types,
      baseModels,
      limit: query.limit,
      nsfw: false,
    });
  });

  app.get('/api/v1/media/civitai/models/:id', async (request) => {
    await authenticate(request);
    return { model: await civitai.getModel(request.params?.id) };
  });

  app.get('/api/v1/media/civitai/favorites', async (request) => {
    const { user } = await authenticate(request);
    return {
      favorites: await favorites.list(user.id),
      max: favorites.MAX_FAVORITES_PER_USER,
    };
  });

  app.post('/api/v1/media/civitai/favorites', { bodyLimit: 8 * 1024 }, async (request) => {
    const { user } = await authenticate(request);
    return { favorite: await favorites.add(user.id, request.body || {}) };
  });

  app.delete('/api/v1/media/civitai/favorites/:id', async (request) => {
    const { user } = await authenticate(request);
    return favorites.remove(user.id, request.params?.id);
  });
}

module.exports = { registerCivitaiRoutes };
