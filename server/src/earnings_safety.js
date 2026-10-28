'use strict';
const crypto = require('node:crypto');

function legacyFingerprint(rows) {
  return crypto.createHash('sha256').update(JSON.stringify(rows
    .map(row => [row.id, row.cents, row.refId || null, row.source || null])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0]))))).digest('hex');
}

// Keyset pagination cannot be crowded out by newly inserted pending earnings.
async function* earningsRows(tx, owner, { state, lock = false } = {}) {
  let after = '';
  for (;;) {
    const rows = await tx.scan('earning', { owner, state, after, limit: 200, lock });
    for (const row of rows) yield row.value;
    if (rows.length < 200) return;
    const last = rows[rows.length - 1].key;
    if (last <= after) throw new Error('Invalid earnings scan cursor');
    after = last;
  }
}

async function incomeRisk(tx, owner, wallet, { lock = false } = {}) {
  if (wallet.refundDebt > 0) return '账号有退款欠额，提现前需人工核对';
  if ((await tx.list('alipay_review', { owner, state: 'needs_review', limit: 1, lock })).length) {
    return '账号有待核对的支付宝交易，暂不可提现';
  }
  const payers = new Set();
  const legacy = [];
  for await (const row of earningsRows(tx, owner)) {
    if (row.cents <= 0) continue;
    if (!row.payerId) legacy.push(row);
    else payers.add(row.payerId);
  }
  // Old records lack the payer link. Do not invent provenance or silently
  // declare them safe; balances stay intact pending a separate audited review.
  if (legacy.length) {
    const reviewed = await tx.get('income_legacy_review', owner, lock);
    if (reviewed?.fingerprint !== legacyFingerprint(legacy)) {
      return '历史收益缺少付款来源关联，需人工核对后再开放提现';
    }
  }
  for (const payer of [...payers].sort()) {
    const risk = await tx.get('income_refund_risk', payer, lock);
    if (risk && risk.resolved !== true) {
      return '收益来源存在退款待核对，额度保留，暂不可提现';
    }
    if ((await tx.list('alipay_review', { owner: payer, state: 'needs_review', limit: 1, lock })).length) {
      return '收益来源存在异常付款待核对，暂不可提现';
    }
  }
  return null;
}

module.exports = { earningsRows, incomeRisk, legacyFingerprint };
