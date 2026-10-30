'use strict';
const { createPaymentStore, fail } = require('../payment_store');
const { createAlipayService } = require('../alipay');
const { createCommerceService } = require('../commerce');

const NOTIFY = 'https://web.openelfai.com/api/v1/web/alipay/notify';
const RETURN = 'https://web.openelfai.com/?diamond_return=1';

// Separate web recharge orders from Android orders, but retain the SAME diamond
// wallet/ledger and shared refund-review holds. Never access platform_wallets.
function webOrderStore(store, prefix = 'web2_') {
  const map = kind => ['alipay_order', 'alipay_request'].includes(kind)
    ? prefix + kind : kind;
  return {
    transaction(environment, work) {
      return store.transaction(environment, tx => {
        const scoped = Object.create(tx);
        scoped.get = (kind, ...args) => tx.get(map(kind), ...args);
        scoped.put = (kind, ...args) => tx.put(map(kind), ...args);
        scoped.list = (kind, ...args) => tx.list(map(kind), ...args);
        return work(scoped);
      });
    },
  };
}

function createWebDiamondServices({ db, store = createPaymentStore(db), settings, gateway, now, prefix = 'web2_',
    realname, identityPolicy, payout, payoutQuery, compliance }) {
  const commerceSettings = { enabled: true, sandboxOnly: false, allowSandbox: false };
  const webGateway = gateway && typeof gateway.pagePay === 'function' ? {
    signOrder(order) {
      const url = new URL(RETURN);
      url.searchParams.set('order', order.id);
      return gateway.pagePay({ ...order, subject: `OpenElf ${order.diamonds}钻石充值` },
        { notifyUrl: NOTIFY, returnUrl: url.toString() });
    },
    verifyNotify: data => gateway.verifyNotify(data),
    query: id => gateway.query(id),
  } : null;
  const payment = createAlipayService({ store: webOrderStore(store, prefix), settings,
    commerceSettings, gateway: webGateway, now });
  const commerce = createCommerceService({ store, settings: commerceSettings,
    realname, identityPolicy, payout, payoutQuery, compliance });
  return { payment, commerce };
}

function registerWebDiamonds(app, { db, authenticate, settings, gateway, store = createPaymentStore(db), legacy,
    realname, identityPolicy, payout, payoutQuery, compliance }) {
  const { payment, commerce } = createWebDiamondServices({ db, store, settings, gateway,
    realname, identityPolicy, payout, payoutQuery, compliance });
  const old = legacy?.settings?.enabled ? createWebDiamondServices({ store, ...legacy, prefix: 'web_' }) : null;
  async function owned(user, id) {
    if (!/^OE[a-f0-9]{32}$/.test(id || '')) throw fail(400, 'INVALID_ORDER', '订单编号无效');
    return store.transaction('Production', async tx => {
      const current = await tx.get('web2_alipay_order', id);
      if (current?.userId === user.id && current.appId === settings.appId && current.sellerId === settings.sellerId) return { service: payment, legacy: false };
      const previous = old && await tx.get('web_alipay_order', id);
      if (previous?.userId === user.id && previous.appId === legacy.settings.appId && previous.sellerId === legacy.settings.sellerId) return { service: old.payment, legacy: true };
      throw fail(404, 'UNKNOWN_ORDER', '当前账号无此网页钻石订单');
    });
  }
  const production = request => {
    const hint = request.body?.environment || request.query?.environment;
    if (hint && String(hint).toLowerCase() !== 'production') {
      throw fail(400, 'INVALID_ENVIRONMENT', '网页钻石钱包仅支持正式账本');
    }
  };
  const publicPayment = result => {
    const { orderString, ...rest } = result;
    return { ...rest, payUrl: orderString || null };
  };
  app.get('/api/v1/web/wallet', async request => {
    const { user } = await authenticate(request); production(request);
    return commerce.snapshot(user, 'Production');
  });
  app.post('/api/v1/web/commerce/actions', {
    bodyLimit: 65536, config: { rateLimit: { max: 240, timeWindow: '1 minute' } }
  }, async request => {
    const { user } = await authenticate(request); production(request);
    return commerce.action(user, { ...request.body, environment: 'Production' });
  });
  app.get('/api/v1/web/commerce/feed', async request => {
    const { user } = await authenticate(request); production(request);
    return commerce.listFeed(user, { ...request.query, environment: 'Production' });
  });
  app.get('/api/v1/web/commerce/chat', async request => {
    const { user } = await authenticate(request);
    return commerce.listChat(user, request.query);
  });
  app.get('/api/v1/web/alipay/products', async request => {
    await authenticate(request); return payment.products();
  });
  app.get('/api/v1/web/alipay/pending', async request => {
    const { user } = await authenticate(request); return payment.pending(user);
  });
  app.get('/api/v1/web/alipay/legacy-orders', async (request, reply) => {
    const { user } = await authenticate(request); reply.header('cache-control', 'no-store');
    const result = old ? await old.payment.pending(user) : { orders: [] };
    return { orders: result.orders.map(r => ({ id: r.id, amountFen: r.priceFen, status: r.status })) };
  });
  app.post('/api/v1/web/alipay/orders', {
    bodyLimit: 4096, config: { rateLimit: { max: 8, timeWindow: '1 minute' } }
  }, async request => {
    const { user } = await authenticate(request);
    return publicPayment(await payment.create(user, {
      tierId: request.body?.tierId, requestId: request.body?.requestId
    }));
  });
  app.get('/api/v1/web/alipay/orders/:id', async request => {
    const { user } = await authenticate(request);
    const selected = await owned(user, request.params.id);
    const result = await selected.service.refresh(user.id, request.params.id);
    return { ...result, ...await commerce.snapshot(user, 'Production') };
  });
  app.post('/api/v1/web/alipay/orders/:id/pay', async request => {
    const { user } = await authenticate(request);
    const selected = await owned(user, request.params.id);
    if (selected.legacy) throw fail(409, 'LEGACY_ORDER_READ_ONLY', '旧应用钻石订单只保留查单与回调，不再发起付款');
    return publicPayment(await selected.service.resume(user, request.params.id));
  });
  app.post('/api/v1/web/alipay/notify', {
    bodyLimit: 65536, config: { rateLimit: { max: 120, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    try {
      const current = request.body?.app_id === settings.appId && request.body?.seller_id === settings.sellerId;
      const previous = old && request.body?.app_id === legacy.settings.appId && request.body?.seller_id === legacy.settings.sellerId;
      if (!current && !previous) throw Error('Wrong merchant');
      await (current ? payment : old.payment).notify(request.body);
      return reply.type('text/plain').send('success');
    } catch (_) { return reply.code(400).type('text/plain').send('failure'); }
  });
}
module.exports = { registerWebDiamonds, createWebDiamondServices, webOrderStore, NOTIFY, RETURN };
