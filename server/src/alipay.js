'use strict';
const crypto = require('node:crypto');
const { changeBalance, fail } = require('./payment_store');
const TIERS = Object.freeze([
  { id: 'diamonds10', priceFen: 100, diamonds: 10 }, { id: 'diamonds60', priceFen: 600, diamonds: 60 },
  { id: 'diamonds300', priceFen: 3000, diamonds: 300 }, { id: 'diamonds680', priceFen: 6800, diamonds: 680 },
  { id: 'diamonds1280', priceFen: 12800, diamonds: 1280 }, { id: 'diamonds2980', priceFen: 29800, diamonds: 2980 },
]);
function moneyFen(raw) {
  if (typeof raw !== 'string' || !/^\d{1,8}(\.\d{1,2})?$/.test(raw)) throw fail(400, 'INVALID_AMOUNT', '支付金额无效');
  const [yuan, decimal = ''] = raw.split('.');
  return Number(yuan) * 100 + Number(decimal.padEnd(2, '0'));
}
function createAlipayService({ store, settings, gateway, commerceSettings, now = Date.now }) {
  const environment = settings.sandbox ? 'Sandbox' : 'Production';
  const open = () => settings.enabled && commerceSettings.enabled && gateway != null;
  const requireOpen = () => { if (!open()) throw fail(503, 'ALIPAY_DISABLED', '支付宝充值尚未配置完成'); };
  const publicOrder = order => ({ id: order.id, tierId: order.tierId, status: order.status, diamonds: order.diamonds,
    priceFen: order.priceFen, expiresAt: order.expiresAt, mode: environment.toLowerCase() });
  async function ownOrder(userId, id) {
    if (!/^OE[a-f0-9]{32}$/.test(id || '')) throw fail(400, 'INVALID_ORDER', '订单编号无效');
    const order = await store.transaction(environment, tx => tx.get('alipay_order', id));
    if (!order || order.userId !== userId) throw fail(404, 'UNKNOWN_ORDER', '订单不存在');
    return order;
  }
  function match(order, data) {
    if (data.app_id !== order.appId || data.seller_id !== order.sellerId || data.out_trade_no !== order.id ||
        moneyFen(data.total_amount) !== order.priceFen || !/^\d{10,64}$/.test(data.trade_no || '')) {
      throw fail(400, 'ALIPAY_ORDER_MISMATCH', '支付宝交易与本地订单不匹配');
    }
  }
  async function create(user, body) {
    requireOpen();
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(body?.requestId || '')) throw fail(400, 'INVALID_REQUEST_ID', '缺少操作编号');
    const tier = TIERS.find(t => t.id === body.tierId);
    if (!tier) throw fail(400, 'UNKNOWN_PRODUCT', '充值档位无效');
    const order = await store.transaction(environment, async tx => {
      await tx.lockWallet(user.id);
      const key = user.id + ':' + body.requestId;
      const prior = await tx.get('alipay_request', key, true);
      if (prior) {
        const existing = await tx.get('alipay_order', prior.orderId, true);
        if (!existing || existing.tierId !== tier.id) throw fail(409, 'REQUEST_REUSED', '操作编号已用于其他订单');
        return existing;
      }
      const pending = await tx.list('alipay_order', { owner: user.id, state: 'pending' });
      const review = await tx.list('alipay_order', { owner: user.id, state: 'review' });
      if (pending.length || review.length) throw fail(409, 'ALIPAY_PENDING_ORDER', '请先确认钱包中的待处理订单');
      const value = { id: 'OE' + crypto.randomUUID().replaceAll('-', ''), userId: user.id, tierId: tier.id,
        diamonds: tier.diamonds, priceFen: tier.priceFen, appId: settings.appId, sellerId: settings.sellerId,
        status: 'pending', credited: false, tradeNo: null, expiresAt: now() + 15 * 60000 };
      await tx.put('alipay_order', value.id, value, { owner: user.id, state: 'pending' });
      await tx.put('alipay_request', key, { orderId: value.id }, { owner: user.id });
      return value;
    });
    return { ...publicOrder(order), orderString: order.status === 'pending' && now() < order.expiresAt ? gateway.signOrder(order) : null };
  }
  async function refresh(userId, id) {
    requireOpen(); const original = await ownOrder(userId, id);
    let data;
    try { data = await gateway.query(id); } catch (_) { throw fail(503, 'ALIPAY_QUERY_UNAVAILABLE', '支付宝结果暂未确认，请稍后刷新'); }
    if (!data.notFound) match(original, data);
    if (!data.notFound && !['WAIT_BUYER_PAY', 'TRADE_SUCCESS', 'TRADE_FINISHED', 'TRADE_CLOSED'].includes(data.trade_status)) throw fail(400, 'INVALID_TRADE_STATUS', '支付宝交易状态无效');
    return store.transaction(environment, async tx => {
      const wallet = await tx.lockWallet(userId);
      const order = await tx.get('alipay_order', id, true);
      if (order.tradeNo && data.trade_no && order.tradeNo !== data.trade_no) throw fail(409, 'TRADE_CONFLICT', '交易编号冲突');
      const paid = ['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(data.trade_status);
      const closed = data.trade_status === 'TRADE_CLOSED';
      if (paid && ['closed', 'review'].includes(order.status)) {
        order.status = 'review';
        const review = await tx.get('alipay_review', id, true);
        await tx.put('alipay_review', id, review || { orderId: id, reason: 'paid_after_terminal_close' }, { owner: userId, state: 'needs_review' });
      } else if (paid && order.status !== 'refunded') {
        const claim = await tx.get('alipay_trade', data.trade_no, true);
        if (claim && claim.orderId !== id) throw fail(409, 'TRADE_REUSED', '交易已绑定其他订单');
        await tx.put('alipay_trade', data.trade_no, { orderId: id }, { owner: userId });
        if (!order.credited) {
          await changeBalance(tx, userId, wallet, { eventId: 'alipay:' + id + ':credit', type: 'recharge',
            amount: order.diamonds, recharge: true, note: '支付宝充值到账' });
          order.credited = true;
        }
        order.status = 'paid'; order.tradeNo = data.trade_no;
      } else if (closed) {
        if (order.credited) {
          await changeBalance(tx, userId, wallet, { eventId: 'alipay:' + id + ':refund', type: 'refund',
            amount: -order.diamonds, note: '支付宝全额退款，扣回钻石（不足记欠额）' });
          order.status = 'refunded';
        } else if (order.status !== 'refunded') order.status = 'closed';
        const review = await tx.get('alipay_review', id, true);
        if (review) await tx.put('alipay_review', id, review, { owner: userId, state: 'resolved' });
      } else if (data.notFound && now() >= order.expiresAt + 2 * 60000 && order.status === 'pending') order.status = 'closed';
      await tx.put('alipay_order', id, order, { owner: userId, state: order.status });
      return { order: publicOrder(order), mode: environment.toLowerCase(), wallet };
    });
  }
  async function notify(body) {
    requireOpen();
    if (!body || typeof body !== 'object' || Array.isArray(body) || !gateway.verifyNotify(body)) throw fail(400, 'INVALID_NOTIFY_SIGNATURE', '支付宝通知验签失败');
    const original = await store.transaction(environment, tx => tx.get('alipay_order', body.out_trade_no || ''));
    if (!original) throw fail(404, 'UNKNOWN_ORDER', '订单不存在');
    match(original, body);
    // Freeze before querying: no concurrent spend may slip between detection of a
    // partial refund and manual review. A verified full close resolves this hold.
    if (body.refund_fee && moneyFen(body.refund_fee) > 0) {
      await store.transaction(environment, async tx => {
        await tx.lockWallet(original.userId);
        const order = await tx.get('alipay_order', original.id, true);
        if (order.status !== 'refunded') {
          order.status = 'review';
          await tx.put('alipay_order', order.id, order, { owner: order.userId, state: 'review' });
          await tx.put('alipay_review', original.id,
            { orderId: original.id, reason: 'refund_requires_reconciliation' }, { owner: original.userId, state: 'needs_review' });
        }
      });
    }
    // Query current signed merchant-side state, avoiding stale signed notifications.
    return refresh(original.userId, original.id);
  }
  async function pending(user) {
    const orders = await store.transaction(environment, async tx => [
      ...await tx.list('alipay_order', { owner: user.id, state: 'pending' }),
      ...await tx.list('alipay_order', { owner: user.id, state: 'review' }),
    ]);
    return { mode: environment.toLowerCase(), orders: orders.map(publicOrder) };
  }
  async function resume(user, id) {
    await refresh(user.id, id);
    const order = await ownOrder(user.id, id);
    return { ...publicOrder(order), orderString: order.status === 'pending' && now() < order.expiresAt ? gateway.signOrder(order) : null };
  }
  return { create, refresh, notify, pending, resume, environment,
    products: () => ({ protocol: 2, mode: environment.toLowerCase(), products: open() ? TIERS : [] }) };
}
module.exports = { createAlipayService, TIERS, moneyFen };
