'use strict';
const { generateKey, hashKey } = require('./api_key');
const { encrypt, decrypt } = require('./secret');

const DEFAULT_KEY_NAME = '默认密钥';
const DEFAULT_QPS_LIMIT = 5;
const INSERT_KEY_SQL = `INSERT INTO platform_api_keys
    (id, user_id, name, key_prefix, key_hash, key_cipher, is_default, qps_limit, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function keyError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

async function getDefaultKeyRow(db, userId) {
  const [rows] = await db.execute(
    `SELECT * FROM platform_api_keys
     WHERE user_id = ? AND is_default = 1
     ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  return rows[0] || null;
}

async function insertDefaultKey(executor, userId, now) {
  const generated = generateKey();
  const keyHash = hashKey(generated.plain);
  const keyCipher = encrypt(generated.plain);

  await executor.execute(INSERT_KEY_SQL, [
    generated.id,
    userId,
    DEFAULT_KEY_NAME,
    generated.prefix,
    keyHash,
    keyCipher,
    1,
    DEFAULT_QPS_LIMIT,
    now,
  ]);

  return {
    row: {
      id: generated.id,
      user_id: userId,
      name: DEFAULT_KEY_NAME,
      key_prefix: generated.prefix,
      key_hash: keyHash,
      key_cipher: keyCipher,
      is_default: 1,
      qps_limit: DEFAULT_QPS_LIMIT,
      created_at: now,
      revoked_at: null,
    },
    plain: generated.plain,
  };
}

async function ensureDefaultKey(db, userId) {
  const existing = await getDefaultKeyRow(db, userId);
  // 管理员吊销即视为禁用，不自动重建。
  if (existing) return { row: existing, created: false };

  const { row, plain } = await insertDefaultKey(db, userId, Date.now());
  return { row, created: true, plain };
}

async function getDefaultKeyPlain(db, userId) {
  const row = await getDefaultKeyRow(db, userId);
  if (!row || row.revoked_at || !row.key_cipher) return null;
  try {
    return decrypt(row.key_cipher);
  } catch (_) {
    return null;
  }
}

async function revealDefaultKey(db, userId) {
  const { row, created, plain } = await ensureDefaultKey(db, userId);
  if (row.revoked_at) {
    throw keyError(409, 'key_revoked', '该密钥已被禁用，请重置');
  }
  if (created) return plain;
  if (!row.key_cipher) {
    throw keyError(409, 'key_unavailable', '密钥不可用，请重置');
  }
  try {
    return decrypt(row.key_cipher);
  } catch (_) {
    throw keyError(409, 'key_unavailable', '密钥不可用，请重置');
  }
}

async function rotateDefaultKey(db, userId) {
  const now = Date.now();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `UPDATE platform_api_keys
       SET revoked_at = ?
       WHERE user_id = ? AND is_default = 1 AND revoked_at IS NULL`,
      [now, userId],
    );
    const { row, plain } = await insertDefaultKey(connection, userId, now);
    await connection.commit();
    return { plain, prefix: row.key_prefix, createdAt: row.created_at };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  ensureDefaultKey,
  getDefaultKeyRow,
  getDefaultKeyPlain,
  revealDefaultKey,
  rotateDefaultKey,
};
