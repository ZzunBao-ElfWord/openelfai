'use strict';
// 全部使用内存 fake db，不连接 MySQL。
const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
for (const name of ['DB_PASSWORD', 'JWT_SECRET', 'SMS_CODE_PEPPER', 'REFRESH_TOKEN_PEPPER']) {
  process.env[name] = 'isolated-test-secret-not-for-deployment';
}

const buildApp = require('../src/app');
const config = require('../src/config');
const { signAccessToken } = require('../src/security');
const { memoryStore } = require('./helpers/payment_memory');

const USER = { id: 'u_wallet_test', nickname: '测试用户', status: 'active' };
const TOKEN = signAccessToken({
  secret: config.jwtSecret,
  userId: USER.id,
  sessionId: 'wallet-session',
  ttlSec: 900,
});

function makeDb({ walletRows = [] } = {}) {
  const calls = [];

  return {
    calls,
    async execute(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      calls.push({ sql: normalized, params });

      // 钱包接口不应读写任何 API Key 表，这里直接抛错以便断言未被触发。
      if (normalized.includes('api_keys')) {
        throw new Error('wallet handler 不应访问 API Key 表: ' + normalized);
      }
      if (normalized === 'SELECT * FROM refresh_sessions WHERE id = ?') {
        return [[{
          id: 'wallet-session',
          user_id: USER.id,
          expires_at: Date.now() + 60_000,
          revoked_at: null,
        }], []];
      }
      if (normalized === 'SELECT * FROM users WHERE id = ?') return [[USER], []];
      if (normalized.includes('FROM platform_wallets')) return [walletRows, []];

      throw new Error('Unexpected SQL in wallet test: ' + normalized);
    },
  };
}

async function setup(options = {}) {
  const db = makeDb(options);
  const app = await buildApp({
    db,
    paymentStore: memoryStore(),
    sms: {},
    captcha: {},
    logger: false,
  });
  return { app, db };
}

function getWallet(app, token = TOKEN) {
  return app.inject({
    method: 'GET',
    url: '/api/v1/platform/wallet',
    headers: { authorization: `Bearer ${token}` },
  });
}

function assertAllNumbers(wallet) {
  for (const value of Object.values(wallet)) {
    assert.equal(typeof value, 'number');
  }
}

test('有钱包记录时返回三个余额字段且均为数字', async () => {
  const { app, db } = await setup({
    walletRows: [{ balance_micro: '1500000', frozen_micro: '1000', total_topup_micro: '2000000' }],
  });

  try {
    const response = await getWallet(app);
    assert.equal(response.statusCode, 200);

    const wallet = response.json();
    assert.deepEqual(wallet, {
      balance_micro: 1500000,
      frozen_micro: 1000,
      total_topup_micro: 2000000,
    });
    assertAllNumbers(wallet);

    const walletCall = db.calls.find((call) => call.sql.includes('FROM platform_wallets'));
    assert.ok(walletCall);
    assert.deepEqual(walletCall.params, [USER.id]);
  } finally {
    await app.close();
  }
});

test('无钱包记录时三项均为 0 且均为数字', async () => {
  const { app } = await setup();

  try {
    const response = await getWallet(app);
    assert.equal(response.statusCode, 200);

    const wallet = response.json();
    assert.deepEqual(wallet, {
      balance_micro: 0,
      frozen_micro: 0,
      total_topup_micro: 0,
    });
    assertAllNumbers(wallet);
  } finally {
    await app.close();
  }
});

test('钱包接口不读不建 platform_api_keys，且不返回任何密钥字段', async () => {
  // makeDb 对含 api_keys 的 SQL 直接抛错：一旦路由有副作用就会返回 500。
  const { app, db } = await setup({
    walletRows: [{ balance_micro: '42', frozen_micro: '0', total_topup_micro: '42' }],
  });

  try {
    const response = await getWallet(app);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      balance_micro: 42,
      frozen_micro: 0,
      total_topup_micro: 42,
    });

    assert.equal(db.calls.some((call) => /api_keys/i.test(call.sql)), false);

    const serialized = JSON.stringify(response.json());
    assert.ok(!/api[_-]?key|key_prefix|key_hash|key_cipher/i.test(serialized));
  } finally {
    await app.close();
  }
});
