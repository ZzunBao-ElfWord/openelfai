'use strict';

// 存量精灵头像迁移脚本（幂等，可重复执行）：
// 扫描 payment_objects 里全部精灵记录，对缺 imageUrl 的精灵补铸造形象图：
//   - 官方模板精灵（按 templateId，老数据回退到 名称+代次 匹配 CATALOG）：复制种子数据
//     （kind = elf_avatar_seed，由 scripts/seed_official_elf_avatars.js 生成）；
//   - UGC 直创精灵：按其 avatarStyle 走 character 渲染管线补图（seed 由精灵 id 派生）。
// 已有头像的精灵跳过；单只失败只记录，不影响后续。
//
// 用法:
//   node scripts/backfill_elf_avatars.js [--assets-dir <dir>] [--limit <n>] [--dry-run] [--help]

const path = require('node:path');

const { CATALOG } = require('../src/commerce');
const { renderElfAvatar, seedFromId, DEFAULT_WORLD_ASSETS_DIR } = require('../src/elf_avatar');

const USAGE = `用法: node scripts/backfill_elf_avatars.js [--assets-dir <dir>] [--limit <n>] [--dry-run] [--help]
  --assets-dir  形象图落盘目录（默认 server/assets/world）
  --limit       最多处理的精灵条数（默认不限制）
  --dry-run     只打印处理计划与汇总，不渲染、不写库
  --help        显示本说明`;

function parseArgs(argv) {
  const options = { assetsDir: DEFAULT_WORLD_ASSETS_DIR, limit: 0, dryRun: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--assets-dir') {
      const value = argv[++index];
      if (!value) throw new Error('--assets-dir 缺少参数值');
      options.assetsDir = path.resolve(value);
    } else if (arg === '--limit') {
      const value = Number(argv[++index]);
      if (!Number.isSafeInteger(value) || value < 0) throw new Error('--limit 必须是非负整数');
      options.limit = value;
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  return options;
}

/// 官方模板识别：优先 elf.templateId（新购买流程写入），老数据按 名称+代次 回退匹配。
function templateIdOf(elf) {
  if (elf.templateId && CATALOG.some((item) => item.id === elf.templateId)) return elf.templateId;
  const found = CATALOG.find((item) => item.name === elf.name
    && Number(item.generation) === Number(elf.generation));
  return found ? found.id : null;
}

(async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }

  const { createPool } = require('../src/db');
  const config = require('../src/config');
  const pool = await createPool(config);
  const summary = { scanned: 0, skipped: 0, seeded: 0, rendered: 0, missingSeed: 0, failed: 0 };
  try {
    const [rows] = await pool.execute(
      "SELECT environment, object_id, payload FROM payment_objects WHERE kind = 'elf'");
    for (const row of rows) {
      if (options.limit && summary.scanned >= options.limit) break;
      let elf;
      try {
        elf = JSON.parse(row.payload);
      } catch (_) {
        continue;
      }
      if (!elf || typeof elf !== 'object' || elf.imageUrl) {
        summary.skipped += 1;
        continue;
      }
      summary.scanned += 1;

      const templateId = templateIdOf(elf);
      let plan;
      if (templateId) {
        const [seedRows] = await pool.execute(
          "SELECT payload FROM payment_objects WHERE environment = ? AND kind = 'elf_avatar_seed' AND object_id = ?",
          [row.environment, templateId]);
        const seedRow = seedRows[0] ? JSON.parse(seedRows[0].payload) : null;
        plan = seedRow
          ? { action: 'seed', templateId, imageUrl: seedRow.imageUrl, imageThumbUrl: seedRow.imageThumbUrl }
          : { action: 'missing_seed', templateId };
      } else {
        plan = { action: 'render', style: elf.avatarStyle || 'general' };
      }

      if (options.dryRun) {
        console.log(`[dry-run] ${row.environment}/${row.object_id} ${elf.name || ''} -> ${plan.action}`
          + (plan.templateId ? ` (${plan.templateId})` : ''));
        if (plan.action === 'seed') summary.seeded += 1;
        else if (plan.action === 'render') summary.rendered += 1;
        else summary.missingSeed += 1;
        continue;
      }

      try {
        if (plan.action === 'seed') {
          elf.imageUrl = plan.imageUrl || null;
          elf.imageThumbUrl = plan.imageThumbUrl || null;
          summary.seeded += 1;
        } else if (plan.action === 'render') {
          const avatar = await renderElfAvatar({
            style: elf.avatarStyle,
            seed: seedFromId(elf.id || row.object_id),
            assetsDir: options.assetsDir,
          });
          elf.imageUrl = avatar.imageUrl;
          elf.imageThumbUrl = avatar.imageThumbUrl;
          summary.rendered += 1;
        } else {
          // 种子缺失不阻断：保持 null，等种子脚本跑完后重跑本脚本即可。
          summary.missingSeed += 1;
          continue;
        }
        if (!elf.templateId && templateId) elf.templateId = templateId;
        await pool.execute(
          "UPDATE payment_objects SET payload = ?, updated_at = ? WHERE environment = ? AND kind = 'elf' AND object_id = ?",
          [JSON.stringify(elf), new Date().toISOString(), row.environment, row.object_id]);
      } catch (error) {
        summary.failed += 1;
        console.warn(`[backfill] ${row.environment}/${row.object_id} 失败：${error.message || error}`);
      }
    }
    console.log('backfill summary:', JSON.stringify(summary));
  } finally {
    await pool.end();
  }
})().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
