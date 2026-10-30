'use strict';

const crypto = require('node:crypto');

// Financial orders, receipts and ledgers deliberately remain under the old,
// inaccessible user ID so late payment notifications cannot credit a new account.
const PERSONAL_KINDS = ['profile', 'identity', 'identity_request', 'elf', 'book',
  'chat', 'post', 'comment', 'comment_once', 'follow', 'like', 'collect', 'watch',
  'notice', 'notice_mark', 'notice_once', 'referral', 'creator_agreement',
  'community_block', 'community_terms', 'community_report', 'community_queue'];

function fail(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

async function deleteAccount(db, userId) {
  const tx = await db.getConnection();
  try {
    await tx.beginTransaction();
    const [[user]] = await tx.execute('SELECT * FROM users WHERE id = ? FOR UPDATE', [userId]);
    if (!user || user.status !== 'active') throw fail(401, 'UNAUTHORIZED', '账号已失效');

    // Never silently discard unsettled money, liabilities or an in-flight payout.
    const [[wallet]] = await tx.execute(
      'SELECT balance_micro, frozen_micro FROM platform_wallets WHERE user_id = ? FOR UPDATE', [userId]);
    // Diamonds are not platform API credit. Lock both ledgers before deleting
    // identity/session data; never make remaining paid assets inaccessible.
    const [diamonds] = await tx.execute(
      'SELECT diamonds FROM user_wallets WHERE user_id = ? FOR UPDATE', [userId]);
    const [sandboxDiamonds] = await tx.execute(
      'SELECT diamonds FROM apple_iap_sandbox_wallets WHERE user_id = ? FOR UPDATE', [userId]);
    const [meta] = await tx.execute('SELECT * FROM payment_wallet_meta WHERE user_id = ? FOR UPDATE', [userId]);
    const [orders] = await tx.execute(
      "SELECT id FROM platform_topup_orders WHERE user_id = ? AND status NOT IN ('paid', 'closed') FOR UPDATE", [userId]);
    const [pending] = await tx.execute(
      `SELECT kind FROM payment_objects WHERE owner_id = ? AND
       ((kind = 'withdrawal'
         AND state NOT IN ('paid', 'closed', 'rejected', 'cancelled', 'succeeded', 'refunded', 'failed'))
        OR (kind IN ('alipay_order', 'web_alipay_order', 'web2_alipay_order')
         AND state NOT IN ('paid', 'closed', 'rejected', 'cancelled', 'succeeded', 'refunded'))
        OR (kind = 'earning' AND state = 'pending')) FOR UPDATE`, [userId]);
    if (Number(wallet?.balance_micro || 0) || Number(wallet?.frozen_micro || 0)
      || [...diamonds, ...sandboxDiamonds].some(row => Number(row.diamonds || 0) !== 0)
      || meta.some((r) => ['refund_debt', 'pending_cents', 'available_cents'].some((k) => Number(r[k] || 0)))
      || orders.length || pending.length) {
      throw fail(409, 'ACCOUNT_UNSETTLED', '账号存在余额、待确认订单或未结算收益，请先完成结算后注销');
    }

    const now = Date.now();
    await tx.execute('UPDATE refresh_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [now, userId]);
    await tx.execute('UPDATE platform_api_keys SET revoked_at = COALESCE(revoked_at, ?), key_cipher = NULL WHERE user_id = ?', [now, userId]);
    await tx.execute('DELETE FROM sms_codes WHERE phone = ?', [user.phone]);
    // The production identity service stores only masked verification results in
    // this dedicated table. ID images are streamed to the provider and are not
    // persisted by OpenElf.
    try { await tx.execute('DELETE FROM identity_verifications WHERE user_id = ?', [userId]); }
    catch (error) { if (error.code !== 'ER_NO_SUCH_TABLE') throw error; }
    await tx.execute('DELETE FROM platform_developers WHERE user_id = ?', [userId]);
    // Optional on older installations; keep new compliance cleanup inside the
    // same transaction as financial checks and session revocation.
    for (const sql of [
      'DELETE FROM compliance_blocks WHERE user_id = ?',
      "UPDATE compliance_reports SET state = 'dismissed', note = '举报人已注销账号' WHERE user_id = ? AND state = 'open'",
    ]) {
      try { await tx.execute(sql, [userId]); }
      catch (error) { if (error.code !== 'ER_NO_SUCH_TABLE') throw error; }
    }
    await tx.execute(`DELETE FROM payment_objects WHERE owner_id = ? AND kind IN (${PERSONAL_KINDS.map(() => '?').join(',')})`, [userId, ...PERSONAL_KINDS]);
    // The push module is optional on older deployments. Do not ignore other errors.
    try { await tx.execute('DELETE FROM push_devices WHERE user_id = ?', [userId]); }
    catch (error) { if (error.code !== 'ER_NO_SUCH_TABLE') throw error; }
    await tx.execute(
      "UPDATE users SET status = 'deleted', phone = ?, nickname = '已注销用户', avatar_initial = '注', last_login_at = NULL WHERE id = ?",
      ['deleted_' + crypto.randomBytes(6).toString('hex'), userId]);
    await tx.commit();
    return { deleted: true };
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally { tx.release(); }
}

async function cleanupDeletedAccount(db, userId) {
  const tx = await db.getConnection();
  try {
    await tx.beginTransaction();
    const [[user]] = await tx.execute('SELECT * FROM users WHERE id = ? FOR UPDATE', [userId]);
    if (!user || user.status !== 'deleted') {
      throw fail(409, 'NOT_DELETED_ACCOUNT', '该用户不是上一版已注销账号，未执行残留清理');
    }
    const now = Date.now();
    await tx.execute('UPDATE refresh_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [now, userId]);
    await tx.execute('UPDATE platform_api_keys SET revoked_at = COALESCE(revoked_at, ?), key_cipher = NULL WHERE user_id = ?', [now, userId]);
    await tx.execute('DELETE FROM identity_verifications WHERE user_id = ?', [userId]);
    await tx.execute('DELETE FROM platform_developers WHERE user_id = ?', [userId]);
    await tx.execute(`DELETE FROM payment_objects WHERE owner_id = ? AND kind IN (${PERSONAL_KINDS.map(() => '?').join(',')})`, [userId, ...PERSONAL_KINDS]);
    try { await tx.execute('DELETE FROM push_devices WHERE user_id = ?', [userId]); }
    catch (error) { if (error.code !== 'ER_NO_SUCH_TABLE') throw error; }
    await tx.commit();
    return { cleaned: true };
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally { tx.release(); }
}

function registerAccountDeletion(app, { db, authenticate }) {
  app.post('/api/v1/auth/delete-account', {
    config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { user } = await authenticate(request);
    if (request.body?.confirmation !== 'DELETE_MY_ACCOUNT') {
      throw fail(400, 'DELETE_CONFIRMATION_REQUIRED', '请确认注销账号');
    }
    const result = await deleteAccount(db, user.id);
    reply.header('Cache-Control', 'no-store');
    return result;
  });
}

module.exports = { cleanupDeletedAccount, deleteAccount, registerAccountDeletion, PERSONAL_KINDS };
