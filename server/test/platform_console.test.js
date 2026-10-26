'use strict';
// 全部使用内存 fake db，不连接 MySQL。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createConsoleHandlers } = require('../src/platform/console');

const USER = {
  id: 'u_1',
  phone: '13812340000',
  nickname: '测试用户',
  created_at: '2026-10-01T00:00:00.000Z',
};

function makeDb(seed = {}) {
  const state = {
    walletRows: seed.walletRows || [],
    keyRows: seed.keyRows || [],
    statRows: seed.statRows || [{ requests: 0, tokens: 0, cost_micro: 0 }],
    dayRows: seed.dayRows || [],
    modelRows: seed.modelRows || [],
    ledgerRows: seed.ledgerRows || [],
    calls: [],
  };

  async function execute(sql, params = []) {
    const normalized = String(sql).replace(/\s+/g, ' ').trim();
    state.calls.push({ sql: normalized, params });

    if (normalized.includes('FROM platform_wallets')) return [state.walletRows, []];
    if (normalized.includes('FROM platform_api_keys')) return [state.keyRows, []];
    if (normalized.includes('FROM platform_ledger')) return [state.ledgerRows, []];
    if (normalized.includes('FROM platform_requests')) {
      if (normalized.includes('GROUP BY resolved_model')) return [state.modelRows, []];
      if (normalized.includes('GROUP BY day')) return [state.dayRows, []];
      return [state.statRows, []];
    }

    throw new Error('Unexpected SQL in console test: ' + normalized);
  }

  return { calls: state.calls, execute };
}

// 与 handler 一致：按 UTC+8 生成连续日期。
function shanghaiDates(days) {
  const shifted = new Date(Date.now() + 8 * 3_600_000);
  const todayUtcMs = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  const dates = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    dates.push(new Date(todayUtcMs - i * 86_400_000).toISOString().slice(0, 10));
  }
  return dates;
}

test('overview 返回脱敏手机号、钱包、默认 Key 与近 30 天统计', async () => {
  const db = makeDb({
    walletRows: [{ balance_micro: '1500000', frozen_micro: '0', total_topup_micro: '2000000' }],
    keyRows: [{
      key_prefix: 'oe-sk-abcdef',
      created_at: '1700000000000',
      revoked_at: null,
      key_hash: 'should-not-leak-hash',
      key_cipher: 'should-not-leak-cipher',
    }],
    statRows: [{ requests: '12', tokens: '3456', cost_micro: '7890' }],
    modelRows: [
      { model: 'deepseek/deepseek-chat', requests: '10', tokens: '3000', cost_micro: '6000' },
      { model: 'openai/gpt-4o-mini', requests: '2', tokens: '456', cost_micro: '1890' },
    ],
  });

  const result = await createConsoleHandlers({ db }).overview({}, USER);

  assert.equal(result.user.id, 'u_1');
  assert.equal(result.user.phone, '138****0000');
  assert.equal(result.user.nickname, '测试用户');
  assert.equal(typeof result.user.created_at, 'number');
  assert.equal(result.user.created_at, Date.parse(USER.created_at));

  assert.deepEqual(result.wallet, {
    balance_micro: 1500000,
    frozen_micro: 0,
    total_topup_micro: 2000000,
  });
  assert.deepEqual(result.key, {
    key_prefix: 'oe-sk-abcdef',
    created_at: 1700000000000,
    revoked_at: null,
  });
  assert.deepEqual(result.stats30d, { requests: 12, tokens: 3456, cost_micro: 7890 });
  assert.deepEqual(result.by_model[0], {
    model: 'deepseek/deepseek-chat',
    requests: 10,
    tokens: 3000,
    cost_micro: 6000,
  });

  // 敏感字段既不返回也不出现在查询列中。
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes('key_hash'));
  assert.ok(!serialized.includes('key_cipher'));
  assert.ok(!serialized.includes('should-not-leak'));
  const keyCall = db.calls.find((call) => call.sql.includes('FROM platform_api_keys'));
  assert.ok(!/\bkey_hash\b|\bkey_cipher\b/.test(keyCall.sql));

  const requestCall = db.calls.find((call) => call.sql.includes('FROM platform_requests'));
  assert.match(requestCall.sql, /status = 'ok'/);
});

test('overview 无钱包时回零、无默认 Key 时 key 为 null、短手机号全部掩码', async () => {
  const handlers = createConsoleHandlers({ db: makeDb() });

  const shortPhone = await handlers.overview({}, { id: 'u_2', phone: '1234567', nickname: 'n', created_at: 0 });
  assert.equal(shortPhone.user.phone, '****');
  assert.deepEqual(shortPhone.wallet, {
    balance_micro: 0,
    frozen_micro: 0,
    total_topup_micro: 0,
  });
  assert.equal(shortPhone.key, null);
  assert.deepEqual(shortPhone.stats30d, { requests: 0, tokens: 0, cost_micro: 0 });
  assert.deepEqual(shortPhone.by_model, []);

  const eightDigits = await handlers.overview({}, { id: 'u_3', phone: '12345678', nickname: 'n', created_at: 0 });
  assert.equal(eightDigits.user.phone, '123****5678');
});

