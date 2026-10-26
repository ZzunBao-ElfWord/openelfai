'use strict';
// 临时脚本：创建测试开发者 + API Key + 充值，用于端到端验证
const { createPool } = require('../src/db');
const config = require('../src/config');
const { generateKey, hashKey } = require('../src/platform/api_key');

(async () => {
  const pool = await createPool(config);
  const crypto = require('node:crypto');
  const userId = 'u_platform_test_' + crypto.randomBytes(8).toString('hex');
  const phone = '139' + crypto.randomBytes(5).toString('hex').slice(0, 8);

  // 创建用户
  await pool.execute(
    'INSERT IGNORE INTO users (id, phone, nickname, avatar_initial, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, phone, 'platform-test', 'P', 'active', new Date().toISOString()]
  );

  // 创建开发者档案
  await pool.execute(
    'INSERT IGNORE INTO platform_developers (user_id, real_name, purpose, status, tier, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, 'Test Dev', 'e2e test', 'approved', 'standard', Date.now()]
  );

  // 生成 API Key
  const { id: keyId, plain, prefix } = generateKey();
  const keyHash = hashKey(plain);
  await pool.execute(
    `INSERT INTO platform_api_keys (id, user_id, name, key_prefix, key_hash, qps_limit, created_at)
     VALUES (?, ?, ?, ?, ?, 5, ?)`,
    [keyId, userId, 'test-key', prefix, keyHash, Date.now()]
  );

  // 充值 1 元 = 1,000,000 微元
  await pool.execute(
    'INSERT INTO platform_wallets (user_id, balance_micro, frozen_micro, total_topup_micro, updated_at) VALUES (?, ?, 0, ?, ?) ON DUPLICATE KEY UPDATE balance_micro = balance_micro + ?, total_topup_micro = total_topup_micro + ?, updated_at = ?',
    [userId, 1_000_000, 1_000_000, Date.now(), 1_000_000, 1_000_000, Date.now()]
  );

  console.log('=== E2E 测试数据已创建 ===');
  console.log('userId:', userId);
  console.log('API Key:', plain);
  console.log('余额: 1.00 元 (1,000,000 微元)');
  console.log('测试命令:');
  console.log(`curl -X POST http://127.0.0.1:8787/v1/chat/completions -H "Authorization: Bearer ${plain}" -H "Content-Type: application/json" -d '{"model":"deepseek/deepseek-chat","messages":[{"role":"user","content":"hi"}]}'`);

  await pool.end();
})();
