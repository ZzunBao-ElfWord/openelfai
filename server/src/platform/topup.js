'use strict';

const crypto = require('node:crypto');

// 充值档位：与开放平台（OpenRouter 风格）常用面额保持一致。
const TOPUP_TIERS = Object.freeze([
  { id: 'topup10', yuan: 10, price_fen: 1000 },
  { id: 'topup20', yuan: 20, price_fen: 2000 },
  { id: 'topup50', yuan: 50, price_fen: 5000 },
  { id: 'topup100', yuan: 100, price_fen: 10000 },
  { id: 'topup300', yuan: 300, price_fen: 30000 },
  { id: 'topup500', yuan: 500, price_fen: 50000 },
]);

// 自定义金额边界：1-5000 的整数元，防止异常金额与误输入。
const CUSTOM_AMOUNT = Object.freeze({ min_fen: 100, max_fen: 500000 });
const DEFAULT_RETURN_URL = 'https://openelfai.com/console/?view=topup';

const ORDER_COLUMNS =
  'id, user_id, tier_id, amount_fen, status, app_id, seller_id, trade_no, request_id, created_at, paid_at, expires_at';

function fail(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

// 支付宝金额字符串转分，禁止浮点运算。
function moneyFen(raw) {
  if (typeof raw !== 'string' || !/^\d{1,8}(\.\d{1,2})?$/.test(raw)) {
    throw fail(400, 'INVALID_AMOUNT', '支付金额无效');
  }
  const [yuan, decimal = ''] = raw.split('.');
  return Number(yuan) * 100 + Number(decimal.padEnd(2, '0'));
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function createTopupService({ db, settings, gateway, notifyUrl, returnUrl, now = Date.now }) {
  const open = () => Boolean(settings.enabled && gateway);
  const environment = settings.sandbox ? 'sandbox' : 'production';
  const webReturnUrl = returnUrl || DEFAULT_RETURN_URL;
  if (new URL(webReturnUrl).protocol !== 'https:') {
    throw new Error('充值回跳地址必须是 HTTPS 地址');
  }

  function requireOpen() {
    if (!open()) throw fail(503, 'ALIPAY_DISABLED', '支付宝充值尚未配置完成');
  }

  // 渠道：app 返回客户端签名字符串，web 返回收银台跳转链接。
  function readChannel(body) {
    return body?.channel === 'web' ? 'web' : 'app';
  }

  function sign(order) {
    return gateway.signOrder({
      id: order.id,
      priceFen: toNumber(order.amount_fen),
      subject: 'OpenElf 平台余额充值',
      expiresAt: toNumber(order.expires_at),
    }, { notifyUrl });
  }

  function payUrl(order) {
    const url = new URL(webReturnUrl);
    url.searchParams.set('order', order.id);
    return gateway.pagePay({
      id: order.id,
      priceFen: toNumber(order.amount_fen),
      subject: 'OpenElf 平台余额充值',
      expiresAt: toNumber(order.expires_at),
    }, { notifyUrl, returnUrl: url.toString() });
  }

  // 已失效或已支付的订单不再签单，仅回传状态。
  function paymentFields(order, channel) {
    if (order.status !== 'pending' || toNumber(order.expires_at) <= now()) {
      return channel === 'web' ? { payUrl: null } : { orderString: null };
    }
    if (channel === 'web') {
      if (typeof gateway.pagePay !== 'function') {
        throw fail(503, 'WEB_PAY_UNAVAILABLE', '网页支付暂不可用，请使用 App 内充值');
      }
      return { payUrl: payUrl(order) };
    }
    return { orderString: sign(order) };
  }

  function products() {
    return {
      products: TOPUP_TIERS.map((tier) => ({ id: tier.id, yuan: tier.yuan, price_fen: tier.price_fen })),
      custom: { min_fen: CUSTOM_AMOUNT.min_fen, max_fen: CUSTOM_AMOUNT.max_fen },
      mode: environment,
      enabled: open(),
    };
  }

  async function findByRequest(conn, userId, requestId) {
    const [rows] = await conn.execute(
      `SELECT ${ORDER_COLUMNS} FROM platform_topup_orders WHERE user_id = ? AND request_id = ? LIMIT 1`,
      [userId, requestId],
    );
    return rows[0] || null;
  }

  async function findById(conn, id, lock = false) {
    const [rows] = await conn.execute(
      `SELECT ${ORDER_COLUMNS} FROM platform_topup_orders WHERE id = ?${lock ? ' FOR UPDATE' : ''}`,
      [id],
    );
    return rows[0] || null;
  }

  function requireOrderId(id) {
    if (!/^OT[a-f0-9]{32}$/.test(id || '')) throw fail(400, 'INVALID_ORDER', '订单编号无效');
  }

  function match(order, data) {
    if (data.app_id !== order.app_id || data.seller_id !== order.seller_id ||
        data.out_trade_no !== order.id || moneyFen(data.total_amount) !== toNumber(order.amount_fen)) {
      throw fail(400, 'ALIPAY_ORDER_MISMATCH', '支付宝交易与本地订单不匹配');
    }
  }

  async function credit(conn, order, tradeNo) {
    const timestamp = now();
    const amountMicro = toNumber(order.amount_fen) * 10000;
    await conn.execute(
      `INSERT INTO platform_wallets (user_id, balance_micro, frozen_micro, total_topup_micro, updated_at)
       VALUES (?, ?, 0, ?, ?)
       ON DUPLICATE KEY UPDATE balance_micro = balance_micro + ?, total_topup_micro = total_topup_micro + ?, updated_at = ?`,
      [order.user_id, amountMicro, amountMicro, timestamp, amountMicro, amountMicro, timestamp],
    );
    const [walletRows] = await conn.execute(
      'SELECT balance_micro FROM platform_wallets WHERE user_id = ? FOR UPDATE',
      [order.user_id],
    );
    const balanceAfter = toNumber(walletRows[0]?.balance_micro);
    await conn.execute(
      `INSERT INTO platform_ledger (user_id, key_id, request_id, type, delta_micro, balance_after, note, created_at)
       VALUES (?, NULL, ?, 'topup', ?, ?, ?, ?)`,
      [order.user_id, order.id, amountMicro, balanceAfter, '支付宝充值到账', timestamp],
    );
    await conn.execute(
      `UPDATE platform_topup_orders SET status = 'paid', trade_no = ?, paid_at = ? WHERE id = ? AND status <> 'paid'`,
      [tradeNo, timestamp, order.id],
    );
    order.status = 'paid';
    order.trade_no = tradeNo;
    order.paid_at = timestamp;
    return balanceAfter;
  }

  async function applyTrade(conn, order, data) {
    if (['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(data.trade_status)) {
      if (order.status === 'paid') return null;
      return credit(conn, order, data.trade_no || null);
    }
    if (data.trade_status === 'TRADE_CLOSED') {
      if (order.status === 'pending') {
        await conn.execute(
          `UPDATE platform_topup_orders SET status = 'closed' WHERE id = ? AND status = 'pending'`,
          [order.id],
        );
        order.status = 'closed';
      }
    }
    return null;
  }

  function resolveTier(body) {
    const tier = TOPUP_TIERS.find((item) => item.id === body?.tierId);
    if (tier) return tier;
    if (body?.tierId !== 'custom') throw fail(400, 'UNKNOWN_PRODUCT', '充值档位无效');

    const raw = body?.amountYuan;
    const yuan = raw == null || raw === '' ? Number.NaN : Number(raw);
    const fen = Number.isInteger(yuan) ? yuan * 100 : Number.NaN;
    if (!Number.isFinite(fen) || fen < CUSTOM_AMOUNT.min_fen || fen > CUSTOM_AMOUNT.max_fen) {
      throw fail(400, 'INVALID_AMOUNT',
        `自定义金额需为 ${CUSTOM_AMOUNT.min_fen / 100}-${CUSTOM_AMOUNT.max_fen / 100} 的整数元`);
    }
    return { id: 'custom', yuan, price_fen: fen };
  }

  async function create(user, body) {
    requireOpen();
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(body?.requestId || '')) {
      throw fail(400, 'INVALID_REQUEST_ID', '缺少操作编号');
    }
    const tier = resolveTier(body);
    const channel = readChannel(body);

    const createdAt = now();
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const prior = await findByRequest(conn, user.id, body.requestId);
      if (prior) {
        if (prior.tier_id !== tier.id || toNumber(prior.amount_fen) !== tier.price_fen) {
          throw fail(409, 'REQUEST_REUSED', '操作编号已用于其他订单');
        }
        await conn.commit();
        return {
          id: prior.id,
          tier_id: prior.tier_id,
          amount_fen: toNumber(prior.amount_fen),
          status: prior.status,
          expires_at: toNumber(prior.expires_at),
          ...paymentFields(prior, channel),
        };
      }

      const [pendingRows] = await conn.execute(
        `SELECT id FROM platform_topup_orders
         WHERE user_id = ? AND status = 'pending' AND expires_at > ? LIMIT 1`,
        [user.id, createdAt],
      );
      if (pendingRows.length) {
        const error = fail(409, 'TOPUP_PENDING_ORDER', '请先完成待支付的充值订单');
        error.orderId = pendingRows[0].id;
        throw error;
      }

      const order = {
        id: 'OT' + crypto.randomUUID().replace(/-/g, ''),
        user_id: user.id,
        tier_id: tier.id,
        amount_fen: tier.price_fen,
        status: 'pending',
        app_id: settings.appId,
        seller_id: settings.sellerId,
        trade_no: null,
        request_id: body.requestId,
        created_at: createdAt,
        paid_at: null,
        expires_at: createdAt + 15 * 60_000,
      };
      await conn.execute(
        `INSERT INTO platform_topup_orders
          (id, user_id, tier_id, amount_fen, status, app_id, seller_id, trade_no, request_id, created_at, paid_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [order.id, order.user_id, order.tier_id, order.amount_fen, order.status, order.app_id,
          order.seller_id, order.trade_no, order.request_id, order.created_at, order.paid_at, order.expires_at],
      );
      await conn.commit();
      return {
        id: order.id,
        tier_id: order.tier_id,
        amount_fen: order.amount_fen,
        status: order.status,
        expires_at: order.expires_at,
        ...paymentFields(order, channel),
      };
    } catch (error) {
      await conn.rollback().catch(() => {});
      // 并发下同一 requestId 可能触发唯一索引；回查后按幂等返回原订单。
      if (error.code === 'ER_DUP_ENTRY') {
        const existing = await findByRequest(conn, user.id, body.requestId);
        if (existing) {
          if (existing.tier_id !== tier.id || toNumber(existing.amount_fen) !== tier.price_fen) {
            throw fail(409, 'REQUEST_REUSED', '操作编号已用于其他订单');
          }
          return {
            id: existing.id,
            tier_id: existing.tier_id,
            amount_fen: toNumber(existing.amount_fen),
            status: existing.status,
            expires_at: toNumber(existing.expires_at),
            ...paymentFields(existing, channel),
          };
        }
      }
      throw error;
    } finally {
      conn.release();
    }
  }

  async function resume(user, id, body) {
    requireOpen();
    requireOrderId(id);
    const channel = readChannel(body);
    const order = await findById(db, id);
    if (!order || order.user_id !== user.id) throw fail(404, 'UNKNOWN_ORDER', '订单不存在');
    if (order.status !== 'pending' || toNumber(order.expires_at) <= now()) {
      throw fail(400, 'TOPUP_ORDER_NOT_PAYABLE', '订单已失效，请重新下单');
    }
    return {
      id: order.id,
      tier_id: order.tier_id,
      amount_fen: toNumber(order.amount_fen),
      status: order.status,
      expires_at: toNumber(order.expires_at),
      ...paymentFields(order, channel),
    };
  }

  async function refresh(userId, id) {
    requireOpen();
    requireOrderId(id);
    const order = await findById(db, id);
    if (!order || order.user_id !== userId) throw fail(404, 'UNKNOWN_ORDER', '订单不存在');

    let data;
    try {
      data = await gateway.query(id);
    } catch (_) {
      throw fail(503, 'ALIPAY_QUERY_UNAVAILABLE', '支付宝结果暂未确认，请稍后刷新');
    }
    if (!data.notFound) match(order, data);

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const locked = await findById(conn, id, true);
      if (!locked) throw fail(404, 'UNKNOWN_ORDER', '订单不存在');
      if (!data.notFound) {
        if (locked.trade_no && data.trade_no && locked.trade_no !== data.trade_no) {
          throw fail(409, 'TRADE_CONFLICT', '交易编号冲突');
        }
        await applyTrade(conn, locked, data);
      }
      const [walletRows] = await conn.execute(
        'SELECT balance_micro FROM platform_wallets WHERE user_id = ?',
        [locked.user_id],
      );
      const balanceMicro = toNumber(walletRows[0]?.balance_micro);
      await conn.commit();
      return {
        id: locked.id,
        status: locked.status,
        amount_fen: toNumber(locked.amount_fen),
        paid_at: locked.paid_at == null ? null : toNumber(locked.paid_at),
        balance_micro: balanceMicro,
      };
    } catch (error) {
      await conn.rollback().catch(() => {});
      throw error;
    } finally {
      conn.release();
    }
  }

  async function notify(body) {
    if (!open()) throw fail(400, 'ALIPAY_DISABLED', '支付宝充值尚未配置完成');
    if (!body || typeof body !== 'object' || Array.isArray(body) || !gateway.verifyNotify(body)) {
      throw fail(400, 'INVALID_NOTIFY_SIGNATURE', '支付宝通知验签失败');
    }
    const order = await findById(db, body.out_trade_no || '');
    if (!order) throw fail(404, 'UNKNOWN_ORDER', '订单不存在');
    match(order, body);

    const status = body.trade_status;
    if (!['TRADE_SUCCESS', 'TRADE_FINISHED', 'TRADE_CLOSED'].includes(status)) return;

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const locked = await findById(conn, order.id, true);
      if (!locked) throw fail(404, 'UNKNOWN_ORDER', '订单不存在');
      if (locked.trade_no && body.trade_no && locked.trade_no !== body.trade_no) {
        throw fail(409, 'TRADE_CONFLICT', '交易编号冲突');
      }
      await applyTrade(conn, locked, body);
      await conn.commit();
    } catch (error) {
      await conn.rollback().catch(() => {});
      throw error;
    } finally {
      conn.release();
    }
  }

  return { products, create, resume, refresh, notify, environment };
}

module.exports = { createTopupService, TOPUP_TIERS, moneyFen };
