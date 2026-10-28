'use strict';
const crypto = require('node:crypto');
const { earningsRows, legacyFingerprint } = require('./earnings_safety');
const { fail } = require('./payment_store');

// Internal operator API only. No wallet mutation and no payout is made here.
function createEarningsReview(store) {
  function validUser(id) {
    if (!/^u_[a-f0-9]{32}$/.test(id || '')) throw fail(400, 'INVALID_USER', '用户编号无效');
  }
  async function inspect(userId) {
    validUser(userId);
    return store.transaction('Production', async tx => {
      if (!await tx.user(userId)) throw fail(404, 'UNKNOWN_USER', '用户不存在');
      const legacy = [];
      for await (const row of earningsRows(tx, userId)) if (row.cents > 0 && !row.payerId) legacy.push(row);
      return { refundRisk: await tx.get('income_refund_risk', userId),
        legacy: { count: legacy.length, cents: legacy.reduce((sum, row) => sum + row.cents, 0),
          fingerprint: legacyFingerprint(legacy) },
        legacyReview: await tx.get('income_legacy_review', userId) };
    });
  }
  async function review(userId, body = {}) {
    validUser(userId);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, 'INVALID_REVIEW', '核对请求格式无效');
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (body.confirmed !== true || reason.length < 10 || reason.length > 500) {
      throw fail(400, 'REVIEW_EVIDENCE_REQUIRED', '需明确确认，并填写10至500字核对依据');
    }
    return store.transaction('Production', async tx => {
      if (!await tx.user(userId)) throw fail(404, 'UNKNOWN_USER', '用户不存在');
      await tx.lockWallet(userId);
      const at = new Date().toISOString();
      if (body.action === 'resolve_refund') {
        const risk = await tx.get('income_refund_risk', userId, true);
        if (!risk || risk.eventId !== body.expectedEventId) throw fail(409, 'RISK_CHANGED', '退款记录已变化，请重新核对');
        if (risk.resolved === true) return { ok: true, alreadyProcessed: true };
        await tx.put('income_refund_risk', userId, { ...risk, resolved: true, reason, reviewedAt: at },
          { owner: userId, state: 'resolved' });
      } else if (body.action === 'clear_legacy') {
        const legacy = [];
        for await (const row of earningsRows(tx, userId)) if (row.cents > 0 && !row.payerId) legacy.push(row);
        const fingerprint = legacyFingerprint(legacy);
        if (!legacy.length || fingerprint !== body.fingerprint) throw fail(409, 'EARNINGS_CHANGED', '历史收益已变化，请重新核对');
        await tx.put('income_legacy_review', userId, { fingerprint, reason, reviewedAt: at }, { owner: userId, state: 'reviewed' });
      } else throw fail(400, 'INVALID_ACTION', '核对动作无效');
      await tx.put('income_risk_audit', crypto.randomUUID(), { userId, action: body.action,
        reason, expectedEventId: body.expectedEventId || null, fingerprint: body.fingerprint || null,
        at, reviewer: 'withdrawal-operator' }, { owner: userId, state: 'reviewed' });
      return { ok: true };
    });
  }
  return { inspect, review };
}
module.exports = { createEarningsReview };
