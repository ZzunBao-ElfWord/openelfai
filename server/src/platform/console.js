'use strict';

const DAY_MS = 86_400_000;
const SHANGHAI_OFFSET_MS = 8 * 3_600_000;
const DEFAULT_USAGE_DAYS = 30;
const MAX_USAGE_DAYS = 90;
const DEFAULT_LEDGER_LIMIT = 50;
const MAX_LEDGER_LIMIT = 100;

// 按 UTC+8 自然日分桶。
const DAY_EXPR = "DATE_FORMAT(FROM_UNIXTIME(created_at / 1000 + 28800), '%Y-%m-%d')";

const TOTALS_SQL = `SELECT COUNT(*) AS requests,
    COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS tokens,
    COALESCE(SUM(cost_micro), 0) AS cost_micro
  FROM platform_requests
  WHERE user_id = ? AND status = 'ok' AND created_at >= ? AND created_at < ?`;

const DAY_STATS_SQL = `SELECT ${DAY_EXPR} AS day,
    COUNT(*) AS requests,
    COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS tokens,
    COALESCE(SUM(cost_micro), 0) AS cost_micro
  FROM platform_requests
  WHERE user_id = ? AND status = 'ok' AND created_at >= ? AND created_at < ?
  GROUP BY day`;

const MODEL_STATS_SQL = `SELECT resolved_model AS model,
    COUNT(*) AS requests,
    COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS tokens,
    COALESCE(SUM(cost_micro), 0) AS cost_micro
  FROM platform_requests
  WHERE user_id = ? AND status = 'ok' AND created_at >= ? AND created_at < ?
  GROUP BY resolved_model
  ORDER BY cost_micro DESC, resolved_model ASC`;

function fail(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

// MySQL 的 BIGINT/DECIMAL 可能以字符串返回。
function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function toTimestamp(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return 0;
  const numeric = Number(text);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function maskPhone(phone) {
  const text = typeof phone === 'string' ? phone : '';
  if (text.length < 8) return '****';
  return `${text.slice(0, 3)}****${text.slice(-4)}`;
}

function readDays(query) {
  const raw = query?.days;
  if (raw === undefined || raw === null || raw === '') return DEFAULT_USAGE_DAYS;
  const text = String(raw).trim();
  const days = Number(text);
  if (!/^\d+$/.test(text) || !Number.isInteger(days) || days < 1 || days > MAX_USAGE_DAYS) {
    throw fail(400, 'INVALID_DAYS', 'days 必须为 1-90 的整数');
  }
  return days;
}

function readLedgerLimit(query) {
  const raw = query?.limit;
  if (raw === undefined || raw === null || raw === '') return DEFAULT_LEDGER_LIMIT;
  const text = String(raw).trim();
  const limit = Number(text);
  if (!/^\d+$/.test(text) || !Number.isInteger(limit) || limit < 1 || limit > MAX_LEDGER_LIMIT) {
    throw fail(400, 'INVALID_LIMIT', 'limit 必须为 1-100 的整数');
  }
  return limit;
}

function readBeforeId(query) {
  const raw = query?.before_id;
  if (raw === undefined || raw === null || raw === '') return null;
  const text = String(raw).trim();
  const beforeId = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(beforeId) || beforeId < 1) {
    throw fail(400, 'INVALID_BEFORE_ID', 'before_id 必须为正整数');
  }
  return beforeId;
}

function dayRange(days, nowMs) {
  const shifted = new Date(nowMs + SHANGHAI_OFFSET_MS);
  const todayUtcMs = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  const dates = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    dates.push(new Date(todayUtcMs - i * DAY_MS).toISOString().slice(0, 10));
  }
  return {
    startMs: todayUtcMs - (days - 1) * DAY_MS - SHANGHAI_OFFSET_MS,
    endMs: todayUtcMs + DAY_MS - SHANGHAI_OFFSET_MS,
    dates,
  };
}

