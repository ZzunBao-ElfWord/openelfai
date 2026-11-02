'use strict';

// generator 模块的 DB 读写：统一走 db.execute（mysql2 风格，返回 [rows]）。

async function listWeightOverrides(db, userId) {
  const [rows] = await db.execute(
    'SELECT layer_id, trait_id, weight FROM generator_weights WHERE user_id = ?',
    [userId],
  );
  const map = new Map();
  for (const row of rows) {
    map.set(`${row.layer_id}:${row.trait_id}`, Number(row.weight));
  }
  return map;
}

async function upsertWeight(db, userId, layerId, traitId, weight) {
  await db.execute(
    `INSERT INTO generator_weights (user_id, layer_id, trait_id, weight, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE weight = VALUES(weight), updated_at = VALUES(updated_at)`,
    [userId, layerId, traitId, weight, Date.now()],
  );
}

async function insertItem(db, record) {
  await db.execute(
    `INSERT INTO generator_items
       (id, user_id, batch_id, idx, seed, traits, rarity_score, rarity_tier, image_key, thumb_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id, record.userId, record.batchId, record.idx, record.seed,
      JSON.stringify(record.traits), record.rarityScore, record.rarityTier,
      record.imageKey, record.thumbKey, record.createdAt,
    ],
  );
}

function rowToItem(row) {
  let traits = [];
  try {
    traits = row.traits ? JSON.parse(row.traits) : [];
  } catch {
    traits = [];
  }
  return {
    id: row.id,
    batchId: row.batch_id,
    idx: row.idx,
    seed: row.seed,
    traits,
    rarity: { score: Number(row.rarity_score), tier: row.rarity_tier },
    imageKey: row.image_key,
    thumbKey: row.thumb_key,
    createdAt: Number(row.created_at),
  };
}

async function getItem(db, userId, id) {
  const [rows] = await db.execute(
    'SELECT * FROM generator_items WHERE id = ? AND user_id = ?',
    [id, userId],
  );
  return rows.length ? rowToItem(rows[0]) : null;
}

async function listItems(db, userId, ids) {
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  const [rows] = await db.execute(
    `SELECT * FROM generator_items WHERE user_id = ? AND id IN (${placeholders}) ORDER BY idx ASC`,
    [userId, ...ids],
  );
  return rows.map(rowToItem);
}

async function insertSubmission(db, record) {
  await db.execute(
    'INSERT INTO generator_submissions (id, user_id, payload, created_at) VALUES (?, ?, ?, ?)',
    [record.id, record.userId, JSON.stringify(record.payload), record.createdAt],
  );
}

// —— App 端画廊 / 我的作品 ——

// LIMIT/OFFSET 直接拼已钳制的整数：部分 MySQL 版本对预处理里的分页占位符支持不稳定。
async function listFeed(db, { limit, offset }) {
  const [rows] = await db.execute(
    `SELECT gi.*, u.nickname AS author_nickname
       FROM generator_items gi
       LEFT JOIN users u ON u.id = gi.user_id
      ORDER BY gi.created_at DESC, gi.id DESC
      LIMIT ${limit} OFFSET ${offset}`,
  );
  const [countRows] = await db.execute('SELECT COUNT(*) AS total FROM generator_items');
  return {
    items: rows.map((row) => ({
      ...rowToItem(row),
      author: row.author_nickname ? { nickname: String(row.author_nickname) } : null,
    })),
    total: Number(countRows[0]?.total || 0),
  };
}

async function listMine(db, userId, { limit, offset }) {
  const [rows] = await db.execute(
    `SELECT * FROM generator_items WHERE user_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit} OFFSET ${offset}`,
    [userId],
  );
  const [countRows] = await db.execute(
    'SELECT COUNT(*) AS total FROM generator_items WHERE user_id = ?',
    [userId],
  );
  return { items: rows.map(rowToItem), total: Number(countRows[0]?.total || 0) };
}

module.exports = {
  listWeightOverrides,
  upsertWeight,
  insertItem,
  getItem,
  listItems,
  insertSubmission,
  listFeed,
  listMine,
};
