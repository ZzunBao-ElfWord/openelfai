'use strict';

const parts = require('./parts');

// 配件目录的运营层：内置目录首次入库做默认值，之后以数据库为准。
const SLOT_LABELS = {
  background: '背景',
  body: '身体',
  bottom: '下装',
  outfit: '上装',
  outer: '外套',
  shoes: '鞋',
  hair: '头发',
  accessory: '配饰',
  expression: '表情',
};

const PART_RARITIES = new Set(['common', 'rare', 'epic', 'legendary']);
const PART_STATUSES = new Set(['enabled', 'disabled']);

// 每个 db 实例只播种一次；首次调用时幂等写入缺失的内置配件。
const SEEDED_DBS = new WeakSet();

function partError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function publicPart(row) {
  return {
    id: row.id,
    name: row.name,
    slot: row.slot,
    weight: Number(row.weight),
    rarity: row.rarity,
    status: row.status,
  };
}

async function ensureSeeded(db) {
  if (SEEDED_DBS.has(db)) return;
  for (const slot of parts.SLOT_ORDER) {
    const traits = parts.getCatalog()[slot] || [];
    for (let index = 0; index < traits.length; index += 1) {
      const trait = traits[index];
      // 只补缺失行，不覆盖运营已改过的 weight/rarity/status。
      await db.execute(
        `INSERT INTO character_parts (id, slot, name, weight, rarity, draw, sort, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE id = id`,
        [
          trait.id, slot, trait.name, trait.weight, trait.rarity,
          JSON.stringify(trait.draw || null), index, 'enabled',
        ],
      );
    }
  }
  SEEDED_DBS.add(db);
}

// 组装运营后台用的目录：9 个 slot 全部返回，comboSpace 只统计 enabled 配件。
async function listParts(db) {
  await ensureSeeded(db);
  const [rows] = await db.execute('SELECT * FROM character_parts ORDER BY sort ASC, id ASC');
  const bySlot = new Map();
  for (const row of rows) {
    if (!bySlot.has(row.slot)) bySlot.set(row.slot, []);
    bySlot.get(row.slot).push(row);
  }
  const slots = parts.SLOT_ORDER.map((slot) => ({
    slot,
    label: SLOT_LABELS[slot] || slot,
    parts: (bySlot.get(slot) || []).map(publicPart),
  }));
  let comboSpace = 1;
  for (const slot of parts.SLOT_ORDER) {
    const enabled = (bySlot.get(slot) || []).filter((row) => row.status === 'enabled').length;
    comboSpace *= enabled;
  }
  return { slots, comboSpace };
}

// 运营覆盖后的渲染目录：只取 enabled 配件，draw 保留给渲染器使用。
async function getCatalog(db) {
  await ensureSeeded(db);
  const [rows] = await db.execute(
    "SELECT * FROM character_parts WHERE status = ? ORDER BY sort ASC, id ASC",
    ['enabled'],
  );
  const catalog = {};
  for (const slot of parts.SLOT_ORDER) catalog[slot] = [];
  for (const row of rows) {
    if (!parts.SLOT_ORDER.includes(row.slot)) continue;
    let draw = null;
    if (row.draw) {
      try {
        draw = typeof row.draw === 'string' ? JSON.parse(row.draw) : row.draw;
      } catch (_) {
        draw = null;
      }
    }
    if (!draw) draw = parts.getTrait(row.slot, row.id)?.draw || null;
    catalog[row.slot].push({
      id: row.id,
      name: row.name,
      weight: Number(row.weight),
      rarity: row.rarity,
      draw,
    });
  }
  return catalog;
}

async function updatePart(db, id, input = {}) {
  await ensureSeeded(db);
  const [rows] = await db.execute('SELECT * FROM character_parts WHERE id = ?', [id]);
  const existing = rows[0];
  if (!existing) throw partError(404, 'PART_NOT_FOUND', '配件不存在');

  const patch = {};
  if (input.weight !== undefined) {
    const weight = Number(input.weight);
    if (!Number.isInteger(weight) || weight < 1 || weight > 100) {
      throw partError(400, 'INVALID_WEIGHT', 'weight 必须是 1-100 的整数');
    }
    patch.weight = weight;
  }
  if (input.rarity !== undefined) {
    if (!PART_RARITIES.has(input.rarity)) {
      throw partError(400, 'INVALID_RARITY', 'rarity 只能是 common/rare/epic/legendary');
    }
    patch.rarity = input.rarity;
  }
  if (input.status !== undefined) {
    if (!PART_STATUSES.has(input.status)) {
      throw partError(400, 'INVALID_STATUS', 'status 只能是 enabled/disabled');
    }
    patch.status = input.status;
  }
  if (!Object.keys(patch).length) {
    throw partError(400, 'INVALID_PART_UPDATE', '请至少提供 weight、rarity 或 status');
  }

  const columns = Object.keys(patch).map((field) => `${field} = ?`);
  const values = Object.values(patch);
  await db.execute(`UPDATE character_parts SET ${columns.join(', ')} WHERE id = ?`, [...values, id]);

  const [updated] = await db.execute('SELECT * FROM character_parts WHERE id = ?', [id]);
  return publicPart(updated[0]);
}

module.exports = {
  SLOT_LABELS,
  PART_RARITIES,
  PART_STATUSES,
  partError,
  ensureSeeded,
  listParts,
  getCatalog,
  updatePart,
};
