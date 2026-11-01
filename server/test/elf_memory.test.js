'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  createElfMemory,
  rankFacts,
  buildMemoryBlock,
  normalizeFact,
} = require('../src/elf_memory');

/// 最小内存库：只实现精灵记忆用到的五类 SQL。
function createMemoryDb() {
  const facts = new Map();
  const quota = new Map();
  return {
    facts,
    quota,
    async execute(sql, params) {
      if (sql.includes('FROM elf_memory_quota')) {
        const row = quota.get(params[0]);
        return [row ? [row] : [], []];
      }
      if (sql.includes('INSERT INTO elf_memory_quota')) {
        const [id, elfId, , updatedAt] = params;
        const row = quota.get(id) || { id, elf_id: elfId, calls: 0 };
        row.calls += 1;
        row.updated_at = updatedAt;
        quota.set(id, row);
        return [{ affectedRows: 1 }, []];
      }
      if (sql.includes('FROM elf_memory') && sql.includes('WHERE elf_id')) {
        const [elfId, userId] = params;
        const rows = [...facts.values()]
          .filter((row) => row.elf_id === elfId && row.user_id === userId)
          .sort((a, b) => b.updated_at - a.updated_at || a.id.localeCompare(b.id));
        return [rows, []];
      }
      if (sql.includes('INSERT INTO elf_memory ')) {
        const [id, elfId, userId, fact, , createdAt, updatedAt] = params;
        facts.set(id, { id, elf_id: elfId, user_id: userId, fact, confidence: 1, created_at: createdAt, updated_at: updatedAt });
        return [{ affectedRows: 1 }, []];
      }
      if (sql.includes('UPDATE elf_memory SET confidence')) {
        const [updatedAt, id] = params;
        const row = facts.get(id);
        if (row) {
          row.confidence += 1;
          row.updated_at = updatedAt;
        }
        return [{ affectedRows: row ? 1 : 0 }, []];
      }
      if (sql.includes('DELETE FROM elf_memory')) {
        const removed = facts.delete(params[0]);
        return [{ affectedRows: removed ? 1 : 0 }, []];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

function createUpstreamStub(content, usage = { total_tokens: 120 }) {
  const calls = [];
  return {
    calls,
    async chatCompletions(payload) {
      calls.push(payload);
      return { choices: [{ message: { content } }], usage };
    },
  };
}

function seedFact(db, { id, elfId = 'elf_1', userId = 'u_1', fact, updatedAt }) {
  db.facts.set(id, {
    id, elf_id: elfId, user_id: userId, fact,
    confidence: 1, created_at: updatedAt, updated_at: updatedAt,
  });
}

test('关键词召回按命中排序，字符预算内取 Top-N', () => {
  const facts = [
    { id: 'a', fact: '用户喜欢喝美式咖啡', updatedAt: 1 },
    { id: 'b', fact: '用户住在北京', updatedAt: 2 },
    { id: 'c', fact: '用户计划明年去日本旅行', updatedAt: 3 },
  ];
  const hits = rankFacts(facts, '咖啡推荐', { topN: 5, maxChars: 600 });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, 'a');

  const budgeted = rankFacts(facts, '', { topN: 5, maxChars: 12 });
  assert.equal(budgeted.length, 1);
  assert.equal(budgeted[0].id, 'c'); // 空查询退化为最近更新
});

test('记忆块格式包含引导语与事实列表', () => {
  assert.equal(buildMemoryBlock([]), '');
  const block = buildMemoryBlock([{ fact: '用户喜欢美式咖啡' }]);
  assert.match(block, /【用户记忆】/);
  assert.match(block, /1\. 用户喜欢美式咖啡/);
});

test('recall 在关闭或缺参时返回空', async () => {
  const db = createMemoryDb();
  seedFact(db, { id: 'a', fact: '用户喜欢美式咖啡', updatedAt: 1 });
  const off = createElfMemory({ db, enabled: false });
  assert.deepEqual(await off.recall('elf_1', 'u_1', '咖啡'), []);
  const on = createElfMemory({ db });
  assert.deepEqual(await on.recall('', 'u_1', '咖啡'), []);
  assert.equal((await on.recall('elf_1', 'u_1', '咖啡'))[0].fact, '用户喜欢美式咖啡');
});

test('抽取解析容忍代码块包裹，过滤过短与非字符串项', async () => {
  const db = createMemoryDb();
  const upstream = createUpstreamStub('```json\n["用户喜欢美式咖啡", "  ", 42, "用户住在北京"]\n```');
  const memory = createElfMemory({ db, upstream });
  const result = await memory.extractAndStore({
    elfId: 'elf_1', userId: 'u_1', text: '我一般早上喝美式咖啡', reply: '好的，记住了',
  });
  assert.equal(result.extracted, 2);
  assert.equal(result.stored, 2);
  assert.equal(db.facts.size, 2);
});

test('重复事实只提高置信度，不重复落库', async () => {
  const db = createMemoryDb();
  seedFact(db, { id: 'a', fact: '用户喜欢美式咖啡。', updatedAt: 1 });
  const upstream = createUpstreamStub('["用户喜欢美式咖啡"]');
  const memory = createElfMemory({ db, upstream });
  const result = await memory.extractAndStore({
    elfId: 'elf_1', userId: 'u_1', text: '我还是喜欢美式咖啡', reply: '好的',
  });
  assert.equal(result.stored, 0);
  assert.equal(result.updated, 1);
  assert.equal(db.facts.size, 1);
  assert.equal(db.facts.get('a').confidence, 2);
  assert.equal(normalizeFact('用户喜欢美式咖啡。'), normalizeFact('用户喜欢美式咖啡'));
});

test('超出单精灵日配额后跳过抽取，不再调用上游', async () => {
  const db = createMemoryDb();
  const upstream = createUpstreamStub('["用户喜欢美式咖啡"]');
  const memory = createElfMemory({ db, upstream, dailyExtractPerElf: 2 });
  const turn = { elfId: 'elf_1', userId: 'u_1', text: '我喜欢美式咖啡', reply: '好的' };
  await memory.extractAndStore(turn);
  await memory.extractAndStore(turn);
  const third = await memory.extractAndStore(turn);
  assert.equal(third.skipped, true);
  assert.equal(third.reason, 'quota');
  assert.equal(upstream.calls.length, 2);
});

test('超出单对容量上限时淘汰最旧记忆', async () => {
  const db = createMemoryDb();
  seedFact(db, { id: 'old', fact: '最旧的记忆事实', updatedAt: 1 });
  seedFact(db, { id: 'new', fact: '较新的记忆事实', updatedAt: 2 });
  const upstream = createUpstreamStub('["用户刚提到的新事实"]');
  const memory = createElfMemory({ db, upstream, maxFactsPerPair: 2 });
  const result = await memory.extractAndStore({
    elfId: 'elf_1', userId: 'u_1', text: '再记一件新的事情吧', reply: '好的',
  });
  assert.equal(result.stored, 1);
  assert.equal(db.facts.size, 2);
  assert.equal(db.facts.has('old'), false);
  assert.equal(db.facts.has('new'), true);
});

test('上游返回非 JSON 时不落库、不抛错', async () => {
  const db = createMemoryDb();
  const upstream = createUpstreamStub('抱歉，我无法抽取。');
  const memory = createElfMemory({ db, upstream });
  const result = await memory.extractAndStore({
    elfId: 'elf_1', userId: 'u_1', text: '随便聊一句话好了', reply: '嗯嗯',
  });
  assert.equal(result.extracted, 0);
  assert.equal(db.facts.size, 0);
});

test('过短输入跳过抽取，且抽取成功会记录平台成本', async () => {
  const db = createMemoryDb();
  const upstream = createUpstreamStub('[]');
  const costs = [];
  const memory = createElfMemory({
    db, upstream,
    recordCost: async (elfId, tokens) => costs.push({ elfId, tokens }),
  });
  const skipped = await memory.extractAndStore({ elfId: 'elf_1', userId: 'u_1', text: '嗯', reply: '你好呀' });
  assert.equal(skipped.skipped, true);
  assert.equal(upstream.calls.length, 0);

  await memory.extractAndStore({ elfId: 'elf_1', userId: 'u_1', text: '足够长的一句话输入', reply: '好的' });
  assert.deepEqual(costs, [{ elfId: 'elf_1', tokens: 120 }]);
  assert.equal(upstream.calls[0].model, 'deepseek/deepseek-chat');
  assert.equal(upstream.calls[0].trace.name, 'elf-memory-extract');
});
