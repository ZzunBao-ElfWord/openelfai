'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  splitContent,
  rankChunks,
  buildContextBlock,
  createKnowledgeService,
} = require('../src/knowledge');

const CHUNKS = [
  {
    id: 'c1', docId: 'd1', title: 'DeepSeek API 调用与鉴权',
    sourceUrl: 'https://example.com/deepseek', category: 'vendor_api',
    text: '使用 Bearer Token 调用 https://api.deepseek.com/v1/chat/completions，请求体包含 model 与 messages。',
  },
  {
    id: 'c2', docId: 'd2', title: '429 限流与 RPM/TPM',
    sourceUrl: 'https://example.com/429', category: 'errors',
    text: '遇到 429 表示超过速率限制，应读取 Retry-After 并退避重试；RPM 与 TPM 是两种独立配额。',
  },
  {
    id: 'c3', docId: 'd3', title: '401 密钥错误与过期',
    sourceUrl: 'https://example.com/401', category: 'errors',
    text: '401 通常是 API Key 错误、过期或被吊销；检查 Bearer 头与密钥状态。',
  },
  {
    id: 'c4', docId: 'd4', title: '生图提示词写法',
    sourceUrl: '', category: 'visual',
    text: '画面描述、镜头、光线与色彩。',
  },
];

test('检索按关键词命中排序，无关片段不返回', () => {
  const hits = rankChunks(CHUNKS, 'deepseek 429 怎么处理', { topK: 3 });
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].id, 'c2');
  assert.ok(!hits.some((hit) => hit.id === 'c4'));
});

test('上下文块包含来源标题与链接', () => {
  const hits = rankChunks(CHUNKS, '401 key 过期', { topK: 2 });
  const block = buildContextBlock(hits);
  assert.match(block, /【知识库资料】/);
  assert.match(block, /401 密钥错误与过期/);
  assert.match(block, /https:\/\/example\.com\/401/);
});

test('长文档按段落切片并限制单片长度', () => {
  const content = [
    '第一段'.repeat(80),
    '第二段'.repeat(80),
    '第三段'.repeat(80),
  ].join('\n\n');
  const chunks = splitContent(content, 200);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.length <= 200, `片段超长：${chunk.length}`);
});

test('知识库开关默认关闭，只有显式开启的 AI 才命中', async () => {
  const rows = [{ elf_id: 'elf_api_expert', enabled: 1 }];
  const db = {
    async execute(sql, params) {
      if (sql.includes('elf_knowledge_config')) {
        return [rows.filter((row) => row.elf_id === params[1] && row.enabled === 1), []];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const service = createKnowledgeService({ db });
  assert.equal(await service.isEnabled('elf_api_expert'), true);
  assert.equal(await service.isEnabled('elf_other'), false);
  assert.equal(await service.isEnabled(''), false);
});

/// 最小内存库：只实现知识库入库与检索用到的四类 SQL。
function createMemoryDb() {
  const docs = new Map();
  const chunks = new Map();
  return {
    docs,
    chunks,
    async execute(sql, params) {
      if (sql.includes('INSERT INTO knowledge_docs')) {
        const [id, category, vendor, title, sourceUrl, content, , updatedAt] = params;
        docs.set(id, { id, category, vendor, title, sourceUrl, content, status: 'active', updated_at: updatedAt });
        return [{ affectedRows: 1 }, []];
      }
      if (sql.includes('DELETE FROM knowledge_chunks')) {
        for (const [key, chunk] of chunks) {
          if (chunk.doc_id === params[0]) chunks.delete(key);
        }
        return [{ affectedRows: 1 }, []];
      }
      if (sql.includes('INSERT INTO knowledge_chunks')) {
        const [id, docId, seq, title, sourceUrl, category, text] = params;
        chunks.set(id, { id, doc_id: docId, seq, title, source_url: sourceUrl, category, text });
        return [{ affectedRows: 1 }, []];
      }
      if (sql.includes('JOIN knowledge_docs')) {
        const rows = [...chunks.values()]
          .filter((chunk) => docs.get(chunk.doc_id)?.status === 'active')
          .sort((a, b) => a.doc_id.localeCompare(b.doc_id) || a.seq - b.seq);
        return [rows, []];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

test('入库后可按问题检索，重复入库会覆盖旧切片', async () => {
  const db = createMemoryDb();
  const service = createKnowledgeService({ db });

  const first = await service.ingest({
    id: 'doc_errors',
    category: 'errors',
    title: '429 限流处理',
    sourceUrl: 'https://example.com/429',
    content: '遇到 429 应退避重试，并检查 RPM 与 TPM 配额。',
  });
  assert.equal(first.chunks, 1);
  assert.equal(db.chunks.size, 1);

  const hits = await service.retrieve('429 限流怎么办');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].docId, 'doc_errors');
  assert.match(hits[0].text, /退避重试/);

  await service.ingest({
    id: 'doc_errors',
    category: 'errors',
    title: '429 限流处理',
    content: '新的处理方式：读取 Retry-After 后再重试。',
  });
  assert.equal(db.chunks.size, 1);
  const after = await service.retrieve('429 重试');
  assert.match(after[0].text, /Retry-After/);
});
