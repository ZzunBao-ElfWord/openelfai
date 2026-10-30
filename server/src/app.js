'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs/promises');
const Fastify = require('fastify');
const rateLimit = require('@fastify/rate-limit');

const config = require('./config');
const platformConfig = require('./platform/config');
const { createPool } = require('./db');
const { createAppleIapService, createAppleVerifier } = require('./apple_iap');
const { createPaymentStore, changeBalance } = require('./payment_store');
const { createCommerceService } = require('./commerce');
const { createComplianceService, moderateText } = require('./compliance');
const { createRealnameVerifier } = require('./realname');
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
const {
  ensureDefaultKey,
  getDefaultKeyPlain,
  revealDefaultKey,
  rotateDefaultKey,
} = require('./platform/user_keys');
const { decrypt, keyHint } = require('./platform/secret');
const { createConsoleHandlers } = require('./platform/console');
const { createTopupService } = require('./platform/topup');
const { createUpstream } = require('./platform/upstream');
const { ensureVendorAgents, createWorldAgentService } = require('./world_agents');
const { createArkVideoClient, createWorldVideoService } = require('./world_videos');
const { createWorldUploadService } = require('./world_uploads');
const { createKnowledgeService, buildContextBlock } = require('./knowledge');

const PHONE_RE = /^1[3-9]\d{9}$/;
const DEVICE_RE = /^[A-Za-z0-9_-]{8,80}$/;
const CODE_RE = /^\d{6}$/;

const CORS_ORIGINS = (process.env.PLATFORM_CORS_ORIGINS || 'https://openelfai.com,https://www.openelfai.com')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const CHAT_MAX_TEXT = 2000;
const CHAT_MAX_HISTORY = 20;
const CHAT_MAX_HISTORY_CHARS = 8000;
const CHAT_HISTORY_WINDOW = 12;
const CHAT_TIMEOUT_MS = 60_000;
const FALLBACK_REPLY =
  process.env.PLATFORM_FALLBACK_REPLY || '（这只 AI 还没接通大脑，等我配置好 API Key 再来聊吧～）';
const FILTERED_REPLY =
  process.env.PLATFORM_FILTERED_REPLY || '（这段内容包含不适宜的部分，已经帮我们拦下来了，换个话题再聊吧～）';
const AI_UPSTREAM_ERROR = {
  error: 'ai_upstream_error',
  message: 'AI 服务暂时不可用，请稍后再试',
};

function fixedReply(reason) {
  return { mode: 'fixed', reply: FALLBACK_REPLY, reason };
}

async function readPlatformWallet(db, userId) {
  const [rows] = await db.execute(
    'SELECT balance_micro, frozen_micro, total_topup_micro FROM platform_wallets WHERE user_id = ?',
    [userId],
  );
  const row = rows[0];
  return {
    balance_micro: Number(row?.balance_micro || 0),
    frozen_micro: Number(row?.frozen_micro || 0),
    total_topup_micro: Number(row?.total_topup_micro || 0),
  };
}

function fail(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

// 平台余额充值使用独立回调地址；默认沿用已配置通知地址的域名。
function resolveTopupNotifyUrl() {
  if (process.env.ALIPAY_TOPUP_NOTIFY_URL) return process.env.ALIPAY_TOPUP_NOTIFY_URL;
  try {
    return `${new URL(config.alipay.notifyUrl).origin}/api/v1/platform/alipay/notify`;
  } catch (_) {
    return 'https://api.openelfai.com/api/v1/platform/alipay/notify';
  }
}

// 网页充值支付完成后回到开发者控制台；服务端再追加订单号用于查单。
function resolveTopupReturnUrl() {
  return process.env.ALIPAY_TOPUP_RETURN_URL || 'https://openelfai.com/console/?view=topup';
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

function readChatText(body) {
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text || text.length > CHAT_MAX_TEXT) {
    throw fail(400, 'INVALID_TEXT', '请输入 1-2000 字的内容');
  }
  return text;
}

function readChatHistory(body) {
  const raw = body?.history;
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > CHAT_MAX_HISTORY) {
    throw fail(400, 'INVALID_HISTORY', '对话记录格式不正确');
  }

  let total = 0;
  return raw.map((item) => {
    const role = item?.role;
    const content = typeof item?.content === 'string' ? item.content : null;
    if ((role !== 'user' && role !== 'assistant') || content === null || content.length > CHAT_MAX_TEXT) {
      throw fail(400, 'INVALID_HISTORY', '对话记录格式不正确');
    }
    total += content.length;
    if (total > CHAT_MAX_HISTORY_CHARS) {
      throw fail(400, 'INVALID_HISTORY', '对话记录过长');
    }
    return { role, content };
  });
}

