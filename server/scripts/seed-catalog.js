'use strict';
// 用法: node scripts/seed-catalog.js
const { createPool } = require('../src/db');
const config = require('../src/config');

const SEED_MODELS = [
  { model_id: 'deepseek/deepseek-chat', vendor: 'deepseek', display_name: 'DeepSeek Chat', region: 'domestic',
    capabilities: 'chat,tools,json', context_tokens: 65536, input: 1_000_000, output: 2_000_000, markup_bp: 1150 },
  { model_id: 'doubao/llama-3-70b', vendor: 'volcengine', display_name: '豆包', region: 'domestic',
    capabilities: 'chat,tools', context_tokens: 32768, input: 800_000, output: 2_000_000, markup_bp: 1150 },
  { model_id: 'qwen/qwen-turbo', vendor: 'aliyun', display_name: '通义千问 Turbo', region: 'domestic',
    capabilities: 'chat,tools,json', context_tokens: 32768, input: 800_000, output: 2_000_000, markup_bp: 1150 },
];

(async () => {
  const pool = await createPool(config);
  const now = Date.now();
  for (const m of SEED_MODELS) {
    await pool.execute(
      `INSERT IGNORE INTO platform_model_catalog (model_id, vendor, display_name, region, capabilities, context_tokens, status)
       VALUES (?, ?, ?, ?, ?, ?, 'active')`,
      [m.model_id, m.vendor, m.display_name, m.region, m.capabilities, m.context_tokens]
    );
    await pool.execute(
      `INSERT IGNORE INTO platform_model_price (model_id, input_micro_per_1m, output_micro_per_1m, markup_bp, effective_from)
       VALUES (?, ?, ?, ?, ?)`,
      [m.model_id, m.input, m.output, m.markup_bp, now]
    );
  }
  console.log('seeded', SEED_MODELS.length, 'models');
  await pool.end();
})();
