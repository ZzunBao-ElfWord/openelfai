'use strict';

/// Civitai 个人收藏库：收藏记录里同时保留「ComfyUI 里的实际文件名」，
/// 只有填了这一项的收藏才能在出图时被直接引用，形成从发现到出图的闭环。
const crypto = require('node:crypto');

const CIVITAI_FAVORITE_TABLES = [
  `CREATE TABLE IF NOT EXISTS civitai_favorites (
    id VARCHAR(48) PRIMARY KEY,
    user_id VARCHAR(40) NOT NULL,
    model_id BIGINT NOT NULL,
    version_id BIGINT NOT NULL DEFAULT 0,
    name VARCHAR(200) NOT NULL,
    type VARCHAR(24) NOT NULL DEFAULT 'LORA',
    base_model VARCHAR(40) NOT NULL DEFAULT '',
    download_url VARCHAR(500) NOT NULL DEFAULT '',
    thumb_url VARCHAR(500) NOT NULL DEFAULT '',
    comfy_name VARCHAR(120) NOT NULL DEFAULT '',
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    UNIQUE KEY uk_user_model_version (user_id, model_id, version_id),
    INDEX idx_civitai_user (user_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

const MAX_FAVORITES_PER_USER = 20;
const MAX_COMFY_NAME_CHARS = 120;

/// ComfyUI 的模型名是相对 models 目录的文件名，禁止路径穿越字符。
function normalizeComfyName(value) {
  const name = String(value || '').trim().slice(0, MAX_COMFY_NAME_CHARS);
  if (!name) return '';
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    throw Object.assign(new Error('ComfyUI 模型名不能包含路径分隔符'), { statusCode: 400 });
  }
  return name;
}

function createCivitaiFavorites({ db }) {
  async function list(userId) {
    const [rows] = await db.execute(
      `SELECT id, model_id, version_id, name, type, base_model, download_url, thumb_url,
              comfy_name, created_at
       FROM civitai_favorites WHERE user_id = ? ORDER BY created_at DESC LIMIT ${MAX_FAVORITES_PER_USER}`,
      [userId],
    );
    return (rows || []).map((row) => ({
      id: row.id,
      modelId: Number(row.model_id),
      versionId: Number(row.version_id) || 0,
      name: row.name,
      type: row.type,
      baseModel: row.base_model || '',
      downloadUrl: row.download_url || '',
      thumbUrl: row.thumb_url || '',
      comfyName: row.comfy_name || '',
      createdAt: Number(row.created_at) || 0,
    }));
  }

  async function add(userId, input = {}) {
    const modelId = Number(input.modelId);
    const versionId = Number(input.versionId) || 0;
    const name = String(input.name || '').trim().slice(0, 200);
    if (!Number.isInteger(modelId) || modelId <= 0) {
      throw Object.assign(new Error('Civitai 模型 ID 无效'), { statusCode: 400 });
    }
    if (!name) throw Object.assign(new Error('模型名称必填'), { statusCode: 400 });

    const type = ['LORA', 'Checkpoint', 'TextualInversion'].includes(input.type)
      ? input.type : 'LORA';
    const comfyName = normalizeComfyName(input.comfyName);

    const existing = await list(userId);
    const duplicated = existing.some((item) => item.modelId === modelId && item.versionId === versionId);
    if (!duplicated && existing.length >= MAX_FAVORITES_PER_USER) {
      throw Object.assign(new Error(`最多收藏 ${MAX_FAVORITES_PER_USER} 个模型`), { statusCode: 400 });
    }

    const id = `cf_${crypto.randomBytes(12).toString('hex')}`;
    const now = Date.now();
    await db.execute(
      `INSERT INTO civitai_favorites
         (id, user_id, model_id, version_id, name, type, base_model, download_url, thumb_url, comfy_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), comfy_name = VALUES(comfy_name),
         updated_at = VALUES(updated_at)`,
      [
        id, userId, modelId, versionId, name, type,
        String(input.baseModel || '').slice(0, 40),
        String(input.downloadUrl || '').slice(0, 500),
        String(input.thumbUrl || '').slice(0, 500),
        comfyName, now, now,
      ],
    );
    return { id, modelId, versionId, name, type: type, comfyName, createdAt: now };
  }

  async function remove(userId, favoriteId) {
    const id = String(favoriteId || '').trim();
    if (!id) throw Object.assign(new Error('缺少收藏标识'), { statusCode: 400 });
    const [result] = await db.execute(
      'DELETE FROM civitai_favorites WHERE id = ? AND user_id = ?', [id, userId],
    );
    if (!result?.affectedRows) throw Object.assign(new Error('没有找到该收藏'), { statusCode: 404 });
    return { id, removed: true };
  }

  /// 出图前把用户引用的收藏名解析成 ComfyUI 文件名列表。
  /// 未收藏或未填 comfyName 的直接忽略，由调用方在返回里告知实际生效的项。
  async function resolveLoras(userId, favoriteIds) {
    const ids = Array.isArray(favoriteIds)
      ? favoriteIds.filter((id) => typeof id === 'string' && id).slice(0, 5) : [];
    if (!ids.length) return [];
    const favorites = await list(userId);
    return favorites
      .filter((item) => ids.includes(item.id) && item.type === 'LORA' && item.comfyName)
      .map((item) => ({ favoriteId: item.id, name: item.name, comfyName: item.comfyName }));
  }

  return { list, add, remove, resolveLoras, MAX_FAVORITES_PER_USER };
}

module.exports = {
  CIVITAI_FAVORITE_TABLES,
  createCivitaiFavorites,
  normalizeComfyName,
  MAX_FAVORITES_PER_USER,
};
