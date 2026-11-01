'use strict';

// 官方精灵头像种子脚本：为 CATALOG 里的官方首发模板（pm_001/pm_002/pm_003）
// 各渲染一张官方形象图（主图 + 缩略图），落 world-assets 目录，
// 并把 { imageUrl, imageThumbUrl, imageKey, thumbKey } 按 templateId 写入平台存储
// （payment_objects, kind = elf_avatar_seed, environment = Production）。
// 图片 URL 不以字面量写进代码模板；购买官方精灵时由 commerce 按 templateId 查种子复制。
// 可重复执行：渲染参数确定（seed 由 templateId 派生），重写同一份文件与种子记录。
//
// 用法:
//   node scripts/seed_official_elf_avatars.js [--assets-dir <dir>] [--dry-run] [--help]

const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');

const { CATALOG } = require('../src/commerce');
const { renderElfAvatar, seedFromId, DEFAULT_WORLD_ASSETS_DIR } = require('../src/elf_avatar');

// 各官方模板的形象风格默认（模板未带风格字段时的合理取值）。
const OFFICIAL_AVATAR_STYLE = { pm_001: 'general', pm_002: 'manga', pm_003: 'impasto' };

const USAGE = `用法: node scripts/seed_official_elf_avatars.js [--assets-dir <dir>] [--dry-run] [--help]
  --assets-dir  形象图落盘目录（默认 server/assets/world）
  --dry-run     只渲染到临时目录并打印将写入的种子数据，不连数据库、不写平台存储
  --help        显示本说明`;

function parseArgs(argv) {
  const options = { assetsDir: DEFAULT_WORLD_ASSETS_DIR, dryRun: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--assets-dir') {
      const value = argv[++index];
      if (!value) throw new Error('--assets-dir 缺少参数值');
      options.assetsDir = path.resolve(value);
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  return options;
}

(async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }

  // dry-run 不连库：渲染到临时目录验证管线，打印计划后即丢弃。
  const assetsDir = options.dryRun
    ? await fs.mkdtemp(path.join(os.tmpdir(), 'elf-avatar-seed-'))
    : options.assetsDir;

  const seeds = {};
  for (const template of CATALOG) {
    const avatar = await renderElfAvatar({
      style: template.avatarStyle || OFFICIAL_AVATAR_STYLE[template.id] || 'general',
      seed: seedFromId(template.id),
      assetsDir,
    });
    seeds[template.id] = avatar;
    console.log(`[seed] ${template.id} ${template.name} -> ${avatar.imageUrl}`);
  }

  if (options.dryRun) {
    console.log('[dry-run] 不写入平台存储，将写入的种子数据：');
    console.log(JSON.stringify(seeds, null, 2));
    await fs.rm(assetsDir, { recursive: true, force: true });
    return;
  }

  const { createPool } = require('../src/db');
  const config = require('../src/config');
  const { createPaymentStore } = require('../src/payment_store');
  const pool = await createPool(config);
  try {
    const store = createPaymentStore(pool);
    await store.transaction('Production', async (tx) => {
      for (const [templateId, avatar] of Object.entries(seeds)) {
        await tx.put('elf_avatar_seed', templateId, {
          templateId,
          imageUrl: avatar.imageUrl,
          imageThumbUrl: avatar.imageThumbUrl,
          imageKey: avatar.imageKey,
          thumbKey: avatar.thumbKey,
          seededAt: new Date().toISOString(),
        }, { state: 'active' });
      }
    });
    console.log(`seeded ${Object.keys(seeds).length} official elf avatars`);
  } finally {
    await pool.end();
  }
})().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
