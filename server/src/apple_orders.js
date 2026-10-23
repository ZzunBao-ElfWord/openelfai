'use strict';

const { changeBalance, fail } = require('./payment_store');

function userFromToken(token) {
  if (typeof token !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) return null;
  return 'u_' + token.replaceAll('-', '').toLowerCase();
}

function createOrderService({ store, settings, products, validate, accountToken, verifyTransaction, verifyNotification }) {
  function allow(environment) {
    if (!['Sandbox', 'Production'].includes(environment) ||
        settings.sandboxOnly && environment !== 'Sandbox' ||
        environment === 'Sandbox' && !settings.allowSandbox) {
      throw fail(400, 'APPLE_ENVIRONMENT_MISMATCH', '交易环境尚未开放');
    }
    return environment;
  }
  async function apply(userId, transaction, { notification, forcedRevoked } = {}) {
    const environment = allow(transaction.environment);
    validate(transaction, { transactionId: String(transaction.transactionId), productId: transaction.productId,
      bundleId: settings.bundleId, appAccountToken: accountToken(userId), allowRevoked: true });
    if (!Object.hasOwn(products, transaction.productId)) throw fail(400, 'UNKNOWN_PRODUCT', '商品尚未配置');
    return store.transaction(environment, async (tx) => {
      if (!await tx.user(userId)) throw fail(409, 'UNKNOWN_ACCOUNT', '订单账户不存在');
      const wallet = await tx.lockWallet(userId);
      if (notification && await tx.get('notification', notification.notificationUUID, true)) {
        return { mode: environment.toLowerCase(), wallet, alreadyProcessed: true };
      }
      const id = String(transaction.transactionId);
      let order = await tx.get('order', id, true);
      if (!order) {
        const legacy = await tx.legacyOrder(id);
        if (legacy && (legacy.user_id !== userId || legacy.product_id !== transaction.productId)) {
          throw fail(409, 'PURCHASE_ALREADY_CLAIMED', '交易已绑定其他账号');
        }
        order = { id, userId, productId: transaction.productId,
          amount: legacy ? Number(legacy.diamonds) : products[transaction.productId],
          applied: Boolean(legacy), everCredited: Boolean(legacy), revoked: false,
          signedAt: 0, purchaseDate: transaction.purchaseDate || null };
      }
      if (order.userId !== userId || order.productId !== transaction.productId) throw fail(409, 'PURCHASE_ALREADY_CLAIMED', '交易已绑定其他账号');
      const timestamp = notification?.signedDate ?? transaction.signedDate;
      if (!Number.isSafeInteger(timestamp) || timestamp <= 0) throw fail(400, 'INVALID_APPLE_DATE', '交易签名时间无效');
      const revoked = forcedRevoked ?? transaction.revocationDate != null;
      const stale = timestamp < order.signedAt || timestamp === order.signedAt && order.revoked && !revoked;
      let changed = false;
      if (!stale) {
        const shouldApply = !revoked;
        if (shouldApply !== order.applied) {
          const firstCredit = shouldApply && !order.everCredited;
          await changeBalance(tx, userId, wallet, {
            eventId: `apple:${id}:${shouldApply ? 'credit' : 'refund'}:${timestamp}`,
            type: shouldApply ? firstCredit ? 'recharge' : 'refund_reversed' : 'refund',
            amount: shouldApply ? order.amount : -order.amount,
            recharge: firstCredit,
            note: shouldApply ? firstCredit ? 'Apple 内购到账' : 'Apple 退款撤销，恢复钻石' : 'Apple 退款，扣回钻石（不足部分记欠额）',
          });
          changed = true;
          if (firstCredit) await tx.legacyGrant(order);
          order.applied = shouldApply;
          if (shouldApply) order.everCredited = true;
        }
        order.revoked = revoked;
        order.signedAt = timestamp;
        await tx.put('order', id, order, { owner: userId, state: revoked ? 'refunded' : 'credited' });
      }
      if (notification) await tx.put('notification', notification.notificationUUID,
        { id: notification.notificationUUID, type: notification.notificationType, transactionId: id, signedAt: notification.signedDate },
        { owner: userId, ref: id, state: stale ? 'stale' : 'processed' });
      return { mode: environment.toLowerCase(), wallet, alreadyProcessed: !changed,
        orderStatus: order.revoked ? 'refunded' : 'credited' };
    });
  }

  async function verifyAndGrant(userId, body) {
    if (!settings.enabled) throw fail(503, 'APPLE_IAP_DISABLED', '苹果内购尚未开放');
    if (typeof body?.transactionId !== 'string' || !/^\d{5,30}$/.test(body.transactionId) ||
        typeof body?.productId !== 'string' || !Object.hasOwn(products, body.productId)) {
      throw fail(400, 'INVALID_PURCHASE', '商品或交易编号无效');
    }
    let transaction;
    try { transaction = await verifyTransaction(body.transactionId); }
    catch (_) { throw fail(503, 'APPLE_VERIFY_UNAVAILABLE', '暂时无法核实交易，请稍后重试'); }
    validate(transaction, { transactionId: body.transactionId, productId: body.productId,
      bundleId: settings.bundleId, appAccountToken: accountToken(userId), allowRevoked: true });
    return apply(userId, transaction);
  }

  async function notification(body, expectedEnvironment) {
    if (!settings.enabled || typeof verifyNotification !== 'function') throw fail(503, 'NOTIFICATIONS_DISABLED', '通知服务尚未开放');
    if (typeof body?.signedPayload !== 'string' || !body.signedPayload || body.signedPayload.length > 200000) throw fail(400, 'INVALID_NOTIFICATION', '通知格式无效');
    let decoded;
    try { decoded = await verifyNotification(body.signedPayload); }
    catch (_) { throw fail(400, 'INVALID_NOTIFICATION_SIGNATURE', '通知签名校验失败'); }
    if (!decoded?.payload) throw fail(400, 'INVALID_NOTIFICATION_SIGNATURE', '通知校验结果无效');
    const { payload, transaction, environment } = decoded;
    allow(environment);
    if (expectedEnvironment !== environment || typeof payload.notificationUUID !== 'string' ||
        !/^[a-zA-Z0-9-]{16,100}$/.test(payload.notificationUUID) || !Number.isSafeInteger(payload.signedDate)) {
      throw fail(400, 'INVALID_NOTIFICATION', '通知环境或编号无效');
    }
    const type = payload.notificationType;
    if (['REFUND', 'REVOKE', 'REFUND_REVERSED', 'ONE_TIME_CHARGE'].includes(type)) {
      if (!transaction) throw fail(400, 'MISSING_TRANSACTION', '通知缺少交易');
      let userId = userFromToken(transaction.appAccountToken);
      if (!userId) {
        userId = await store.transaction(environment, async (tx) =>
          (await tx.get('order', String(transaction.transactionId)))?.userId ||
          (await tx.legacyOrder(String(transaction.transactionId)))?.user_id);
      }
      if (userId) {
        // Orders created by this app must retain their original account binding.
        if (!transaction.appAccountToken) throw fail(409, 'MISSING_ACCOUNT_TOKEN', '交易缺少账号绑定，需要人工核对');
        await apply(userId, transaction, { notification: payload,
          forcedRevoked: ['REFUND', 'REVOKE'].includes(type) ? true : type === 'REFUND_REVERSED' ? false : undefined });
        return { ok: true };
      }
    }
    await store.transaction(environment, async (tx) => {
      if (!await tx.get('notification', payload.notificationUUID, true)) {
        await tx.put('notification', payload.notificationUUID,
          { id: payload.notificationUUID, type, signedPayload: body.signedPayload, transactionId: transaction?.transactionId || null },
          { ref: transaction?.transactionId || null, state: type === 'TEST' || type === 'REFUND_DECLINED' ? 'processed' : 'needs_review' });
      }
    });
    return { ok: true };
  }

  async function reconcile(userId, transactionId) {
    const transaction = await verifyTransaction(transactionId);
    return apply(userId, transaction);
  }
  return { verifyAndGrant, notification, reconcile };
}

module.exports = { createOrderService, userFromToken };
