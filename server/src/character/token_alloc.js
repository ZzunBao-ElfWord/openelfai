'use strict';

// 全平台 tokenId 分配器：character_token_alloc 单行记录 next_id，
// UGC 单角色铸造（P3）与 B2B 系列铸造（P4）共用，保证两条线不会撞号。
// 首次分配时按 character_mints / character_series_items 现有最大 token_id 初始化。

/// 真实库用连接开事务；内存/假 DB 没有 getConnection 时退化为直接执行。
async function withTransaction(db, work) {
  if (typeof db.getConnection !== 'function') {
    return work({
      execute: async (sql, params = []) => {
        const result = await db.execute(sql, params);
        return Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
      },
    });
  }
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work({
      execute: async (sql, params = []) => (await connection.execute(sql, params))[0],
    });
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function maxTokenId(tx, table) {
  const rows = await tx.execute(`SELECT MAX(token_id) AS max_token FROM ${table}`);
  return Number(rows?.[0]?.max_token || 0);
}

/// 在事务内分配一段连续 tokenId：SELECT ... FOR UPDATE → 推进 next_id。
async function allocateTokenIdsIn(tx, count) {
  const size = Math.max(0, Math.floor(Number(count) || 0));
  if (size === 0) return { start: null, end: null, count: 0 };

  const rows = await tx.execute('SELECT next_id FROM character_token_alloc WHERE id = 1 FOR UPDATE');
  let next = Number(rows?.[0]?.next_id);
  if (!Number.isSafeInteger(next) || next <= 0) {
    // 首次分配或记录损坏：取两张业务表的最大 token_id + 1 作为起点。
    const mintMax = await maxTokenId(tx, 'character_mints');
    const itemMax = await maxTokenId(tx, 'character_series_items');
    next = Math.max(mintMax, itemMax) + 1;
    await tx.execute(
      'INSERT INTO character_token_alloc (id, next_id) VALUES (1, ?)',
      [next + size],
    );
  } else {
    await tx.execute(
      'UPDATE character_token_alloc SET next_id = ? WHERE id = 1',
      [next + size],
    );
  }

  return { start: next, end: next + size - 1, count: size };
}

async function allocateTokenIds(db, count) {
  if (!db) throw new Error('数据库未就绪');
  const size = Math.max(0, Math.floor(Number(count) || 0));
  if (size === 0) return { start: null, end: null, count: 0 };
  return withTransaction(db, (tx) => allocateTokenIdsIn(tx, size));
}

module.exports = { allocateTokenIds, allocateTokenIdsIn, withTransaction };
