'use strict';
const crypto = require('node:crypto');

const PUSH_TABLES = [`CREATE TABLE IF NOT EXISTS push_devices (
  platform VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  registration_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id VARCHAR(40) NOT NULL,
  device_id VARCHAR(80) NOT NULL,
  environment VARCHAR(16) NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (platform, registration_id),
  UNIQUE KEY idx_push_device (platform, device_id),
  INDEX idx_push_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`];

function fail(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}
function target(value) {
  if (!value || !['home', 'wallet', 'identity', 'chat', 'elf'].includes(value.route)) {
    throw fail(400, 'INVALID_PUSH_TARGET', '通知跳转目标无效');
  }
  if (['chat', 'elf'].includes(value.route) && !/^[A-Za-z0-9_-]{1,80}$/.test(value.elfId || '')) {
    throw fail(400, 'INVALID_PUSH_TARGET', '缺少有效的 AI 标识');
  }
  return { route: value.route, ...(['chat', 'elf'].includes(value.route) ? { elfId: value.elfId } : {}) };
}
function adminAuthorized(header, token) {
  if (typeof token !== 'string' || token.length < 32) return false;
  const actual = crypto.createHash('sha256').update(String(header || '')).digest();
  const expected = crypto.createHash('sha256').update('Bearer ' + token).digest();
  return crypto.timingSafeEqual(actual, expected);
}

function createPushService({ db, settings, fetchImpl = fetch }) {
  async function bind(user, session, body) {
    if (!settings.enabled) throw fail(503, 'PUSH_DISABLED', '消息通知暂时不可用，请稍后重试');
    if (!['android', 'ios'].includes(body?.platform) ||
        !/^[A-Za-z0-9_-]{8,128}$/.test(body?.registrationId || '') ||
        !['production', 'development'].includes(body?.environment) ||
        !session.device_id) throw fail(400, 'INVALID_PUSH_DEVICE', '推送设备信息无效');
    if (!settings[body.platform]?.appKey || !settings[body.platform]?.masterSecret) {
      throw fail(503, 'PUSH_NOT_CONFIGURED', '消息通知暂时无法连接，请稍后重试');
    }
    // Identity comes only from the authenticated session, never from body.userId.
    // Single atomic upsert transfers this installation when accounts change.
    await db.execute(`INSERT INTO push_devices
      (platform, registration_id, user_id, device_id, environment, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE registration_id = VALUES(registration_id),
      user_id = VALUES(user_id), device_id = VALUES(device_id),
      environment = VALUES(environment), updated_at = VALUES(updated_at)`,
    [body.platform, body.registrationId, user.id, session.device_id, body.environment, Date.now()]);
    return { bound: true };
  }
  async function unbind(user, session) {
    await db.execute('DELETE FROM push_devices WHERE user_id = ? AND device_id = ?', [user.id, session.device_id]);
    return { bound: false };
  }
  async function send(userId, body) {
    if (!settings.enabled) throw fail(503, 'PUSH_DISABLED', '推送尚未启用');
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(userId || '') ||
        typeof body?.title !== 'string' || body.title.length < 1 || body.title.length > 60 ||
        typeof body?.alert !== 'string' || body.alert.length < 1 || body.alert.length > 200) {
      throw fail(400, 'INVALID_PUSH', '通知参数无效');
    }
    const destination = target(body.target);
    // Revoked/expired sessions and disabled accounts are never eligible. Device ID
    // remains stable across refresh-token rotation. No broadcast audience is allowed.
    const [devices] = await db.execute(`SELECT p.* FROM push_devices p
      JOIN users u ON u.id = p.user_id AND u.status = 'active'
      WHERE p.user_id = ? AND EXISTS (SELECT 1 FROM refresh_sessions s
      WHERE s.user_id = p.user_id AND s.device_id = p.device_id
      AND s.revoked_at IS NULL AND s.expires_at > ?)`, [userId, Date.now()]);
    const eventId = crypto.randomUUID();
    const results = [];
    for (const platform of ['android', 'ios']) {
      for (const environment of ['production', 'development']) {
        const ids = devices.filter(d => d.platform === platform && d.environment === environment).map(d => d.registration_id);
        if (!ids.length) continue;
        const credentials = settings[platform];
        if (!credentials?.appKey || !credentials?.masterSecret) {
          throw fail(503, 'PUSH_NOT_CONFIGURED', '对应平台的推送密钥尚未配置');
        }
        for (let offset = 0; offset < ids.length; offset += 1000) {
          const extras = { ...destination, userId, eventId };
          const notification = platform === 'ios'
            ? { ios: { alert: { title: body.title, body: body.alert }, sound: 'default', extras } }
            : { android: { title: body.title, alert: body.alert, extras } };
          let response;
          try {
            response = await fetchImpl('https://api.jpush.cn/v3/push', {
              method: 'POST', signal: AbortSignal.timeout(10000),
              headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' +
                Buffer.from(credentials.appKey + ':' + credentials.masterSecret).toString('base64') },
              body: JSON.stringify({ platform: [platform], audience: { registration_id: ids.slice(offset, offset + 1000) },
                notification, options: { time_to_live: 0, apns_production: environment === 'production' } }),
            });
          } catch (_) { throw fail(502, 'PUSH_PROVIDER_ERROR', '推送服务暂不可用；请先核对发送记录，勿直接重复发送'); }
          if (!response.ok) throw fail(502, 'PUSH_PROVIDER_ERROR', '极光拒绝发送通知');
          let result;
          try { result = await response.json(); } catch (_) { throw fail(502, 'PUSH_PROVIDER_ERROR', '极光返回异常'); }
          if (!result.msg_id) throw fail(502, 'PUSH_PROVIDER_ERROR', '极光返回异常');
          results.push({ platform, environment, messageId: String(result.msg_id), devices: Math.min(1000, ids.length - offset) });
        }
      }
    }
    // Accepted is not proof of device delivery. TTL 0 avoids queued account data.
    return { eventId, accepted: results.reduce((sum, r) => sum + r.devices, 0), results };
  }
  return { bind, unbind, send };
}
module.exports = { PUSH_TABLES, target, adminAuthorized, createPushService };
