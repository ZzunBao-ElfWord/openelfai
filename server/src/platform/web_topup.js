'use strict';
const { createQrPageGateway } = require('./web_qr_gateway');
const { createTopupService } = require('./web_topup_service');
const { webSettings, legacySettings, NEW_APP_ID, NOTIFY_URL, RETURN_URL } = require('./web_apps');
function failure(code, message, statusCode = 400) { return Object.assign(Error(message), { code, statusCode }); }
function registerWebTopup(app, { db, authenticate, settings = webSettings(), gateway, service,
    legacy = { settings: legacySettings() }, store, realname, identityPolicy, payout, payoutQuery } = {}) {
  function context(s, gateway, service) {
    const g = gateway === undefined ? createQrPageGateway(s) : gateway;
    return { settings: s, gateway: g, service: service || createTopupService({ db, settings: s, gateway: g, notifyUrl: NOTIFY_URL, returnUrl: RETURN_URL }) };
  }
  const active = context(settings, gateway, service);
  const old = legacy?.settings?.enabled ? context(legacy.settings, legacy.gateway, legacy.service) : null;
  const contexts = [active, old].filter(Boolean);
  async function owned(user, id) {
    if (!/^OT[a-f0-9]{32}$/.test(id || '')) throw failure('INVALID_ORDER', '订单编号无效');
    const [rows] = await db.execute('SELECT user_id, app_id, seller_id FROM platform_topup_orders WHERE id = ? LIMIT 1', [id]);
    const row = rows[0];
    const selected = row && row.user_id === user.id && contexts.find(c => c.settings.appId === row.app_id && c.settings.sellerId === row.seller_id);
    if (!selected) throw failure('UNKNOWN_ORDER', '当前账号无此网页支付订单', 404);
    return selected;
  }
  app.get('/api/v1/platform/web-topup/products', async request => { await authenticate(request); return active.service.products(); });
  app.get('/api/v1/platform/web-topup/legacy-orders', async (request, reply) => {
    const { user } = await authenticate(request); reply.header('cache-control', 'no-store');
    if (!old) return { orders: [] };
    const [rows] = await db.execute("SELECT id, amount_fen, status, expires_at FROM platform_topup_orders WHERE user_id = ? AND app_id = ? AND seller_id = ? AND status IN ('pending','review') ORDER BY created_at DESC LIMIT 20", [user.id, old.settings.appId, old.settings.sellerId]);
    return { orders: rows.map(r => ({ id: r.id, amountFen: Number(r.amount_fen), status: r.status })) };
  });
  app.post('/api/v1/platform/web-topup/orders', { bodyLimit: 4096, config: { rateLimit: { max: 8, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { user } = await authenticate(request);
    try { return await active.service.create(user, { requestId: request.body?.requestId, tierId: request.body?.tierId, amountYuan: request.body?.amountYuan, channel: 'web' }); }
    catch (error) {
      if (error.code !== 'TOPUP_PENDING_ORDER') throw error;
      const selected = await owned(user, error.orderId);
      if (selected !== active) throw failure('LEGACY_ORDER_PENDING', '旧应用订单只能核对；请刷新网页后创建新应用订单', 409);
      return reply.code(409).send({ error: { code: error.code, message: error.message, orderId: error.orderId } });
    }
  });
  app.post('/api/v1/platform/web-topup/orders/:id/pay', async request => {
    const { user } = await authenticate(request); const selected = await owned(user, request.params.id);
    if (selected !== active) throw failure('LEGACY_ORDER_READ_ONLY', '旧应用订单仅保留查单与回调，不再发起新付款', 409);
    return selected.service.resume(user, request.params.id, { channel: 'web' });
  });
  app.get('/api/v1/platform/web-topup/orders/:id', async request => {
    const { user } = await authenticate(request); const selected = await owned(user, request.params.id);
    return selected.service.refresh(user.id, request.params.id);
  });
  app.post('/api/v1/platform/web-alipay/notify', { bodyLimit: 65536, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (request, reply) => {
    try {
      const selected = contexts.find(c => c.settings.enabled && c.settings.appId === request.body?.app_id && c.settings.sellerId === request.body?.seller_id);
      if (!selected) throw Error('Unknown merchant');
      await selected.service.notify(request.body);
      return reply.type('text/plain').send('success');
    } catch (_) { return reply.code(400).type('text/plain').send('failure'); }
  });
  require('./web_diamonds').registerWebDiamonds(app, { db, authenticate, settings, gateway: active.gateway,
    store, realname, identityPolicy, payout, payoutQuery,
    legacy: old ? { settings: old.settings, gateway: old.gateway } : null });
}
module.exports = { registerWebTopup, webSettings, WEB_APP_ID: NEW_APP_ID, NOTIFY_URL, RETURN_URL };