function buildElfSystemPrompt(body) {
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 64) : '';
  const persona = typeof body?.persona === 'string' ? body.persona.trim() : '';
  const lines = [
    `你是 OpenElf 应用里的 AI 精灵${name ? `「${name}」` : ''}，用简体中文和用户自然对话。`,
  ];
  if (persona) lines.push(`角色设定：${persona}`);
  lines.push('保持角色口吻，回答简洁、真诚；不要编造事实，也不要输出与角色无关的内容。');
  return lines.join('\n').slice(0, 800);
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
  // 举报、拉黑与账号注销：独立于交易环境，跨 iOS / 安卓共享。
  const compliance = options.compliance || createComplianceService({ db, store: paymentStore });
  // 实名核验：服务端对接阿里云实人认证，客户端只上传原始要素与证件照。
  const realname = options.realname || createRealnameVerifier(config.realname);
  const identityPolicy = {
    maxFailures: config.realname.maxFailures,
    lockHours: config.realname.lockHours,
  };
  const alipayGateway = options.alipayGateway || createAlipayGateway(config.alipay);
  // 提现出款：走支付宝单笔转账；通道未配置时直接报错，绝不当作成功。
  const payout = alipayGateway ? async (row) => alipayGateway.transfer({
    outTradeNo: row.outTradeNo, account: row.account, amountCents: row.netCents,
    remark: `OpenElf 创作者收益 ${row.id}`,
  }) : null;
  const commerce = createCommerceService({ store: paymentStore, settings: config.appleIap, payout,
    realname, identityPolicy, compliance });
  const appleIap = createAppleIapService({
    db,
    settings: config.appleIap,
    verifyTransaction: appleVerifier,
    paymentStore,
    verifyNotification: options.appleNotificationVerifier,
  });
  const androidCommerce = createCommerceService({ store: paymentStore, settings: config.androidCommerce, payout,
    realname, identityPolicy, compliance });
  const alipay = createAlipayService({ store: paymentStore, settings: config.alipay,
    commerceSettings: config.androidCommerce,
    gateway: alipayGateway });
  // 平台余额充值：与钻石钱包完全独立，只入账 platform_wallets。
  const platformTopup = createTopupService({
    db,
    settings: config.alipay,
    gateway: alipayGateway,
    notifyUrl: resolveTopupNotifyUrl(),
    returnUrl: resolveTopupReturnUrl(),
  });

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

  const worldUpstream = options.worldUpstream || createUpstream({
    baseUrl: platformConfig.litellm.baseUrl,
    masterKey: platformConfig.litellm.masterKey,
    timeoutMs: platformConfig.litellm.timeoutMs,
  });
  const worldAgents = createWorldAgentService({
    store: paymentStore,
    upstream: worldUpstream,
    settings: config.worldAgents,
    logger: app.log,
    // 后台配置过密钥（platform_vendor_credentials 有 active 记录）或环境变量已登记的厂商
    // 才参与产出，其余官方账号先休眠，避免拿占位密钥反复调用上游。
    configuredVendors: async () => {
      const [rows] = await db.query(
        "SELECT vendor FROM platform_vendor_credentials WHERE status = 'active'",
      );
      const vendors = new Set(rows.map((row) => row.vendor));
      for (const vendor of config.worldAgents.vendors) vendors.add(vendor);
      return vendors;
    },
  });

  // 官方账号头像与短视频的静态目录，路由与视频引擎共用同一份路径。
  const worldAssetDir = path.join(__dirname, '..', 'assets', 'world');
  const worldVideoDir = options.worldVideoDir || path.join(worldAssetDir, 'videos');

  const worldVideos = createWorldVideoService({
    store: paymentStore,
    // 视频生成走火山方舟原生异步接口，不经 LiteLLM，因此直接用厂商 Key。
    ark: options.worldVideoClient || createArkVideoClient({
      apiKey: config.worldVideos.apiKey,
      baseUrl: config.worldVideos.arkBaseUrl,
      timeoutMs: 60000,
    }),
    upstream: worldUpstream,
    mediaDir: worldVideoDir,
    settings: config.worldVideos,
    logger: app.log,
    assetBaseUrl: config.worldVideos.assetBaseUrl,
  });

  // 人类上传的 AI 生成视频：与官方短视频共用同一媒体目录与播放路由。
  const worldUploads = createWorldUploadService({
    store: paymentStore,
    mediaDir: worldVideoDir,
    assetBaseUrl: config.worldVideos.assetBaseUrl,
    logger: app.log,
  });

  const consoleHandlers = createConsoleHandlers({ db });
  // 知识库默认关闭，只有 elf_knowledge_config 里显式开启的 AI 才会注入检索片段。
  const knowledge = createKnowledgeService({ db });

  // 跨域：只允许白名单来源携带 CORS 头；预检请求统一 204。
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (typeof origin === 'string' && CORS_ORIGINS.includes(origin)) {
      reply.header('access-control-allow-origin', origin);
      reply.header('vary', 'Origin');
      reply.header('access-control-allow-methods', 'GET,POST,PUT,DELETE,OPTIONS');
      reply.header('access-control-allow-headers', 'authorization,content-type');
      reply.header('access-control-max-age', '86400');
    }
    if (request.method === 'OPTIONS') {
      return reply.code(204).send();
    }
  });

  await app.register(require('./platform'));

  app.register(rateLimit, {
    global: true,
    max: 120,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      error: { code: 'RATE_LIMITED', message: '操作过于频繁，请稍后再试' },
    }),
  });

  // 视频上传走原始字节流，避免把大文件包成 JSON/Base64。
  for (const type of ['video/mp4', 'application/octet-stream']) {
    app.addContentTypeParser(
      type,
      { parseAs: 'buffer', bodyLimit: 20 * 1024 * 1024 },
      (request, body, done) => done(null, body),
    );
  }

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
        // 充值遇到待支付订单时，需要把 order_id 透出给客户端继续拉起支付。
        ...(error.orderId ? { order_id: error.orderId } : {}),
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

  // 自动运营由服务端定时驱动：用户离线也会按时产出，算力不足停工并推送提醒。
  // unref 让进程在测试或短生命周期场景下不被定时器挂住。
  let autoTimer = null;
  let worldTimer = null;
  let videoTimer = null;
  if (options.autoRunner !== false) {
    const interval = Math.max(Number(options.autoIntervalMs) || 60000, 5000);
    autoTimer = setInterval(() => {
      for (const service of [commerce, androidCommerce]) {
        // 服务未开放时 autoCycle 自身是空操作，无需在此判断。
        service.autoCycle().catch((error) => app.log.error({ err: error }, 'auto cycle failed'));
      }
    }, interval);
    autoTimer.unref?.();

    // 厂商官方 AI：先幂等建号，再按当天进度补齐互动。
    // 测试环境默认不启动，避免测试库被官方账号种子和上游调用污染。
    if (config.worldAgents.enabled && config.nodeEnv !== 'test') {
      const worldInterval = Math.max(Number(options.worldIntervalMs) || 10 * 60000, 15000);
      ensureVendorAgents(paymentStore, config.worldAgents)
        .then(() => {
          worldAgents.cycle().catch((error) => app.log.error({ err: error }, 'world agent cycle failed'));
          worldTimer = setInterval(() => {
            worldAgents.cycle().catch((error) => app.log.error({ err: error }, 'world agent cycle failed'));
          }, worldInterval);
          worldTimer.unref?.();
        })
        .catch((error) => app.log.error({ err: error }, 'world agent seed failed'));
    }

    // 豆包官方账号：每天 3 条 12 秒短视频，按北京时间档位放开。
    // 生成是异步任务，轮询间隔取 60 秒，未到档位时 cycle 自身是空操作。
    if (config.worldVideos.enabled && config.nodeEnv !== 'test') {
      const videoInterval = Math.max(Number(options.worldVideoIntervalMs) || 60000, 15000);
      const runVideo = () => worldVideos.cycle()
        .then((result) => {
          if (result?.published) app.log.info({ result }, 'world video published');
        })
        .catch((error) => app.log.error({ err: error }, 'world video cycle failed'));
      runVideo();
      videoTimer = setInterval(runVideo, videoInterval);
      videoTimer.unref?.();
    }

    app.addHook('onClose', async () => {
      if (autoTimer) clearInterval(autoTimer);
      if (worldTimer) clearInterval(worldTimer);
      if (videoTimer) clearInterval(videoTimer);
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

  /// 审核账号预置钻石：保证审核员可以完整体验打赏、购买与AI对话。
  /// 只对 REVIEW_LOGIN_ACCOUNTS 白名单内的手机号生效，且按自然日幂等补足。
  async function seedReviewAccount(userId) {
    const target = Math.max(0, Math.min(100000, Number(process.env.REVIEW_SEED_DIAMONDS) || 1000));
    if (target <= 0) return;
    const day = new Date().toISOString().slice(0, 10);
    await paymentStore.transaction('Production', async (tx) => {
      const wallet = await tx.lockWallet(userId);
      if (wallet.diamonds >= target) return;
      await changeBalance(tx, userId, wallet, {
        eventId: `review-seed:${userId}:${day}`,
        type: 'review_seed',
        amount: target - wallet.diamonds,
        note: `审核账号预置 ${target} 钻石`,
      });
    });
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

  // —— 合规：举报、拉黑、账号注销 ——

  app.post('/api/v1/reports', {
    bodyLimit: 8 * 1024,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request) => {
    const { user } = await authenticate(request);
    return compliance.submitReport(user, request.body);
  });

  app.get('/api/v1/reports/mine', async (request) => {
    const { user } = await authenticate(request);
    return compliance.listMine(user);
  });

  app.get('/api/v1/blocks', async (request) => {
    const { user } = await authenticate(request);
    return compliance.listBlocks(user);
  });

  app.post('/api/v1/blocks', { bodyLimit: 8 * 1024 }, async (request) => {
    const { user } = await authenticate(request);
    return compliance.block(user, request.body);
  });

  app.post('/api/v1/blocks/unblock', { bodyLimit: 8 * 1024 }, async (request) => {
    const { user } = await authenticate(request);
    return compliance.unblock(user, request.body);
  });

  // 注销账号：二次确认后才执行，注销后所有会话立即失效。
  app.delete('/api/v1/account', { bodyLimit: 8 * 1024 }, async (request) => {
    const { user } = await authenticate(request);
    if (request.body?.confirm !== true && request.body?.confirm !== 'DELETE') {
      throw fail(400, 'CONFIRM_REQUIRED', '请确认注销账号');
    }
    return compliance.deleteAccount(user);
  });

  // 内部审核队列：仅允许带运维令牌访问，nginx 已对 /internal/ 直接返回 404。
  const reviewToken = process.env.COMPLIANCE_REVIEW_TOKEN || '';
  function requireReviewToken(request) {
    if (!reviewToken) throw fail(404, 'NOT_FOUND', '接口不存在');
    const given = String(request.headers['x-review-token'] || '');
    const expected = Buffer.from(reviewToken);
    const actual = Buffer.from(given);
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
      throw fail(401, 'UNAUTHORIZED', '无权访问');
    }
  }

  app.get('/internal/reports', async (request) => {
    requireReviewToken(request);
    return compliance.listReports({
      state: request.query?.state,
      targetType: request.query?.targetType || request.query?.target_type,
      environment: request.query?.environment,
      page: request.query?.page,
      size: request.query?.size,
    });
  });

  app.post('/internal/reports/:id/resolve', { bodyLimit: 8 * 1024 }, async (request) => {
    requireReviewToken(request);
    return compliance.resolveReport(request.params.id, {
      action: request.body?.action,
      note: request.body?.note,
      reviewer: String(request.headers['x-reviewer'] || 'ops').slice(0, 64),
    });
  });

  app.get('/internal/media', async (request) => {
    requireReviewToken(request);
    return compliance.listPendingMedia({
      environment: request.query?.environment,
      page: request.query?.page,
      size: request.query?.size,
    });
  });

  app.post('/internal/media/:id/review', { bodyLimit: 8 * 1024 }, async (request) => {
    requireReviewToken(request);
    return compliance.reviewMedia(request.params.id, {
      environment: request.body?.environment,
      action: request.body?.action,
      note: request.body?.note,
      reviewer: String(request.headers['x-reviewer'] || 'ops').slice(0, 64),
    });
  });

  // 官方账号头像：静态资源体积小，直接按文件名白名单读取，避免额外挂静态目录。
  // 官方账号生成的短视频与封面：文件名由服务端生成，只允许访问这一层目录。
  app.get('/api/v1/world-assets/videos/:file', async (request, reply) => {
    const file = String(request.params?.file || '');
    if (!/^[a-z0-9_-]+\.(mp4|jpg|jpeg|webp)$/i.test(file)) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '资源不存在' } });
    }
    const isVideo = file.toLowerCase().endsWith('.mp4');
    try {
      const target = path.join(worldVideoDir, file);
      const stat = await fs.stat(target);
      const buf = await fs.readFile(target);
      reply.header('cache-control', 'public, max-age=86400');
      if (!isVideo) {
        reply.type('image/jpeg');
        reply.header('content-length', String(stat.size));
        return reply.send(buf);
      }
      reply.header('accept-ranges', 'bytes');
      reply.type('video/mp4');
      // 播放器（ExoPlayer / AVPlayer）会用 Range 请求做拖动与首帧加载，必须支持 206。
      const range = String(request.headers.range || '');
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match && (match[1] || match[2])) {
        const size = buf.length;
        let start = match[1] ? Number(match[1]) : size - Number(match[2]);
        let end = match[1] && match[2] ? Number(match[2]) : size - 1;
        start = Math.max(0, Math.min(start, size - 1));
        end = Math.max(start, Math.min(end, size - 1));
        const slice = buf.subarray(start, end + 1);
        reply.code(206);
        reply.header('content-range', `bytes ${start}-${end}/${size}`);
        reply.header('content-length', String(slice.length));
        return reply.send(slice);
      }
      reply.header('content-length', String(stat.size));
      return reply.send(buf);
    } catch {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '资源不存在' } });
    }
  });

  // 人类上传 AI 生成视频：body 为 MP4 原始字节，元信息走 query。
  // 只接收视频且必须显式声明由 AI 生成，落地后直接进入世界/视频信息流。
  app.post('/api/v1/world/video-uploads', {
    bodyLimit: 20 * 1024 * 1024,
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request) => {
    const { user } = await authenticate(request);
    return worldUploads.publishUserVideo({
      user,
      environment: request.query?.environment,
      elfId: request.query?.elfId,
      caption: request.query?.caption,
      aiGenerated: request.query?.aiGenerated,
      buffer: request.body,
    });
  });

  app.get('/api/v1/world-assets/:file', async (request, reply) => {
    const file = String(request.params?.file || '');
    if (!/^[a-z0-9_-]+\.(png|jpg|jpeg|webp)$/i.test(file)) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '资源不存在' } });
    }
    try {
      const buf = await fs.readFile(path.join(worldAssetDir, file));
      reply.header('cache-control', 'public, max-age=86400');
      reply.type(file.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg');
      return reply.send(buf);
    } catch {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '资源不存在' } });
    }
  });

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

  // 对话记录：与支付环境无关，按「用户 + AI」存一份，换设备可恢复。
  app.get('/api/v1/commerce/chat', async (request) => {
    const { user } = await authenticate(request);
    return commerce.listChat(user, request.query);
  });
  app.get('/api/v1/android/commerce/chat', async (request) => {
    const { user } = await authenticate(request);
    return androidCommerce.listChat(user, request.query);
  });

  // 创作者收益：提现申请与记录。审核接口在下方内部路由里，仅认配置令牌。
  const earningsRoutes = [
    ['/api/v1/earnings', commerce],
    ['/api/v1/android/earnings', androidCommerce],
  ];
  for (const [base, service] of earningsRoutes) {
    app.post(base + '/withdraw',
      { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
      async (request) => {
        const { user } = await authenticate(request);
        return service.requestWithdrawal(user, request.body);
      });
    app.get(base + '/withdrawals', async (request) => {
      const { user } = await authenticate(request);
      return service.listWithdrawals(user, request.query.environment);
    });
  }

  // 内部审核队列：只给运维使用，未配置令牌时整体关闭。
  function requireReviewToken(request) {
    const token = config.withdrawReviewToken;
    if (!token) throw fail(404, 'NOT_FOUND', '接口不存在');
    const given = String(request.headers['x-review-token'] || '');
    if (given.length !== token.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(token))) {
      throw fail(401, 'UNAUTHORIZED', '审核令牌无效');
    }
  }
  app.get('/internal/withdrawals',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      requireReviewToken(request);
      const status = typeof request.query.status === 'string' ? request.query.status : 'pending_review';
      const environment = request.query.environment === 'sandbox' ? 'Sandbox' : 'Production';
      const service = environment === 'Sandbox' ? commerce : androidCommerce;
      reply.header('cache-control', 'no-store');
      return service.listAllWithdrawals(environment, status);
    });
  app.post('/internal/withdrawals/:id/review',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => {
      requireReviewToken(request);
      const environment = request.body?.environment === 'sandbox' ? 'Sandbox' : 'Production';
      const service = environment === 'Sandbox' ? commerce : androidCommerce;
      return service.reviewWithdrawal({ environment, withdrawalId: request.params.id,
        action: request.body?.action, reason: request.body?.reason });
    });

  // 信息流分页：排序、分页、去重都在服务端完成，客户端只按页追加。
  app.get('/api/v1/commerce/feed',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request) => {
      const { user } = await authenticate(request);
      return commerce.listFeed(user, request.query);
    });

  app.post('/api/v1/commerce/actions',
    { config: { rateLimit: { max: 240, timeWindow: '1 minute' } } },
    async (request) => {
      const { user } = await authenticate(request);
      return commerce.action(user, request.body);
    });

  // 能力许愿：收集用户期待 AI 具备的能力，供产品排期参考。
  for (const route of ['/api/v1/wishes', '/api/v1/android/wishes']) {
    app.post(route,
      { bodyLimit: 4 * 1024, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
      async (request) => {
        const { user } = await authenticate(request);
        if (route.startsWith('/api/v1/android')) requireAndroidCommerce();
        const text = typeof request.body?.text === 'string' ? request.body.text.trim() : '';
        if (!text) throw fail(400, 'INVALID_WISH', '请先写下你期待的能力');
        if ([...text].length > 200) throw fail(400, 'INVALID_WISH', '许愿内容请控制在 200 字以内');
        const environment = request.body?.environment?.toLowerCase() === 'sandbox' ? 'Sandbox' : 'Production';
        const id = crypto.randomUUID();
        await paymentStore.transaction(environment, async (tx) => {
          await tx.put('wish', id,
            { text, createdAt: new Date().toISOString() },
            { owner: user.id, state: 'new' });
        });
        return { ok: true, id };
      });
  }

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
  app.post('/api/v1/android/commerce/actions', { config: { rateLimit: { max: 240, timeWindow: '1 minute' } } }, async (request) => {
    const { user } = await authenticate(request); requireAndroidCommerce();
    if (request.body?.environment?.toLowerCase() !== alipay.environment.toLowerCase()) throw fail(400, 'INVALID_ENVIRONMENT', '安卓钱包环境不匹配');
    return androidCommerce.action(user, { ...request.body, environment: alipay.environment });
  });
  app.get('/api/v1/android/commerce/feed', async (request) => {
    const { user } = await authenticate(request); requireAndroidCommerce();
    return androidCommerce.listFeed(user, { ...request.query, environment: alipay.environment });
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

  // 实名核验：服务端为准，客户端上传姓名/证件号与正反面证件照（base64）。
  // 图片 base64 会超过默认 16KB，单独放宽到 8MB，其余接口保持原限制。
  app.post('/api/v1/identity/verify',
    { bodyLimit: 8 * 1024 * 1024, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request) => {
      const { user } = await authenticate(request);
      if (request.body?.platform === 'android') requireAndroidCommerce();
      const service = request.body?.platform === 'android' ? androidCommerce : commerce;
      return service.verifyIdentity(user, request.body);
    });

  require('./web_captcha').registerWebCaptcha(app, { settings: config.captcha, verifier: captcha });

  // —— 发送验证码 ——

  app.post(
    '/api/v1/auth/send-code',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const phone = readPhone(request.body);
      const now = Date.now();
      const ip = (request.ip || 'unknown').slice(0, 64);

      // 审核账号不发真实短信、也不要求图形验证码，直接放行到输码页。
      if (config.reviewAccounts.has(phone)) {
        return reply.send({ ok: true, expiresIn: 300, resendAfter: 60 });
      }

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

      // 应用商店与支付渠道审核专用账号：手机号在 REVIEW_LOGIN_ACCOUNTS 白名单内，
      // 输入约定好的固定验证码即可登录，不依赖短信下发。未配置则此分支不生效。
      const reviewCode = config.reviewAccounts.get(phone);
      if (reviewCode && code === reviewCode) {
        const user = await ensureUser(phone);
        await seedReviewAccount(user.id);
        return reply.send(await issueSession(user, deviceId, request));
      }

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

  // —— 平台钱包 ——

  app.get('/api/v1/platform/wallet', async (request) => {
    const { user } = await authenticate(request);
    return readPlatformWallet(db, user.id);
  });

  // —— 平台余额充值（支付宝 App 支付） ——

  app.get('/api/v1/platform/topup/products', async (request) => {
    await authenticate(request);
    return platformTopup.products();
  });

  app.post(
    '/api/v1/platform/topup/orders',
    { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { user } = await authenticate(request);
      try {
        return await platformTopup.create(user, request.body);
      } catch (error) {
        if (error.code === 'TOPUP_PENDING_ORDER') {
          return reply.code(409).send({
            error: { code: error.code, message: error.message, orderId: error.orderId },
          });
        }
        throw error;
      }
    },
  );

  app.post('/api/v1/platform/topup/orders/:id/pay', async (request) => {
    const { user } = await authenticate(request);
    return platformTopup.resume(user, request.params.id, request.body);
  });

  app.get('/api/v1/platform/topup/orders/:id', async (request) => {
    const { user } = await authenticate(request);
    return platformTopup.refresh(user.id, request.params.id);
  });

  app.post(
    '/api/v1/platform/alipay/notify',
    { bodyLimit: 65536, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request, reply) => {
      try {
        await platformTopup.notify(request.body);
        return reply.type('text/plain').send('success');
      } catch (error) {
        // 日志只记录订单号，禁止输出验签数据与交易号。
        request.log.error({ orderId: request.body?.out_trade_no, code: error.code }, 'platform topup notify failed');
        return reply.code(400).type('text/plain').send('failure');
      }
    },
  );

  // —— 平台默认密钥 ——

  app.get('/api/v1/platform/my-key', async (request) => {
    const { user } = await authenticate(request);
    const { row, created, plain } = await ensureDefaultKey(db, user.id);

    let apiKeyPlain = created ? plain : null;
    if (!apiKeyPlain && row.key_cipher) {
      try {
        apiKeyPlain = decrypt(row.key_cipher);
      } catch (_) {
        apiKeyPlain = null;
      }
    }

    const result = {
      api_key_masked: keyHint(apiKeyPlain),
      key_prefix: row.key_prefix,
      created_at: row.created_at,
      revoked_at: row.revoked_at || null,
      wallet: await readPlatformWallet(db, user.id),
    };
    if (row.revoked_at) result.revoked = true;
    return result;
  });

  app.post('/api/v1/platform/my-key/reveal', async (request, reply) => {
    const { user } = await authenticate(request);
    try {
      const apiKey = await revealDefaultKey(db, user.id);
      return { api_key: apiKey };
    } catch (error) {
      if (error.statusCode === 409) {
        return reply.code(409).send({ error: error.code, message: error.message });
      }
      throw error;
    }
  });

  app.post('/api/v1/platform/my-key/reset', async (request) => {
    const { user } = await authenticate(request);
    const result = await rotateDefaultKey(db, user.id);
    return {
      api_key: result.plain,
      key_prefix: result.prefix,
      created_at: result.createdAt,
    };
  });

  // 运营配置：App 文案 / 开关 / 法律政策文档公开快照（无鉴权，只读）
  require('./app_content').registerAppContentRoutes(app, { db });

  // —— 开发者控制台 ——

  // 开发者生态：入驻、技能草稿、沙箱调试（/api/v1/developer/*）。
  require('./developer/routes').registerDeveloperRoutes(app, { db, authenticate });

  // AI 形象内核：配件目录、角色卡草稿、预览与生成（/api/v1/character/*）。
  require('./character/routes').registerCharacterRoutes(app, { db, authenticate });

  // 形象运营精修：配件覆盖与批量生成（/internal/ops/character/*，仅运维令牌可访问）。
  require('./character/ops_routes').registerOpsRoutes(app, { db });

  // MCP 连接器：WorkBuddy 等外部客户端用用户自己的 API Key 调用形象工具（/mcp）。
  require('./mcp/server').registerMcpRoutes(app, { db });

  app.get('/api/v1/platform/console/overview', async (request) => {
    const { user } = await authenticate(request);
    return consoleHandlers.overview(request, user);
  });

  app.get('/api/v1/platform/console/usage', async (request) => {
    const { user } = await authenticate(request);
    return consoleHandlers.usage(request, user);
  });

  app.get('/api/v1/platform/console/ledger', async (request) => {
    const { user } = await authenticate(request);
    return consoleHandlers.ledger(request, user);
  });

  // —— Elf 对话：使用用户名下的默认密钥调用本机开放平台网关 ——

  app.post('/api/v1/elf-chat', { bodyLimit: 64 * 1024 }, async (request, reply) => {
    const { user } = await authenticate(request);
    const text = readChatText(request.body);
    const history = readChatHistory(request.body);
    const elfId = typeof request.body?.elfId === 'string' ? request.body.elfId : '';
    // 用户输入在进入上游前先做一次强制审核，避免违规内容触达模型。
    const inputHit = moderateText(text);
    if (inputHit) throw fail(400, 'CONTENT_BLOCKED', '包含违规词「' + inputHit + '」');

    // 无论真实回复还是固定话术，都把这一轮问答落库，并把最新会话回给客户端覆盖本地。
    const done = async (payload) => {
      const saved = await commerce.recordChat(user, {
        elfId, text, reply: payload.reply, fixedReason: payload.reason,
      });
      return saved ? { ...payload, messages: saved.messages } : payload;
    };

    const apiKey = await getDefaultKeyPlain(db, user.id);
    if (!apiKey) return done(fixedReply('no_api_key'));

    const wallet = await readPlatformWallet(db, user.id);
    if (wallet.balance_micro - wallet.frozen_micro <= 0) {
      return done(fixedReply('insufficient_balance'));
    }

    const messages = [{ role: 'system', content: buildElfSystemPrompt(request.body) }];
    // 只有该 AI 在 elf_knowledge_config 中显式开启知识库时才做检索注入；
    // 其余 AI 走原有链路，消息结构完全不变。
    let knowledgeSources = [];
    if (elfId) {
      try {
        if (await knowledge.isEnabled(elfId)) {
          const hits = await knowledge.retrieve(text);
          const contextBlock = buildContextBlock(hits);
          if (contextBlock) messages.push({ role: 'system', content: contextBlock });
          knowledgeSources = hits.map((hit) => ({ title: hit.title, url: hit.sourceUrl || '' }));
        }
      } catch (error) {
        app.log?.warn?.({ err: error, elfId }, 'elf knowledge retrieval failed');
      }
    }
    messages.push(...history.slice(-CHAT_HISTORY_WINDOW), { role: 'user', content: text });
    const baseUrl = process.env.PLATFORM_SELF_URL || `http://127.0.0.1:${config.port}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
    try {
      let response;
      try {
        response = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: process.env.PLATFORM_CHAT_MODEL || 'deepseek/deepseek-chat',
            messages,
            max_tokens: 800,
          }),
          signal: controller.signal,
        });
      } catch (_) {
        return reply.code(502).send(AI_UPSTREAM_ERROR);
      }

      if (response.status === 402) return done(fixedReply('insufficient_balance'));
      if (response.status === 401) return done(fixedReply('invalid_api_key'));
      if (response.status === 404) return done(fixedReply('model_unavailable'));
      if (response.status !== 200) return reply.code(502).send(AI_UPSTREAM_ERROR);

      const payload = await response.json().catch(() => null);
      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content) {
        return reply.code(502).send(AI_UPSTREAM_ERROR);
      }
      // 模型输出同样过审：命中违规内容时不下发原文，替换为统一提示。
      if (moderateText(content)) {
        return done({ mode: 'fixed', reply: FILTERED_REPLY, reason: 'content_filtered' });
      }

      const after = await readPlatformWallet(db, user.id);
      const result = {
        mode: 'ai',
        reply: content,
        usage: payload?.usage || null,
        balance_micro: after.balance_micro,
      };
      if (knowledgeSources.length) result.knowledge_sources = knowledgeSources;
      return done(result);
    } finally {
      clearTimeout(timer);
    }
  });

  return app;
}

module.exports = buildApp;
