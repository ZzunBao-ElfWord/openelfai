'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');

const render = require('./render');
const partsStore = require('./parts_store');
const { createCanvas } = require('./png');
const {
  claimComposition,
  DEFAULT_ASSETS_DIR,
  MAX_GENERATE_ATTEMPTS,
} = require('./store');

const MIN_COUNT = 1;
const MAX_COUNT = 200;
const DEFAULT_STYLE = 'anime';
const STYLE_RE = /^[a-z0-9_-]{1,24}$/i;
const MAX_NAME = 64;
const MAX_CREATED_BY = 40;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;
const SHEET_COLUMNS = 3;
const SHEET_GAP = 8;

function batchError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function publicBatch(row) {
  return {
    id: row.id,
    name: row.name || '',
    style: row.style || DEFAULT_STYLE,
    count: Number(row.count || 0),
    seedStart: Number(row.seed_start || 0),
    sheetKey: row.sheet_key || null,
    createdBy: row.created_by || '',
    createdAt: Number(row.created_at || 0),
  };
}

function manifestPath(assetsDir, id) {
  return path.join(assetsDir, 'batches', `${id}.json`);
}

// 联系表：3 列网格，直接把每张缩略图重绘到同一张大画布上，再由 png.js 编码。
function buildContactSheet(items, catalog) {
  const cellWidth = render.THUMB_WIDTH;
  const cellHeight = render.THUMB_HEIGHT;
  const rows = Math.ceil(items.length / SHEET_COLUMNS);
  const width = SHEET_COLUMNS * cellWidth + (SHEET_COLUMNS + 1) * SHEET_GAP;
  const height = rows * cellHeight + (rows + 1) * SHEET_GAP;
  const sheet = createCanvas(width, height, { scale: 1 });
  sheet.fillRect(0, 0, width, height, '#0b0e14');

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const cell = createCanvas(cellWidth, cellHeight, { scale: 1 });
    render.drawScene(cell, {
      traits: item.traits,
      rngSeed: `character-render:${item.compositionHash}`,
      catalog,
    });
    const column = index % SHEET_COLUMNS;
    const row = Math.floor(index / SHEET_COLUMNS);
    const offsetX = SHEET_GAP + column * (cellWidth + SHEET_GAP);
    const offsetY = SHEET_GAP + row * (cellHeight + SHEET_GAP);
    for (let line = 0; line < cellHeight; line += 1) {
      const from = line * cellWidth * 4;
      cell.data.copy(
        sheet.data,
        ((offsetY + line) * width + offsetX) * 4,
        from,
        from + cellWidth * 4,
      );
    }
  }
  return sheet.toPng();
}

