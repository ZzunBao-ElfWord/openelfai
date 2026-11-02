'use strict';

// 铸造成功后的中间候选图清理：
// 依据批次 manifest（<assetsDir>/batches/<id>.json）的候选清单，
// 删除该批次未当选候选的主图/缩略图与联系表 PNG；manifest JSON 本身保留。
// 安全边界：
//   - 只处理「候选清单里包含当选 image_key」的那一个 manifest，其他批次一律不动；
//   - 只删白名单文件名（char_<64hex>.png / char_<64hex>_thumb.png / batch_<32hex>_sheet.png），
//     且必须落在 assetsDir 根下（basename 校验，防路径穿越）；
//   - 仍被任意角色卡或系列明细引用的文件不删；
//   - 任何失败只记日志，绝不影响铸造结果。
const path = require('node:path');
const fs = require('node:fs/promises');

const CANDIDATE_RE = /^char_[a-f0-9]{64}(_thumb)?\.png$/;
const SHEET_RE = /^batch_[a-f0-9]{32}_sheet\.png$/;

// 候选图仍被角色卡或系列明细引用时不删，避免误伤其他在制品；
// 引用检查本身失败时按「被引用」处理，宁可不删。
async function isReferenced(db, key) {
  try {
    const [cards] = await db.execute(
      'SELECT id FROM character_cards WHERE image_key = ? OR thumb_key = ? LIMIT 1', [key, key]);
    if (cards.length) return true;
    const [items] = await db.execute(
      'SELECT id FROM character_series_items WHERE image_key = ? OR thumb_key = ? LIMIT 1', [key, key]);
    return items.length > 0;
  } catch (_) {
    return true;
  }
}

async function cleanupBatchCandidates({ db, assetsDir, imageKey, thumbKey, logger } = {}) {
  const result = { matched: null, removed: 0, kept: 0 };
  if (!db || !assetsDir || !imageKey) return result;
  const keep = new Set([imageKey, thumbKey].filter(Boolean));

  let files;
  try {
    files = await fs.readdir(path.join(assetsDir, 'batches'));
  } catch (_) {
    return result; // 没有批次目录：当选图不是批次候选来源，无需清理。
  }

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    let manifest;
    try {
      manifest = JSON.parse(await fs.readFile(path.join(assetsDir, 'batches', file), 'utf8'));
    } catch (_) {
      continue; // 损坏的 manifest 跳过，不影响其他批次。
    }
    const items = Array.isArray(manifest?.items) ? manifest.items : [];
    if (!items.some((item) => item && item.imageKey === imageKey)) continue;
    result.matched = manifest.id || file;

    const targets = [];
    for (const item of items) {
      for (const key of [item?.imageKey, item?.thumbKey]) {
        if (typeof key === 'string' && CANDIDATE_RE.test(key) && !keep.has(key)) targets.push(key);
      }
    }
    if (typeof manifest.sheetKey === 'string' && SHEET_RE.test(manifest.sheetKey)) {
      targets.push(manifest.sheetKey);
    }
    for (const key of targets) {
      if (path.basename(key) !== key) continue;
      if (await isReferenced(db, key)) {
        result.kept += 1;
        continue;
      }
      try {
        await fs.unlink(path.join(assetsDir, key));
        result.removed += 1;
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          logger?.warn?.({ err: error, key }, 'batch candidate cleanup failed');
        }
      }
    }
    break; // 一个候选只属于一个批次，命中后即结束。
  }
  return result;
}

module.exports = { cleanupBatchCandidates, CANDIDATE_RE, SHEET_RE };
