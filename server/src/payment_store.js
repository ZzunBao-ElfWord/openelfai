'use strict';

const crypto = require('node:crypto');

const PAYMENT_TABLES = [
  `CREATE TABLE IF NOT EXISTS payment_wallet_meta (
    environment VARCHAR(16) NOT NULL, user_id VARCHAR(40) NOT NULL,
    total_spent BIGINT UNSIGNED NOT NULL DEFAULT 0,
    refund_debt BIGINT UNSIGNED NOT NULL DEFAULT 0,
    earnings_fen BIGINT UNSIGNED NOT NULL DEFAULT 0,
    version BIGINT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (environment, user_id),
    CONSTRAINT fk_payment_meta_user FOREIGN KEY (user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS payment_objects (
    environment VARCHAR(16) NOT NULL, kind VARCHAR(24) NOT NULL,
    object_id VARCHAR(160) NOT NULL, owner_id VARCHAR(40) NULL,
    ref_id VARCHAR(160) NULL, state VARCHAR(24) NOT NULL DEFAULT '',
    payload LONGTEXT NOT NULL, updated_at VARCHAR(32) NOT NULL,
    PRIMARY KEY (environment, kind, object_id),
    INDEX idx_payment_owner (environment, kind, owner_id),
    INDEX idx_payment_state (environment, kind, state),
    INDEX idx_payment_ref (environment, kind, ref_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS payment_ledger (
    environment VARCHAR(16) NOT NULL, user_id VARCHAR(40) NOT NULL,
    event_id VARCHAR(160) NOT NULL, type VARCHAR(24) NOT NULL,
    amount BIGINT NOT NULL, balance_after BIGINT UNSIGNED NOT NULL,
    debt_after BIGINT UNSIGNED NOT NULL, note VARCHAR(255) NOT NULL,
    created_at VARCHAR(32) NOT NULL,
    PRIMARY KEY (environment, user_id, event_id),
    INDEX idx_payment_logs (environment, user_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

function tables(environment) {
  if (environment === 'Sandbox') return { wallet: 'apple_iap_sandbox_wallets', order: 'apple_iap_sandbox_transactions' };
  if (environment === 'Production') return { wallet: 'user_wallets', order: 'apple_iap_transactions' };
  throw new Error('Invalid payment environment');
}

function safeInteger(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error('Invalid ledger integer');
  return number;
}

function createPaymentStore(db) {
  return {
    async transaction(environment, work) {
      const names = tables(environment);
      for (let attempt = 0; ; attempt++) {
        const connection = await db.getConnection();
        try {
          await connection.beginTransaction();
          const query = async (sql, params = []) => (await connection.execute(sql, params))[0];
          const tx = {
            async user(id) {
              return (await query('SELECT id, nickname, status FROM users WHERE id = ?', [id]))[0];
            },
            async lockWallet(userId) {
              await query(`INSERT IGNORE INTO ${names.wallet} (user_id, diamonds, total_recharged, updated_at) VALUES (?, 0, 0, ?)`, [userId, new Date().toISOString()]);
              const row = (await query(`SELECT diamonds, total_recharged FROM ${names.wallet} WHERE user_id = ? FOR UPDATE`, [userId]))[0];
              await query('INSERT IGNORE INTO payment_wallet_meta (environment, user_id) VALUES (?, ?)', [environment, userId]);
              const meta = (await query('SELECT * FROM payment_wallet_meta WHERE environment = ? AND user_id = ? FOR UPDATE', [environment, userId]))[0];
              return { diamonds: safeInteger(row.diamonds), totalRecharged: safeInteger(row.total_recharged),
                totalSpent: safeInteger(meta.total_spent), refundDebt: safeInteger(meta.refund_debt),
                earningsFen: safeInteger(meta.earnings_fen), version: safeInteger(meta.version) };
            },
            async saveWallet(userId, wallet) {
              for (const value of Object.values(wallet)) safeInteger(value);
              await query(`UPDATE ${names.wallet} SET diamonds = ?, total_recharged = ?, updated_at = ? WHERE user_id = ?`,
                [wallet.diamonds, wallet.totalRecharged, new Date().toISOString(), userId]);
              await query('UPDATE payment_wallet_meta SET total_spent = ?, refund_debt = ?, earnings_fen = ?, version = ? WHERE environment = ? AND user_id = ?',
                [wallet.totalSpent, wallet.refundDebt, wallet.earningsFen, wallet.version, environment, userId]);
            },
            async get(kind, id, lock = false) {
              const rows = await query('SELECT payload FROM payment_objects WHERE environment = ? AND kind = ? AND object_id = ?' + (lock ? ' FOR UPDATE' : ''), [environment, kind, id]);
              return rows[0] ? JSON.parse(rows[0].payload) : null;
            },
            async put(kind, id, value, { owner = null, ref = null, state = '' } = {}) {
              await query(`INSERT INTO payment_objects (environment, kind, object_id, owner_id, ref_id, state, payload, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE owner_id=VALUES(owner_id),
                ref_id=VALUES(ref_id), state=VALUES(state), payload=VALUES(payload), updated_at=VALUES(updated_at)`,
              [environment, kind, id, owner, ref, state, JSON.stringify(value), new Date().toISOString()]);
            },
            async list(kind, { owner, state, limit = 200, lock = false } = {}) {
              const filters = ['environment = ?', 'kind = ?'];
              const params = [environment, kind];
              if (owner !== undefined) { filters.push('owner_id = ?'); params.push(owner); }
              if (state !== undefined) { filters.push('state = ?'); params.push(state); }
              const count = Math.max(1, Math.min(500, Number(limit) || 200));
              const rows = await query(`SELECT payload FROM payment_objects WHERE ${filters.join(' AND ')} ORDER BY updated_at DESC, object_id ASC LIMIT ${Math.trunc(count)}` + (lock ? ' FOR UPDATE' : ''), params);
              return rows.map((row) => JSON.parse(row.payload));
            },
            async legacyOrder(id) {
              return (await query(`SELECT * FROM ${names.order} WHERE transaction_id = ? FOR UPDATE`, [id]))[0] || null;
            },
            async legacyGrant(order) {
              await query(`INSERT IGNORE INTO ${names.order} (transaction_id,user_id,product_id,diamonds,environment,purchased_at,created_at) VALUES (?,?,?,?,?,?,?)`,
                [order.id, order.userId, order.productId, order.amount, environment, order.purchaseDate || null, new Date().toISOString()]);
            },
            async logExists(userId, eventId) {
              return (await query('SELECT event_id FROM payment_ledger WHERE environment=? AND user_id=? AND event_id=?', [environment, userId, eventId])).length > 0;
            },
            async log(userId, eventId, type, amount, wallet, note) {
              await query('INSERT INTO payment_ledger (environment,user_id,event_id,type,amount,balance_after,debt_after,note,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
                [environment, userId, eventId, type, amount, wallet.diamonds, wallet.refundDebt, note.slice(0, 255), new Date().toISOString()]);
            },
            async logs(userId) {
              return query('SELECT event_id AS id, type, amount, note, created_at AS time FROM payment_ledger WHERE environment=? AND user_id=? ORDER BY created_at DESC, event_id DESC LIMIT 100', [environment, userId]);
            },
          };
          const result = await work(tx);
          await connection.commit();
          return result;
        } catch (error) {
          await connection.rollback();
          if (!['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error.code) || attempt >= 2) throw error;
        } finally { connection.release(); }
      }
    },
  };
}

function fingerprint(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function fail(statusCode, code, message) { return Object.assign(new Error(message), { statusCode, code }); }

async function changeBalance(tx, userId, wallet, { eventId, type, amount, note, recharge = false, spend = false }) {
  if (!Number.isSafeInteger(amount)) throw new Error('Invalid ledger amount');
  if (await tx.logExists(userId, eventId)) return wallet;
  if (spend && (wallet.refundDebt > 0 || wallet.diamonds < -amount)) {
    throw fail(409, wallet.refundDebt ? 'REFUND_DEBT' : 'INSUFFICIENT_BALANCE', wallet.refundDebt ? '请先补足退款欠额后再消费' : '钻石余额不足');
  }
  if (amount >= 0) {
    const repayment = Math.min(wallet.refundDebt, amount);
    wallet.refundDebt -= repayment;
    wallet.diamonds += amount - repayment;
  } else {
    const deduction = Math.min(wallet.diamonds, -amount);
    wallet.diamonds -= deduction;
    wallet.refundDebt += -amount - deduction;
  }
  if (recharge) wallet.totalRecharged += amount;
  if (spend) wallet.totalSpent -= amount;
  wallet.version++;
  await tx.saveWallet(userId, wallet);
  await tx.log(userId, eventId, type, amount, wallet, note);
  return wallet;
}

module.exports = { PAYMENT_TABLES, createPaymentStore, changeBalance, fingerprint, fail, tables };
