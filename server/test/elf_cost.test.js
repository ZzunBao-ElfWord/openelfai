'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { memoryStore } = require('./helpers/payment_memory');
const { createCommerceService } = require('../src/commerce');

/// 纯内存 store，不连真实数据库；折算率用缺省值（2000 micro / 1K tokens，估算 1500 tokens）。
function makeService() {
  return createCommerceService({ db: null, store: memoryStore(), settings: {} });
}

/// 与 commerce 相同的日界：服务器本地自然日（YYYY-MM-DD）。
function localDay(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

test('recordElfCost 按来源幂等累加，totalMicro 汇总', async () => {
  const commerce = makeService();
  await commerce.recordElfCost('off_kimi', 'auto_post', 1000); // 1000/1000*2000 = 2000
  await commerce.recordElfCost('off_kimi', 'auto_post', 500); // 500 → 1000
  await commerce.recordElfCost('off_kimi', 'auto_comment', 2000); // 4000

  const rows = await commerce.listElfCostDaily();
  assert.equal(rows.length, 1);
  const row = rows[0];
  const day = localDay();
  assert.equal(row.id, `off_kimi:${day}`);
  assert.equal(row.day, day);
  assert.deepEqual(row.sources.auto_post, { costMicro: 3000, messages: 2 });
  assert.deepEqual(row.sources.auto_comment, { costMicro: 4000, messages: 1 });
  assert.equal(row.totalMicro, 7000);
});

test('tokens 缺失或非法时按固定估算（1500 tokens → 3000 micro）', async () => {
  const commerce = makeService();
  await commerce.recordElfCost('off_doubao', 'video_caption'); // 缺省
  await commerce.recordElfCost('off_doubao', 'video_caption', 0); // 非正数
  await commerce.recordElfCost('off_doubao', 'video_caption', Number.NaN);
  await commerce.recordElfCost('off_doubao', 'video_caption', 1.5); // 非整数

  const [row] = await commerce.listElfCostDaily();
  assert.equal(row.sources.video_caption.costMicro, 4 * 3000);
  assert.equal(row.sources.video_caption.messages, 4);
  assert.equal(row.totalMicro, 12000);
});

test('多只精灵各自一行记录；listElfCostDaily 按日过滤', async () => {
  const commerce = makeService();
  await commerce.recordElfCost('elf_a', 'auto_post', 1000);
  await commerce.recordElfCost('elf_b', 'official_chat', 3000);

  const today = await commerce.listElfCostDaily();
  assert.equal(today.length, 2);
  const byId = new Map(today.map((row) => [row.elfId, row.totalMicro]));
  assert.equal(byId.get('elf_a'), 2000);
  assert.equal(byId.get('elf_b'), 6000);

  const empty = await commerce.listElfCostDaily('1999-01-01');
  assert.deepEqual(empty, []);
});

test('elfId 为空直接忽略；计量集合与世界对话集合互不污染', async () => {
  const commerce = makeService();
  await commerce.recordElfCost('', 'auto_post', 1000);
  await commerce.recordElfCost(null, 'auto_post', 1000);
  assert.deepEqual(await commerce.listElfCostDaily(), []);

  // 世界对话口径独立：写 elf_cost_daily 不影响 world_chat_usage。
  const store = memoryStore();
  const svc = createCommerceService({ db: null, store, settings: {} });
  await svc.recordElfCost('off_kimi', 'auto_post', 1000);
  const objects = store.inspect().objects;
  const kinds = new Set([...objects.values()].map((row) => row.kind));
  assert.deepEqual([...kinds], ['elf_cost_daily']);
});
