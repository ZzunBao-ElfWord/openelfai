'use strict';

// 精灵头像（铸造形象图）渲染：复用 character 自研渲染管线产一张主图 + 一张缩略图，
// 落 server/assets/world，经 GET /api/v1/world-assets/:file 对外提供。
// create_elf 直创、官方精灵种子脚本、存量迁移脚本共用这一个入口，不另造轮子。
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs/promises');

const render = require('./character/render');

const DEFAULT_WORLD_ASSETS_DIR = path.join(__dirname, '..', 'assets', 'world');

/// 头像对外 URL：与 app.js 的 /api/v1/world-assets/:file 静态路由一致。
function avatarAssetUrl(key) {
  return key ? `/api/v1/world-assets/${key}` : null;
}

/// 由精灵/模板标识派生确定性 seed：同一标识重渲染得到同一组合，脚本可安全重跑。
function seedFromId(id) {
  return crypto.createHash('sha256').update(String(id)).digest().readUInt32BE(0) & 0x7fffffff;
}

/// 渲染一张精灵形象图：主图 + 缩略图落盘，返回 key 与对外 URL。
/// renderOptions 透传 renderCard（width/height/scale/thumb*/catalog），测试可给小尺寸加速。
async function renderElfAvatar({ style = null, seed = 0, assetsDir = DEFAULT_WORLD_ASSETS_DIR, renderOptions = {} } = {}) {
  const result = render.renderCard({ style: style || 'general', seed }, renderOptions);
  const imageKey = `elf_${result.compositionHash}.png`;
  const thumbKey = `elf_${result.compositionHash}_thumb.png`;
  await fs.mkdir(assetsDir, { recursive: true });
  await fs.writeFile(path.join(assetsDir, imageKey), result.png);
  await fs.writeFile(path.join(assetsDir, thumbKey), result.thumbPng);
  return {
    imageKey,
    thumbKey,
    imageUrl: avatarAssetUrl(imageKey),
    imageThumbUrl: avatarAssetUrl(thumbKey),
  };
}

module.exports = { DEFAULT_WORLD_ASSETS_DIR, avatarAssetUrl, seedFromId, renderElfAvatar };
