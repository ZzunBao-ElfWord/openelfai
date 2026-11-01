'use strict';

/// 媒体能力的每日用量：语音与出图都是平台买单，按「用户 + 能力 + 自然日」累计。
/// 配额是软限制（先读后写存在轻微并发超限），与记忆抽取的取舍一致。
const MEDIA_TABLES = [
  `CREATE TABLE IF NOT EXISTS media_daily_usage (
    id VARCHAR(120) PRIMARY KEY,
    user_id VARCHAR(40) NOT NULL,
    kind VARCHAR(16) NOT NULL,
    day VARCHAR(8) NOT NULL,
    calls INT NOT NULL DEFAULT 0,
    units INT NOT NULL DEFAULT 0,
    updated_at BIGINT NOT NULL,
    INDEX idx_media_user_day (user_id, day)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

function dayKey(now = new Date()) {
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}${mm}${dd}`;
}

function createMediaUsage({ db }) {
  async function read(userId, kind, day = dayKey()) {
    const id = `${userId}:${kind}:${day}`;
    const [rows] = await db.execute(
      'SELECT calls FROM media_daily_usage WHERE id = ? LIMIT 1', [id],
    );
    return { calls: Number(rows?.[0]?.calls) || 0 };
  }

  /// 先校验再自增：超出配额抛 429，调用方据此给客户端明确提示。
  async function consume(userId, kind, { limit, units = 0 } = {}) {
    const day = dayKey();
    const { calls } = await read(userId, kind, day);
    if (limit && calls >= limit) {
      throw Object.assign(new Error('今日额度已用完，请明天再试'), { statusCode: 429 });
    }
    const id = `${userId}:${kind}:${day}`;
    await db.execute(
      `INSERT INTO media_daily_usage (id, user_id, kind, day, calls, units, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)
       ON DUPLICATE KEY UPDATE calls = calls + 1, units = units + VALUES(units),
         updated_at = VALUES(updated_at)`,
      [id, userId, kind, day, units, Date.now()],
    );
    return { used: calls + 1, limit: limit || null };
  }

  return { read, consume, dayKey };
}

module.exports = { MEDIA_TABLES, createMediaUsage, dayKey };
