'use strict';

const crypto = require('node:crypto');
const Fastify = require('fastify');
const rateLimit = require('@fastify/rate-limit');

const config = require('./config');
const { createPool } = require('./db');
const { createAppleIapService, createAppleVerifier } = require('./apple_iap');
const { createPaymentStore } = require('./payment_store');
const { createCommerceService } = require('./commerce');
const { createAlipayGateway } = require('./alipay_gateway');
const { createAlipayService } = require('./alipay');
const { createCaptchaVerifier } = require('./captcha');
const { createSmsProvider, SmsError } = require('./sms');
const {
  generateRefreshToken,
  generateSmsCode,
  hashRefreshToken,
  hmacHex,
  secureEqualHex,
  signAccessToken,
  verifyAccessToken,
} = require('./security');

const PHONE_RE = /^1[3-9]\d{9}$/;
const DEVICE_RE = /^[A-Za-z0-9_-]{8,80}$/;
const CODE_RE = /^\d{6}$/;

function fail(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function readPhone(body) {
  const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
  if (!PHONE_RE.test(phone)) {
    throw fail(400, 'INVALID_PHONE', '请输入正确的手机号');
  }
  return phone;
}

function readCode(body) {
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  if (!CODE_RE.test(code)) {
    throw fail(400, 'INVALID_CODE', '请输入 6 位验证码');
  }
  return code;
}

function readDeviceId(body) {
  const deviceId = typeof body?.deviceId === 'string' ? body.deviceId.trim() : '';
  if (!DEVICE_RE.test(deviceId)) {
    throw fail(400, 'INVALID_DEVICE', '设备信息缺失，请重新打开应用');
  }
  return deviceId;
}

function publicUser(row) {
  return {
    id: row.id,
    phone: row.phone,
    nickname: row.nickname,
    avatarInitial: row.avatar_initial,
    createdAt: row.created_at,
  };
}

async function buildApp(options = {}) {
  const ownsDb = !options.db;
  const db = options.db || (await createPool(config));
  const sms = options.sms || createSmsProvider(config);
  const captcha = options.captcha || createCaptchaVerifier(config.captcha);
  const appleVerifier = options.appleVerifier || (config.appleIap.enabled
    ? await createAppleVerifier(config.appleIap) : null);
  const paymentStore = options.paymentStore || createPaymentStore(db);
  const commerce = createCommerceService({ store: paymentStore, settings: config.appleIap });
  const appleIap = createAppleIapService({
    db,
    settings: config.appleIap,
    verifyTransaction: appleVerifier,
    paymentStore,
    verifyNotification: options.appleNotificationVerifier,
  });
  const androidCommerce = createCommerceService({ store: paymentStore, settings: config.androidCommerce });
  const alipay = createAlipayService({ store: paymentStore, settings: config.alipay,
    commerceSettings: config.androidCommerce,
    gateway: options.alipayGateway || createAlipayGateway(config.alipay) });

  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: process.env.LOG_LEVEL || 'info',
            redact: ['req.headers.authorization'],
          },
    trustProxy: config.trustProxy,
    bodyLimit: 16 * 1024,
  });

  app.decorate('db', db);

  app.register(rateLimit, {
    global: true,
    max: 120,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      error: { code: 'RATE_LIMITED', message: '操作过于频繁，请稍后再试' },
    }),
  });

  app.setErrorHandler((error, request, reply) => {
    const status = Number(error.statusCode);
    const safeStatus = status >= 400 && status < 600 ? status : 500;

    if (safeStatus >= 500) {
      request.log.error({ err: error }, 'request failed');
    }

    reply.code(safeStatus).send({
      error: {
        code: error.code || (safeStatus >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST'),
        message: safeStatus >= 500 ? '服务暂时不可用' : error.message,
      },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      error: { code: 'NOT_FOUND', message: '接口不存在' },
    });
  });

  if (ownsDb) {
    app.addHook('onClose', async () => {
      await db.end();
    });
  }

  // —— 会话签发 ——

  async function issueSession(user, deviceId, request) {
    const now = Date.now();
    const sessionId = crypto.randomUUID();
    const refreshToken = generateRefreshToken();

    await db.execute(
      `INSERT INTO refresh_sessions
        (id, user_id, token_hash, device_id, created_at, expires_at,
         rotated_from, revoked_at, last_used_at, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        user.id,
        hashRefreshToken(config.refreshPepper, refreshToken),
        deviceId,
        now,
        now + config.refreshTtlSec * 1000,
        null,
        null,
        now,
        request.ip || '',
        String(request.headers['user-agent'] || '').slice(0, 255),
      ],
    );

    const accessToken = signAccessToken({
      secret: config.jwtSecret,
      userId: user.id,
      sessionId,
      ttlSec: config.accessTtlSec,
    });

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: config.accessTtlSec,
      refreshExpiresIn: config.refreshTtlSec,
      user: publicUser(user),
    };
  }

  async function authenticate(request) {
    const header = String(request.headers.authorization || '');
    const match = /^Bearer\s+([^\s]+)$/i.exec(header);
    if (!match) {
      throw fail(401, 'UNAUTHORIZED', '请先登录');
    }

    let payload;
    try {
      payload = verifyAccessToken(config.jwtSecret, match[1]);
    } catch (_) {
      throw fail(401, 'UNAUTHORIZED', '登录已失效，请重新登录');
    }

    if (payload.typ !== 'access' || typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
      throw fail(401, 'UNAUTHORIZED', '登录已失效，请重新登录');
    }

    const [sessions] = await db.execute('SELECT * FROM refresh_sessions WHERE id = ?', [
      payload.sid,
    ]);
    const session = sessions[0];

    if (!session || session.user_id !== payload.sub || session.revoked_at || Number(session.expires_at) <= Date.now()) {
      throw fail(401, 'SESSION_EXPIRED', '登录状态已失效，请重新登录');
    }

    const [users] = await db.execute('SELECT * FROM users WHERE id = ?', [payload.sub]);
    const user = users[0];
    if (!user || user.status !== 'active') {
      throw fail(401, 'UNAUTHORIZED', '账号不可用');
    }

    return { user, session };
  }

  async function ensureUser(phone) {
    const nowIso = new Date().toISOString();
    const [rows] = await db.execute('SELECT * FROM users WHERE phone = ?', [phone]);

    if (rows.length > 0) {
      await db.execute('UPDATE users SET last_login_at = ? WHERE id = ?', [nowIso, rows[0].id]);
      return { ...rows[0], last_login_at: nowIso };
    }

    const user = {
      id: `u_${crypto.randomUUID().replace(/-/g, '')}`,
      phone,
      nickname: `用户${phone.slice(-4)}`,
      avatar_initial: '用',
      status: 'active',
      created_at: nowIso,
      last_login_at: nowIso,
    };

    try {
      await db.execute(
        `INSERT INTO users (id, phone, nickname, avatar_initial, status, created_at, last_login_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [user.id, phone, user.nickname, user.avatar_initial, user.status, user.created_at, nowIso],
      );
      return user;
    } catch (error) {
      // 并发注册同一手机号时回查已有用户。
      if (error.code === 'ER_DUP_ENTRY') {
        const [existing] = await db.execute('SELECT * FROM users WHERE phone = ?', [phone]);
        if (existing.length > 0) return existing[0];
      }
      throw error;
    }
  }

  // —— 健康检查 ——

  app.get('/api/v1/health', async () => ({
    ok: true,
    time: new Date().toISOString(),
  }));

  // 内购默认关闭。商品未在 App Store Connect 建立、服务端未准备好前不会展示购买按钮。
  app.get('/api/v1/ios/products', async (request) => {
    const { user } = await authenticate(request);
    return {
      protocol: 2,
      mode: commerce.environment(request.query?.environment).toLowerCase(),
      appAccountToken: appleIap.accountToken(user.id),
      products: appleIap.listProducts(),
    };
  });

  app.get('/api/v1/wallet', async (request) => {
    const { user } = await authenticate(request);
    return commerce.snapshot(user, request.query?.environment);
  });

  app.post(
    '/api/v1/ios/verify',
    { config: { rateLimit: { max: 15, timeWindow: '1 minute' } } },
    async (request) => {
      const { user } = await authenticate(request);
      const result = await appleIap.verifyAndGrant(user.id, request.body);
      return { ...result, ...await commerce.snapshot(user, result.mode) };
    },
  );

  app.post('/api/v1/commerce/actions',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request) => {
      const { user } = await authenticate(request);
      return commerce.action(user, request.body);
    });

  // Public webhook: trust only Apple's verified outer and inner JWS signatures.
  for (const environment of ['Production', 'Sandbox']) {
    app.post('/api/v1/ios/notifications/' + environment.toLowerCase(),
      { bodyLimit: 256 * 1024, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
      (request) => appleIap.notification(request.body, environment));
  }

  // Android Alipay: intentionally separate from Apple availability switches.
  function requireAndroidCommerce() {
    if (!config.androidCommerce.enabled) throw fail(503, 'ANDROID_COMMERCE_DISABLED', '安卓钱包服务尚未开放');
  }
  app.get('/api/v1/android/wallet', async (request) => {
    const { user } = await authenticate(request); requireAndroidCommerce();
    return androidCommerce.snapshot(user, alipay.environment);
  });
  app.post('/api/v1/android/commerce/actions', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request) => {
    const { user } = await authenticate(request); requireAndroidCommerce();
    if (request.body?.environment?.toLowerCase() !== alipay.environment.toLowerCase()) throw fail(400, 'INVALID_ENVIRONMENT', '安卓钱包环境不匹配');
    return androidCommerce.action(user, { ...request.body, environment: alipay.environment });
  });
  app.get('/api/v1/android/alipay/products', async (request) => {
    await authenticate(request); return alipay.products();
  });
  app.get('/api/v1/android/alipay/pending', async (request) => {
    const { user } = await authenticate(request); requireAndroidCommerce(); return alipay.pending(user);
  });
  app.post('/api/v1/android/alipay/orders', { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } }, async (request) => {
    const { user } = await authenticate(request); return alipay.create(user, request.body);
  });
  app.get('/api/v1/android/alipay/orders/:id', async (request) => {
    const { user } = await authenticate(request);
    const result = await alipay.refresh(user.id, request.params.id);
    return { ...result, ...await androidCommerce.snapshot(user, alipay.environment) };
  });
  app.post('/api/v1/android/alipay/orders/:id/pay', async (request) => {
    const { user } = await authenticate(request); return alipay.resume(user, request.params.id);
  });
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 65536 }, (_request, body, done) => {
    try {
      const data = Object.create(null);
      for (const [key, value] of new URLSearchParams(body)) {
        if (Object.hasOwn(data, key) || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Duplicate form field');
        data[key] = value;
      }
      done(null, data);
    } catch (_) { done(fail(400, 'INVALID_FORM', '表单格式无效')); }
  });
  app.post('/api/v1/android/alipay/notify', { bodyLimit: 65536 }, async (request, reply) => {
    // Plain text success is Alipay's required acknowledgement, never a client grant.
    try { await alipay.notify(request.body); return reply.type('text/plain').send('success'); }
    catch (_) { return reply.code(400).type('text/plain').send('failure'); }
  });

  // —— 发送验证码 ——

  app.post(
    '/api/v1/auth/send-code',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const phone = readPhone(request.body);
      const now = Date.now();
      const ip = (request.ip || 'unknown').slice(0, 64);

      await db.execute('DELETE FROM sms_codes WHERE expires_at < ?', [now - 86_400_000]);

      const [lastRows] = await db.execute(
        'SELECT created_at FROM sms_codes WHERE phone = ? ORDER BY id DESC LIMIT 1',
        [phone],
      );
      const last = lastRows[0];
      if (last && now - Number(last.created_at) < 60_000) {
        const wait = Math.ceil((60_000 - (now - Number(last.created_at))) / 1000);
        throw fail(429, 'RATE_LIMITED', `发送过于频繁，请 ${wait} 秒后再试`);
      }

      const [dayRows] = await db.execute(
        'SELECT COUNT(*) AS count FROM sms_codes WHERE phone = ? AND created_at > ?',
        [phone, now - 86_400_000],
      );
      if (Number(dayRows[0].count) >= 10) {
        throw fail(429, 'RATE_LIMITED', '今日验证码发送次数已达上限');
      }

      const [ipRows] = await db.execute(
        'SELECT COUNT(*) AS count FROM sms_codes WHERE ip = ? AND created_at > ?',
        [ip, now - 3_600_000],
      );
      if (Number(ipRows[0].count) >= 20) {
        throw fail(429, 'RATE_LIMITED', '当前网络发送次数过多，请稍后再试');
      }

      await captcha.verify(request.body);

      const code = generateSmsCode();
      const [inserted] = await db.execute(
        `INSERT INTO sms_codes (phone, code_hash, expires_at, attempts, consumed_at, created_at, ip)
         VALUES (?, ?, ?, 0, NULL, ?, ?)`,
        [
          phone,
          hmacHex(config.smsCodePepper, `${phone}:${code}:${now}`),
          now + 5 * 60_000,
          now,
          ip,
        ],
      );

      try {
        await sms.sendCode({ phone, code });
      } catch (error) {
        // 发送失败不占用频控额度，允许用户立即重试。
        await db.execute('DELETE FROM sms_codes WHERE id = ?', [inserted.insertId]);
        if (error instanceof SmsError) {
          const status =
            error.code === 'SMS_NOT_CONFIGURED' || error.code === 'SMS_NOT_ALLOWED' ? 503 : 502;
          throw fail(status, error.code, error.message);
        }
        throw fail(502, 'SMS_SEND_FAILED', '短信发送失败，请稍后重试');
      }

      const payload = { ok: true, expiresIn: 300, resendAfter: 60 };
      if (config.sms.debugCodes && sms.exposesCode) {
        payload.debugCode = code;
      }
      return reply.send(payload);
    },
  );

  // —— 验证码登录 ——

  app.post(
    '/api/v1/auth/login-by-code',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const phone = readPhone(request.body);
      const code = readCode(request.body);
      const deviceId = readDeviceId(request.body);
      const now = Date.now();

      const [rows] = await db.execute(
        `SELECT * FROM sms_codes
         WHERE phone = ? AND consumed_at IS NULL AND expires_at > ?
         ORDER BY id DESC LIMIT 1`,
        [phone, now],
      );
      const row = rows[0];

      if (!row) {
        throw fail(400, 'INVALID_CODE', '验证码错误或已过期');
      }

      if (Number(row.attempts) >= 5) {
        await db.execute('UPDATE sms_codes SET consumed_at = ? WHERE id = ?', [now, row.id]);
        throw fail(429, 'TOO_MANY_ATTEMPTS', '验证码尝试次数过多，请重新获取');
      }

      const expected = hmacHex(config.smsCodePepper, `${phone}:${code}:${row.created_at}`);
      if (!secureEqualHex(row.code_hash, expected)) {
        const attempts = Number(row.attempts) + 1;
        await db.execute('UPDATE sms_codes SET attempts = ? WHERE id = ?', [attempts, row.id]);
        if (attempts >= 5) {
          await db.execute('UPDATE sms_codes SET consumed_at = ? WHERE id = ?', [now, row.id]);
          throw fail(429, 'TOO_MANY_ATTEMPTS', '验证码尝试次数过多，请重新获取');
        }
        throw fail(400, 'INVALID_CODE', '验证码错误或已过期');
      }

      await db.execute(
        'UPDATE sms_codes SET consumed_at = ? WHERE phone = ? AND consumed_at IS NULL',
        [now, phone],
      );

      const user = await ensureUser(phone);
      return reply.send(await issueSession(user, deviceId, request));
    },
  );

  // —— 刷新会话（旋转 refresh token）——

  app.post(
    '/api/v1/auth/refresh',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const refreshToken =
        typeof request.body?.refreshToken === 'string' ? request.body.refreshToken.trim() : '';
      const deviceId = readDeviceId(request.body);
      if (!refreshToken) {
        throw fail(400, 'INVALID_REFRESH_TOKEN', '缺少刷新令牌');
      }

      const now = Date.now();
      const [rows] = await db.execute(
        'SELECT * FROM refresh_sessions WHERE token_hash = ?',
        [hashRefreshToken(config.refreshPepper, refreshToken)],
      );
      const session = rows[0];

      if (!session) {
        throw fail(401, 'UNAUTHORIZED', '登录已失效，请重新登录');
      }

      // 已撤销的 token 再次出现，视为泄漏：撤销该用户全部会话。
      if (session.revoked_at) {
        await db.execute(
          'UPDATE refresh_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
          [now, session.user_id],
        );
        throw fail(401, 'SESSION_REVOKED', '登录状态已失效，请重新登录');
      }

      if (Number(session.expires_at) <= now) {
        throw fail(401, 'SESSION_EXPIRED', '登录已过期，请重新登录');
      }

      if (session.device_id !== deviceId) {
        await db.execute('UPDATE refresh_sessions SET revoked_at = ? WHERE id = ?', [
          now,
          session.id,
        ]);
        throw fail(401, 'UNAUTHORIZED', '登录设备校验失败，请重新登录');
      }

      const [userRows] = await db.execute('SELECT * FROM users WHERE id = ?', [session.user_id]);
      const user = userRows[0];
      if (!user || user.status !== 'active') {
        throw fail(401, 'UNAUTHORIZED', '账号不可用');
      }

      let result = null;
      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();

        const [revoked] = await connection.execute(
          'UPDATE refresh_sessions SET revoked_at = ?, last_used_at = ? WHERE id = ? AND revoked_at IS NULL',
          [now, now, session.id],
        );

        if (revoked.affectedRows === 1) {
          const newSessionId = crypto.randomUUID();
          const newRefreshToken = generateRefreshToken();

          await connection.execute(
            `INSERT INTO refresh_sessions
              (id, user_id, token_hash, device_id, created_at, expires_at,
               rotated_from, revoked_at, last_used_at, ip, user_agent)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              newSessionId,
              user.id,
              hashRefreshToken(config.refreshPepper, newRefreshToken),
              deviceId,
              now,
              now + config.refreshTtlSec * 1000,
              session.id,
              null,
              now,
              request.ip || '',
              String(request.headers['user-agent'] || '').slice(0, 255),
            ],
          );

          result = {
            accessToken: signAccessToken({
              secret: config.jwtSecret,
              userId: user.id,
              sessionId: newSessionId,
              ttlSec: config.accessTtlSec,
            }),
            refreshToken: newRefreshToken,
            tokenType: 'Bearer',
            expiresIn: config.accessTtlSec,
            refreshExpiresIn: config.refreshTtlSec,
            user: publicUser(user),
          };
        }

        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }

      if (!result) {
        await db.execute(
          'UPDATE refresh_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
          [now, user.id],
        );
        throw fail(401, 'SESSION_REVOKED', '登录状态已失效，请重新登录');
      }

      return reply.send(result);
    },
  );

  // —— 退出登录 ——

  app.post('/api/v1/auth/logout', async (request, reply) => {
    const now = Date.now();
    const body = request.body || {};
    const refreshToken = typeof body.refreshToken === 'string' ? body.refreshToken.trim() : '';

    let userId = null;
    let sessionId = null;
    try {
      const auth = await authenticate(request);
      userId = auth.user.id;
      sessionId = auth.session.id;
    } catch (_) {
      // access token 过期时仍允许用 refresh token 注销。
    }

    if (refreshToken) {
      const tokenHash = hashRefreshToken(config.refreshPepper, refreshToken);
      if (userId) {
        await db.execute(
          'UPDATE refresh_sessions SET revoked_at = ? WHERE token_hash = ? AND user_id = ? AND revoked_at IS NULL',
          [now, tokenHash, userId],
        );
      } else {
        await db.execute(
          'UPDATE refresh_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL',
          [now, tokenHash],
        );
      }
    } else if (sessionId) {
      await db.execute(
        'UPDATE refresh_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
        [now, sessionId],
      );
    }

    if (body.allDevices === true && userId) {
      await db.execute(
        'UPDATE refresh_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
        [now, userId],
      );
    }

    return reply.code(204).send();
  });

  // —— 当前用户 ——

  app.get('/api/v1/auth/me', async (request, reply) => {
    const { user } = await authenticate(request);
    return reply.send({ user: publicUser(user) });
  });

  return app;
}

module.exports = buildApp;
