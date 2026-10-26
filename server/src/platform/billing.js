'use strict';
const crypto = require('node:crypto');
const { computeCost, computePrice } = require('./catalog');

function safeInt(v) {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid amount');
  return n;
}

function createBillingService(pool) {
  async function getWallet(userId) {
    const [rows] = await pool.execute(
      'SELECT user_id, balance_micro, frozen_micro, total_topup_micro, updated_at FROM platform_wallets WHERE user_id = ?',
      [userId]
    );
    if (!rows.length) {
      await pool.execute(
        'INSERT INTO platform_wallets (user_id, balance_micro, frozen_micro, total_topup_micro, updated_at) VALUES (?, 0, 0, 0, ?)',
        [userId, Date.now()]
      );
      return { user_id: userId, balance_micro: 0, frozen_micro: 0, total_topup_micro: 0, updated_at: Date.now() };
    }
    return rows[0];
  }

  async function topup(userId, amountMicro, note = 'topup') {
    safeInt(amountMicro);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        'INSERT INTO platform_wallets (user_id, balance_micro, frozen_micro, total_topup_micro, updated_at) VALUES (?, ?, 0, ?, ?) ON DUPLICATE KEY UPDATE balance_micro = balance_micro + ?, total_topup_micro = total_topup_micro + ?, updated_at = ?',
        [userId, amountMicro, amountMicro, Date.now(), amountMicro, amountMicro, Date.now()]
      );
      const [w] = await conn.execute('SELECT balance_micro FROM platform_wallets WHERE user_id = ? FOR UPDATE', [userId]);
      await conn.execute(
        'INSERT INTO platform_ledger (user_id, key_id, request_id, type, delta_micro, balance_after, note, created_at) VALUES (?, NULL, NULL, ?, ?, ?, ?, ?)',
        [userId, 'topup', amountMicro, w[0].balance_micro, note, Date.now()]
      );
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  async function preauth({ userId, keyId, model, promptTokens, maxTokens, price, markupBp }) {
    const estCost = computeCost(promptTokens, maxTokens, price);
    const estPrice = computePrice(estCost, markupBp);
    const requestId = crypto.randomUUID();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [w] = await conn.execute('SELECT balance_micro, frozen_micro FROM platform_wallets WHERE user_id = ? FOR UPDATE', [userId]);
      if (!w.length) {
        const err = new Error('insufficient_balance');
        err.statusCode = 402; throw err;
      }
      if (w[0].balance_micro - w[0].frozen_micro < estPrice) {
        const err = new Error('insufficient_balance');
        err.statusCode = 402; throw err;
      }
      await conn.execute('UPDATE platform_wallets SET frozen_micro = frozen_micro + ? WHERE user_id = ?', [estPrice, userId]);
      await conn.commit();
      return { requestId, frozen: estPrice };
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  async function settle({ userId, requestId, keyId, promptTokens, completionTokens, resolvedModel, latencyMs, ttftMs = 0, status = 'ok', errorCode = null, estimated = false, price, markupBp }) {
    const actualCost = computeCost(promptTokens, completionTokens, price);
    const actualPrice = computePrice(actualCost, markupBp);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [w] = await conn.execute('SELECT balance_micro, frozen_micro FROM platform_wallets WHERE user_id = ? FOR UPDATE', [userId]);
      const frozen = w[0] ? w[0].frozen_micro : 0;
      const charge = Math.min(frozen, actualPrice);
      await conn.execute('UPDATE platform_wallets SET balance_micro = balance_micro - ?, frozen_micro = frozen_micro - ? WHERE user_id = ?',
        [charge, frozen, userId]);
      const [w2] = await conn.execute('SELECT balance_micro FROM platform_wallets WHERE user_id = ?', [userId]);
      await conn.execute(
        'INSERT INTO platform_ledger (user_id, key_id, request_id, type, delta_micro, balance_after, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [userId, keyId || null, requestId, 'charge', -charge, w2[0].balance_micro, resolvedModel, Date.now()]
      );
      await conn.execute(
        `INSERT INTO platform_requests (id, user_id, key_id, source, requested_model, resolved_model, prompt_tokens, completion_tokens, cost_micro, price_micro, latency_ms, ttft_ms, status, error_code, estimated, created_at)
         VALUES (?, ?, ?, 'external', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [requestId, userId, keyId || null, resolvedModel, resolvedModel, promptTokens, completionTokens, actualCost, actualPrice, latencyMs, ttftMs, status, errorCode, estimated ? 1 : 0, Date.now()]
      );
      await conn.commit();
      return { charged: charge, actualCost, actualPrice };
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  async function release({ userId, requestId }) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [w] = await conn.execute('SELECT frozen_micro FROM platform_wallets WHERE user_id = ? FOR UPDATE', [userId]);
      if (w.length && w[0].frozen_micro > 0) {
        await conn.execute('UPDATE platform_wallets SET frozen_micro = 0 WHERE user_id = ?', [userId]);
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  return { getWallet, topup, preauth, settle, release };
}

module.exports = { createBillingService };
