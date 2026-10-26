'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
if (!/^openelf_[a-z0-9_]*test$/.test(process.env.DB_NAME || '')) {
  throw new Error('必须指定 DB_NAME=openelf_*test');
}
process.env.JWT_SECRET = 'test-jwt-secret-0123456789abcdef';
process.env.SMS_CODE_PEPPER = 'test-sms-pepper-0123456789abcdef';
process.env.REFRESH_TOKEN_PEPPER = 'test-refresh-pepper-0123456789abcdef';

const { createPool } = require('../src/db');
const config = require('../src/config');
const { createBillingService } = require('../src/platform/billing');

let pool, billing, userId, lastRequestId;

before(async () => {
  pool = await createPool(config);
  await pool.execute('DELETE FROM platform_ledger');
  await pool.execute('DELETE FROM platform_wallets');
  await pool.execute('DELETE FROM platform_requests');
  userId = 'u_' + require('node:crypto').randomBytes(16).toString('hex');
  await pool.execute('INSERT IGNORE INTO users (id, phone, nickname, avatar_initial, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, '13900000000', 'tester', 'T', 'active', new Date().toISOString()]);
  billing = createBillingService(pool);
});
after(async () => { await pool.end(); });

test('topup 充值并写入账本', async () => {
  await billing.topup(userId, 10_000_000);
  const w = await billing.getWallet(userId);
  assert.equal(w.balance_micro, 10_000_000);
  assert.equal(w.total_topup_micro, 10_000_000);
});

test('preauth 冻结余额并返回 requestId', async () => {
  const result = await billing.preauth({
    userId, keyId: null, model: 'deepseek/deepseek-chat',
    promptTokens: 1200, maxTokens: 4096,
    price: { input_micro_per_1m: 1_000_000, output_micro_per_1m: 2_000_000 },
    markupBp: 1150,
  });
  assert.ok(result.requestId);
  assert.ok(result.frozen > 0);
  lastRequestId = result.requestId;
  const w = await billing.getWallet(userId);
  assert.equal(w.balance_micro, 10_000_000);
  assert.equal(w.frozen_micro, result.frozen);
});

test('settle 按实际 usage 扣费并释放冻结', async () => {
  const w0 = await billing.getWallet(userId);
  const result = await billing.settle({
    userId, requestId: lastRequestId, keyId: null,
    promptTokens: 1200, completionTokens: 800,
    resolvedModel: 'deepseek/deepseek-chat', latencyMs: 120,
    price: { input_micro_per_1m: 1_000_000, output_micro_per_1m: 2_000_000 },
    markupBp: 1150,
  });
  assert.ok(result.charged > 0);
  const w = await billing.getWallet(userId);
  assert.ok(w.balance_micro < w0.balance_micro);
  assert.equal(w.frozen_micro, 0);
});

test('preauth 余额不足时抛 402', async () => {
  const poorUser = 'u_' + require('node:crypto').randomBytes(16).toString('hex');
  await pool.execute('INSERT IGNORE INTO users (id, phone, nickname, avatar_initial, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [poorUser, '13900000001', 'poor', 'P', 'active', new Date().toISOString()]);
  try {
    await billing.preauth({
      userId: poorUser, keyId: null, model: 'm', promptTokens: 1000, maxTokens: 4096,
      price: { input_micro_per_1m: 1_000_000, output_micro_per_1m: 2_000_000 },
      markupBp: 1150,
    });
    assert.fail('should throw');
  } catch (e) {
    assert.equal(e.statusCode, 402);
  }
});
