'use strict';

/// Civitai 资源库：搜索模型 / LoRA → 收藏到个人库 → 出图时直接引用。
/// 闭环里不做「服务端下载模型权重」：一个 LoRA 动辄几百 MB，
/// 由运维把文件装到 ComfyUI 的 models 目录更合理，平台只负责发现、收藏与溯源。
const CIVITAI_BASE = 'https://civitai.com/api/v1';
const DEFAULT_CACHE_MS = 5 * 60 * 1000;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_RESULTS = 20;
const MAX_QUERY_CHARS = 100;

/// 只允许 Civitai 官方 API：URL 由本模块拼装，不接任何用户传入地址，
/// 从根上避免这类"外部资源抓取"被当成 SSRF 跳板。
function assertCivitaiUrl(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'civitai.com') {
    throw new Error('只允许访问 Civitai 官方 API');
  }
  return parsed;
}

function summarizeModel(item) {
  const versions = Array.isArray(item?.modelVersions) ? item.modelVersions : [];
  return {
    id: item?.id,
    name: String(item?.name || '').slice(0, 200),
    type: String(item?.type || ''),
    nsfw: item?.nsfw === true,
    creator: String(item?.creator?.username || ''),
    downloadCount: Number(item?.stats?.downloadCount) || 0,
    versions: versions.slice(0, 3).map((version) => ({
      id: version?.id,
      name: String(version?.name || ''),
      baseModel: String(version?.baseModel || ''),
      downloadUrl: String(version?.downloadUrl || ''),
      thumbnail: String(version?.images?.[0]?.url || ''),
    })),
  };
}

function createCivitaiService({
  fetchImpl = fetch, logger, timeoutMs = 15000, cacheMs = DEFAULT_CACHE_MS,
} = {}) {
  const cache = new Map();

  async function request(url) {
    const target = assertCivitaiUrl(url);
    const key = target.toString();
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < cacheMs) return hit.data;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(key, {
        headers: { accept: 'application/json' },
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`Civitai 返回 ${res.status}`);
      const text = await res.text();
      if (text.length > MAX_JSON_BYTES) throw new Error('Civitai 响应体过大');
      const data = JSON.parse(text);
      // 只缓存成功结果，失败让调用方立刻知道。
      cache.set(key, { at: Date.now(), data });
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  /// 搜索：默认过滤 NSFW（平台内容合规），类型与底模可多选。
  async function searchModels({ query = '', types = [], baseModels = [], limit = 12, nsfw = false } = {}) {
    const q = String(query || '').trim().slice(0, MAX_QUERY_CHARS);
    const safeLimit = Math.min(MAX_RESULTS, Math.max(1, Number(limit) || 12));

    const params = new URLSearchParams({ limit: String(safeLimit) });
    if (q) params.set('query', q);
    // ComfyUI 出图只关心 LoRA 与基础模型，其余类型（如 ControlNet）先不放开。
    const allowedTypes = ['LORA', 'Checkpoint', 'TextualInversion'].filter((type) => types.includes(type));
    if (allowedTypes.length) params.set('types', allowedTypes.join(','));
    const allowedBase = baseModels.filter((item) => typeof item === 'string' && item).slice(0, 4);
    if (allowedBase.length) params.set('baseModels', allowedBase.join(','));
    params.set('nsfw', nsfw ? 'true' : 'false');

    const data = await request(`${CIVITAI_BASE}/models?${params.toString()}`);
    const items = Array.isArray(data?.items) ? data.items : [];
    // 服务端已按 nsfw=false 过滤，这里再做一次防御性校验，避免上游变更口径。
    const models = items
      .map(summarizeModel)
      .filter((model) => nsfw || !model.nsfw);
    return { models, totalItems: Number(data?.metadata?.totalItems) || models.length };
  }

  async function getModel(modelId) {
    const id = Number(modelId);
    if (!Number.isInteger(id) || id <= 0) {
      throw Object.assign(new Error('Civitai 模型 ID 无效'), { statusCode: 400 });
    }
    return summarizeModel(await request(`${CIVITAI_BASE}/models/${id}`));
  }

  function clearCache() {
    cache.clear();
  }

  return { searchModels, getModel, clearCache, MAX_RESULTS };
}

module.exports = { createCivitaiService, summarizeModel, assertCivitaiUrl, MAX_RESULTS };
