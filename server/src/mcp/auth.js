'use strict';

const { verifyKey, keyPrefix } = require('../platform/api_key');

// MCP 连接器只认用户自己的 OpenElf API Key（Authorization: Bearer <key>）。
// 未通过校验统一抛 401，由 JSON-RPC 层映射为 -32001。
function authError(message = '未授权：缺少或无效的 API Key') {
  const error = new Error(message);
  error.statusCode = 401;
  error.code = 401;
  return error;
}

function readBearer(authorization) {
  if (typeof authorization !== 'string') return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return match ? match[1] : null;
}

// 与 platform/gateway.js 相同的查表方式：key_prefix 定位、key_hash 校验、revoked_at 必须为空。
async function resolveApiKey(db, authorization) {
  const plain = readBearer(authorization);
  if (!plain) throw authError();

  const [rows] = await db.execute(
    'SELECT id, user_id, key_hash, revoked_at FROM platform_api_keys WHERE key_prefix = ? LIMIT 1',
    [keyPrefix(plain)],
  );
  const row = rows[0];
  if (!row || row.revoked_at || !verifyKey(plain, row.key_hash)) throw authError();

  return { userId: row.user_id, keyId: row.id };
}

module.exports = { authError, readBearer, resolveApiKey };
