'use strict';

/// 媒体能力 App 接口（登录态）：语音合成与 ComfyUI 出图。
/// 两个能力都未配置时为 503，客户端凭 capabilities 接口先判断可用性。
function registerMediaRoutes(app, { authenticate, tts, comfy, usage, favorites } = {}) {
  if (typeof authenticate !== 'function' || !usage) {
    throw new Error('媒体路由缺少 authenticate / usage');
  }

  app.get('/api/v1/media/capabilities', async (request) => {
    await authenticate(request);
    return {
      tts: { enabled: !!tts?.isEnabled(), maxChars: tts?.maxChars || 0, voices: tts?.voices || [] },
      image: { enabled: !!comfy?.isEnabled() },
    };
  });

  app.post('/api/v1/media/tts', { bodyLimit: 8 * 1024 }, async (request) => {
    const { user } = await authenticate(request);
    if (!tts?.isEnabled()) {
      return { enabled: false, message: '语音能力未启用' };
    }
    const text = typeof request.body?.text === 'string' ? request.body.text : '';
    // 先按字数预检，避免无意义调用才被服务层拒绝。
    if (!text.trim()) {
      throw Object.assign(new Error('语音文本不能为空'), { statusCode: 400 });
    }
    const used = await usage.consume(user.id, 'tts', {
      limit: tts.dailyLimit, units: text.length,
    });
    const audio = await tts.synthesize({ text, voice: request.body?.voice });
    return { ...audio, quota: used };
  });

  app.post('/api/v1/media/image', { bodyLimit: 8 * 1024 }, async (request) => {
    const { user } = await authenticate(request);
    if (!comfy?.isEnabled()) {
      return { enabled: false, message: '出图能力未启用' };
    }
    const used = await usage.consume(user.id, 'image', { limit: comfy.dailyLimit });
    // favoriteIds 指向用户收藏的 LoRA；未填 ComfyUI 文件名的收藏会被自动忽略。
    const loras = favorites
      ? await favorites.resolveLoras(user.id, Array.isArray(request.body?.favoriteIds) ? request.body.favoriteIds : [])
      : [];
    const image = await comfy.generateImage({
      prompt: request.body?.prompt,
      negativePrompt: request.body?.negativePrompt,
      seed: request.body?.seed,
      width: request.body?.width,
      height: request.body?.height,
      steps: request.body?.steps,
      cfg: request.body?.cfg,
      loras: loras.map((item) => item.comfyName),
    });
    // 返回实际生效的模型清单，供客户端展示与作品溯源。
    return {
      ...image,
      usedModels: loras.map((item) => ({
        favoriteId: item.favoriteId, name: item.name, comfyName: item.comfyName,
      })),
      quota: used,
    };
  });
}

module.exports = { registerMediaRoutes };