test('usage days 非法值返回 400', async () => {
  const handlers = createConsoleHandlers({ db: makeDb() });

  for (const days of ['0', '91', 'abc', '1.5', '-1']) {
    await assert.rejects(handlers.usage({ query: { days } }, USER), (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, 'INVALID_DAYS');
      assert.equal(error.message, 'days 必须为 1-90 的整数');
      return true;
    });
  }
});

test('usage 按 UTC+8 自然日聚合、无数据补零且日期连续', async () => {
  const dates = shanghaiDates(3);
  const db = makeDb({
    dayRows: [
      { day: dates[0], requests: '2', tokens: '30', cost_micro: '15' },
      { day: dates[2], requests: '1', tokens: '7', cost_micro: '9' },
    ],
    modelRows: [
      { model: 'm-a', requests: '2', tokens: '20', cost_micro: '13' },
      { model: 'm-b', requests: '1', tokens: '17', cost_micro: '11' },
    ],
  });

  const result = await createConsoleHandlers({ db }).usage({ query: { days: '3' } }, USER);

  assert.deepEqual(result.days, [
    { date: dates[0], requests: 2, tokens: 30, cost_micro: 15 },
    { date: dates[1], requests: 0, tokens: 0, cost_micro: 0 },
    { date: dates[2], requests: 1, tokens: 7, cost_micro: 9 },
  ]);

  const dayCall = db.calls.find((call) => call.sql.includes('GROUP BY day'));
  assert.match(dayCall.sql, /FROM_UNIXTIME\(created_at \/ 1000 \+ 28800\)/);
  assert.match(dayCall.sql, /status = 'ok'/);
});

test('by_model 按消耗降序返回并汇总 tokens', async () => {
  const db = makeDb({
    modelRows: [
      { model: 'expensive', requests: '3', tokens: '120', cost_micro: '900' },
      { model: 'cheap', requests: '4', tokens: '450', cost_micro: '100' },
    ],
  });

  const result = await createConsoleHandlers({ db }).usage({ query: { days: '7' } }, USER);

  assert.deepEqual(result.by_model.map((item) => item.model), ['expensive', 'cheap']);
  assert.deepEqual(result.by_model.map((item) => item.tokens), [120, 450]);
  assert.deepEqual(result.by_model[0], {
    model: 'expensive',
    requests: 3,
    tokens: 120,
    cost_micro: 900,
  });

  const modelCall = db.calls.find((call) => call.sql.includes('GROUP BY resolved_model'));
  assert.match(modelCall.sql, /ORDER BY cost_micro DESC/);
});

test('ledger 校验 limit、按 before_id 过滤并返回 next_before_id', async () => {
  const db = makeDb({
    ledgerRows: [
      {
        id: '12', type: 'charge', delta_micro: '-17', balance_after: '999983',
        note: null, created_at: '1700000000000', key_id: 'key_1', request_id: 'req_1',
      },
      {
        id: '11', type: 'topup', delta_micro: '1000000', balance_after: '1000000',
        note: null, created_at: '1699999999999', key_id: null, request_id: null,
      },
    ],
  });

  const page = await createConsoleHandlers({ db }).ledger({ query: { limit: '2', before_id: '20' } }, USER);

  assert.deepEqual(page.items, [
    { id: 12, type: 'charge', delta_micro: -17, balance_after: 999983, note: null, created_at: 1700000000000 },
    { id: 11, type: 'topup', delta_micro: 1000000, balance_after: 1000000, note: null, created_at: 1699999999999 },
  ]);
  assert.equal(page.next_before_id, 11);

  const ledgerCall = db.calls.find((call) => call.sql.includes('FROM platform_ledger'));
  assert.match(ledgerCall.sql, /AND id < \?/);
  assert.match(ledgerCall.sql, /ORDER BY id DESC LIMIT \?/);
  assert.deepEqual(ledgerCall.params, ['u_1', 20, 2]);
  assert.ok(!/\bkey_id\b|\brequest_id\b/.test(ledgerCall.sql));
});

test('ledger 本页不足 limit 时 next_before_id 为 null，limit 非法返回 400', async () => {
  const db = makeDb({
    ledgerRows: [{
      id: '5', type: 'charge', delta_micro: '-1', balance_after: '9', note: 'x', created_at: '1',
    }],
  });
  const handlers = createConsoleHandlers({ db });

  const page = await handlers.ledger({ query: {} }, USER);
  assert.equal(page.items.length, 1);
  assert.equal(page.next_before_id, null);
  assert.deepEqual(db.calls[0].params, ['u_1', 50]);

  for (const limit of ['0', '101', 'abc']) {
    await assert.rejects(handlers.ledger({ query: { limit } }, USER), (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, 'INVALID_LIMIT');
      return true;
    });
  }
});
