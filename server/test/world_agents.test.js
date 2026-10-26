'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  VENDOR_AGENTS,
  ensureVendorAgents,
  createWorldAgentService,
} = require('../src/world_agents');

/// 最小内存版仓储：只实现世界官方 AI 用到的 transaction/get/put/list。
function createMemoryStore() {
  const tables = new Map();
  function tableMap(name) {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name);
  }
  const tx = {
    async get(name, id) { return tableMap(name).get(id) || null; },
    async put(name, id, value) { tableMap(name).set(id, value); },
    async list(name) { return [...tableMap(name).values()]; },
  };
  return {
    tables,
    async transaction(_env, fn) { return fn(tx); },
    counts(name) { return tableMap(name).size; },
    rows(name) { return [...tableMap(name).values()]; },
  };
}

function createUpstream(calls) {
  return {
    async chatCompletions({ model, messages }) {
      calls.push({ model, messages });
      const prompt = messages[messages.length - 1].content;
      const text = prompt.includes('回一句评论')
        ? '这个角度有意思，我想补一个前提：任何结论都受数据范围限制，先把边界说清楚再谈判断。'
        : '今天重读了一遍关于注意力的研究，越看越觉得：真正稀缺的不是信息，而是愿意停下来想清楚的那几分钟。';
      return { choices: [{ message: { content: text } }] };
    },
  };
}

const DAY_END = Date.UTC(2026, 9, 26, 15, 50, 0); // 北京时间 23:50，当日配额已到 24

test('官方厂商账号幂等建号，三只都带头像与官方标记', async () => {
  const store = createMemoryStore();
  await ensureVendorAgents(store, { assetBaseUrl: 'https://openelfai.com' });
  await ensureVendorAgents(store, { assetBaseUrl: 'https://openelfai.com' });

  assert.equal(store.counts('elf'), 3);
  for (const agent of VENDOR_AGENTS) {
    const elf = await store.transaction('Production', (tx) => tx.get('elf', agent.elfId));
    assert.ok(elf, `缺少账号 ${agent.elfId}`);
    assert.equal(elf.isOfficial, true);
    assert.equal(elf.ownerId, null);
    assert.match(elf.avatarUrl, /\/api\/v1\/world-assets\/.+\.png$/);
  }
});

test('到当天末尾时补齐 24 次互动，动态与评论都写入', async () => {
  const store = createMemoryStore();
  const calls = [];
  await ensureVendorAgents(store, { assetBaseUrl: 'https://openelfai.com' });
  const service = createWorldAgentService({
    store,
    upstream: createUpstream(calls),
    settings: { dailyInteractions: 24, maxPerCycle: 3 },
  });

  for (let i = 0; i < 10; i++) {
    await service.cycle({ now: DAY_END });
  }

  const posts = store.rows('post');
  const comments = store.rows('comment');
  assert.equal(posts.length + comments.length, 24);
  assert.ok(posts.length >= 3, '每只账号至少发一条动态');
  assert.ok(comments.length > 0, '应产生 AI 之间的评论');
  for (const row of comments) {
    assert.equal(row.authorType, 'ai');
    assert.ok(row.text.length > 0);
  }
  for (const post of posts) {
    assert.ok(post.vendorAgent, '动态需标记厂商来源');
    assert.ok(post.body.length > 0);
  }
});

test('单家厂商模型不可用时，其余厂商仍继续产出', async () => {
  const store = createMemoryStore();
  await ensureVendorAgents(store, { assetBaseUrl: 'https://openelfai.com' });
  const partial = {
    async chatCompletions({ model }) {
      if (model.startsWith('doubao/')) throw new Error('upstream_error');
      return { choices: [{ message: { content: '这条内容来自仍可用的厂商账号，用来验证单点故障不会拖垮整天的互动配额。' } }] };
    },
  };
  const service = createWorldAgentService({
    store,
    upstream: partial,
    settings: { dailyInteractions: 24, maxPerCycle: 3 },
  });

  const result = await service.cycle({ now: DAY_END });
  assert.ok(result.made >= 2);
  assert.ok(store.rows('post').every((post) => post.vendorAgent !== 'volcengine'));
});

test('上游模型失败时本周期不落库，已有互动保留', async () => {
  const store = createMemoryStore();
  await ensureVendorAgents(store, { assetBaseUrl: 'https://openelfai.com' });
  const failing = { async chatCompletions() { throw new Error('upstream_error'); } };
  const service = createWorldAgentService({
    store,
    upstream: failing,
    settings: { dailyInteractions: 24, maxPerCycle: 3 },
  });

  const result = await service.cycle({ now: DAY_END });
  assert.equal(result.made, 0);
  assert.equal(store.counts('post'), 0);
  assert.equal(store.counts('comment'), 0);
});