// 批量生成：串行渲染，seed 依次递增；单条失败只记录 error，不影响后续条目。
async function createBatch(db, input = {}, options = {}) {
  const count = Number(input.count);
  if (!Number.isInteger(count) || count < MIN_COUNT || count > MAX_COUNT) {
    throw batchError(400, 'INVALID_COUNT', `count 必须是 ${MIN_COUNT}-${MAX_COUNT} 的整数`);
  }
  const style = input.style === undefined || input.style === null ? DEFAULT_STYLE : String(input.style);
  if (!STYLE_RE.test(style)) {
    throw batchError(400, 'INVALID_STYLE', 'style 只能由字母、数字、下划线或短横线组成（1-24 位）');
  }
  let seedStart = Number(input.seedStart);
  if (input.seedStart === undefined || input.seedStart === null) {
    seedStart = Math.floor(Math.random() * 0x7fffffff);
  } else if (!Number.isSafeInteger(seedStart) || seedStart < 0) {
    throw batchError(400, 'INVALID_SEED', 'seedStart 必须是非负整数');
  }
  const name = String(input.name || '').trim().slice(0, MAX_NAME) || `批次 ${style}`;
  const createdBy = String(input.createdBy || 'ops').trim().slice(0, MAX_CREATED_BY);
  const assetsDir = options.assetsDir || DEFAULT_ASSETS_DIR;
  const renderOptions = { ...(options.renderOptions || {}) };
  const catalog = await partsStore.getCatalog(db);

  const id = crypto.randomBytes(16).toString('hex');
  const createdAt = Date.now();
  const items = [];
  const succeeded = [];
  let nextSeed = seedStart;

  for (let index = 0; index < count; index += 1) {
    const itemSeed = nextSeed;
    let usedSeed = itemSeed;
    let result = null;
    let lastError = null;

    for (let attempt = 0; attempt < MAX_GENERATE_ATTEMPTS; attempt += 1) {
      try {
        const rendered = render.renderCard({ style, seed: usedSeed }, { ...renderOptions, catalog });
        if (!(await claimComposition(db, rendered.compositionHash, id))) {
          usedSeed += 1;
          continue;
        }
        result = rendered;
        break;
      } catch (error) {
        lastError = error;
        break;
      }
    }

    nextSeed = usedSeed + 1;
    if (!result) {
      items.push({
        index,
        seed: usedSeed,
        error: String(lastError?.message || '组合冲突过多').slice(0, 255),
      });
      continue;
    }

    const hash = result.compositionHash;
    const imageKey = `char_${hash}.png`;
    const thumbKey = `char_${hash}_thumb.png`;
    try {
      await fs.mkdir(assetsDir, { recursive: true });
      await fs.writeFile(path.join(assetsDir, imageKey), result.png);
      await fs.writeFile(path.join(assetsDir, thumbKey), result.thumbPng);
    } catch (error) {
      items.push({ index, seed: usedSeed, error: String(error.message || '写入失败').slice(0, 255) });
      continue;
    }

    const item = {
      index,
      seed: usedSeed,
      compositionHash: hash,
      imageKey,
      thumbKey,
      traits: result.traits,
      rarityScore: result.rarityScore,
      rarityTier: result.rarityTier,
    };
    items.push(item);
    succeeded.push(item);
  }

  if (!succeeded.length) {
    throw batchError(500, 'BATCH_FAILED', '整批生成均失败，请检查配件目录后重试');
  }

  const sheetKey = `batch_${id}_sheet.png`;
  await fs.mkdir(assetsDir, { recursive: true });
  await fs.writeFile(path.join(assetsDir, sheetKey), buildContactSheet(succeeded, catalog));

  const manifest = {
    id, name, style, count, seedStart, sheetKey, createdBy, createdAt, items,
  };
  await fs.mkdir(path.join(assetsDir, 'batches'), { recursive: true });
  await fs.writeFile(manifestPath(assetsDir, id), JSON.stringify(manifest));

  await db.execute(
    `INSERT INTO character_batches
      (id, name, style, count, seed_start, sheet_key, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, name, style, count, seedStart, sheetKey, createdBy, createdAt],
  );

  return { ...manifest };
}

async function listBatches(db, limit) {
  const size = Math.max(1, Math.min(MAX_LIMIT, Number(limit) || DEFAULT_LIMIT));
  const [rows] = await db.execute(
    'SELECT * FROM character_batches ORDER BY created_at DESC LIMIT ?',
    [size],
  );
  return rows.map(publicBatch);
}

// 清单优先从磁盘读；文件丢失时退化为数据库摘要。
async function getBatch(db, id, options = {}) {
  const assetsDir = options.assetsDir || DEFAULT_ASSETS_DIR;
  const [rows] = await db.execute('SELECT * FROM character_batches WHERE id = ?', [id]);
  const row = rows[0];
  if (!row) throw batchError(404, 'BATCH_NOT_FOUND', '批次不存在');
  try {
    const manifest = JSON.parse(await fs.readFile(manifestPath(assetsDir, row.id), 'utf8'));
    return { ...publicBatch(row), items: Array.isArray(manifest.items) ? manifest.items : [] };
  } catch (_) {
    return publicBatch(row);
  }
}

module.exports = {
  MIN_COUNT,
  MAX_COUNT,
  DEFAULT_STYLE,
  batchError,
  buildContactSheet,
  publicBatch,
  createBatch,
  listBatches,
  getBatch,
};