function mapModelRow(row) {
  return {
    model: row.model,
    requests: toNumber(row.requests),
    tokens: toNumber(row.tokens),
    cost_micro: toNumber(row.cost_micro),
  };
}

function createConsoleHandlers({ db }) {
  async function overviewHandler(request, user) {
    const userId = user.id;
    const { startMs, endMs } = dayRange(DEFAULT_USAGE_DAYS, Date.now());

    const [walletRows] = await db.execute(
      'SELECT balance_micro, frozen_micro, total_topup_micro FROM platform_wallets WHERE user_id = ?',
      [userId],
    );
    const walletRow = walletRows[0];

    const [keyRows] = await db.execute(
      `SELECT key_prefix, created_at, revoked_at FROM platform_api_keys
       WHERE user_id = ? AND is_default = 1 AND revoked_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    const keyRow = keyRows[0];

    const [totalRows] = await db.execute(TOTALS_SQL, [userId, startMs, endMs]);
    const totals = totalRows[0];

    const [modelRows] = await db.execute(MODEL_STATS_SQL, [userId, startMs, endMs]);

    return {
      user: {
        id: user.id,
        phone: maskPhone(user.phone),
        nickname: user.nickname,
        created_at: toTimestamp(user.created_at),
      },
      wallet: {
        balance_micro: toNumber(walletRow?.balance_micro),
        frozen_micro: toNumber(walletRow?.frozen_micro),
        total_topup_micro: toNumber(walletRow?.total_topup_micro),
      },
      key: keyRow
        ? {
            key_prefix: keyRow.key_prefix,
            created_at: toNumber(keyRow.created_at),
            revoked_at: keyRow.revoked_at == null ? null : toNumber(keyRow.revoked_at),
          }
        : null,
      stats30d: {
        requests: toNumber(totals?.requests),
        tokens: toNumber(totals?.tokens),
        cost_micro: toNumber(totals?.cost_micro),
      },
      by_model: modelRows.map(mapModelRow),
    };
  }

  async function usageHandler(request, user) {
    const days = readDays(request.query);
    const { startMs, endMs, dates } = dayRange(days, Date.now());

    const [dayRows] = await db.execute(DAY_STATS_SQL, [user.id, startMs, endMs]);
    const [modelRows] = await db.execute(MODEL_STATS_SQL, [user.id, startMs, endMs]);

    const byDate = new Map();
    for (const row of dayRows) byDate.set(String(row.day), row);

    return {
      days: dates.map((date) => {
        const row = byDate.get(date);
        return {
          date,
          requests: toNumber(row?.requests),
          tokens: toNumber(row?.tokens),
          cost_micro: toNumber(row?.cost_micro),
        };
      }),
      by_model: modelRows.map(mapModelRow),
    };
  }

  async function ledgerHandler(request, user) {
    const limit = readLedgerLimit(request.query);
    const beforeId = readBeforeId(request.query);

    let sql = 'SELECT id, type, delta_micro, balance_after, note, created_at FROM platform_ledger WHERE user_id = ?';
    const params = [user.id];
    if (beforeId !== null) {
      sql += ' AND id < ?';
      params.push(beforeId);
    }
    sql += ' ORDER BY id DESC LIMIT ?';
    params.push(limit);

    const [rows] = await db.execute(sql, params);
    const items = rows.map((row) => ({
      id: toNumber(row.id),
      type: row.type,
      delta_micro: toNumber(row.delta_micro),
      balance_after: toNumber(row.balance_after),
      note: row.note == null ? null : row.note,
      created_at: toNumber(row.created_at),
    }));

    return {
      items,
      next_before_id: rows.length >= limit && items.length ? items[items.length - 1].id : null,
    };
  }

  return {
    overview: overviewHandler,
    usage: usageHandler,
    ledger: ledgerHandler,
  };
}

module.exports = { createConsoleHandlers };
