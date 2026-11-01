'use strict';

/// 精灵记忆：从对话中抽取关于用户的稳定事实，按「精灵 + 用户」成对存储，
/// 对话时按相关度召回 Top-N 注入 system prompt。
/// 起步不引向量库，复用 knowledge.js 的关键词召回思路；抽取走 LiteLLM 廉价模型，
/// 平台买单，用「单精灵日抽取配额 + 单对记忆容量上限」两道闸控成本。
const crypto = require('node:crypto');
const { tokenizeQuery } = require('./knowledge');

const ELF_MEMORY_TABLES = [
  `CREATE TABLE IF NOT EXISTS elf_memory (
    id VARCHAR(48) PRIMARY KEY,
    elf_id VARCHAR(160) NOT NULL,
    user_id VARCHAR(40) NOT NULL,
    fact VARCHAR(300) NOT NULL,
    source VARCHAR(16) NOT NULL DEFAULT 'chat',
    confidence INT NOT NULL DEFAULT 1,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    INDEX idx_memory_pair (elf_id, user_id, updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // 抽取调用的日配额计数：key = elfId:yyyymmdd（服务器本地自然日）。
  `CREATE TABLE IF NOT EXISTS elf_memory_quota (
    id VARCHAR(200) PRIMARY KEY,
    elf_id VARCHAR(160) NOT NULL,
    calls INT NOT NULL DEFAULT 0,
    updated_at BIGINT NOT NULL,
    INDEX idx_memory_quota_elf (elf_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

const FACT_SCAN_LIMIT = 200;
const EXTRACT_MAX_FACTS = 3;
const EXTRACT_EXISTING_LIMIT = 20;
const EXTRACT_INPUT_CHARS = 500;

function envInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function dayKey() {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}${mm}${dd}`;
}

/// 归一化用于去重比较：忽略大小写、空白与常见标点。
function normalizeFact(fact) {
  return String(fact || '').toLowerCase().replace(/[\s，。,.!！?？、；;：:"'“”‘’（）()]/g, '');
}

function countOccurrences(haystack, needle) {
  let count = 0;
  let index = 0;
  while (count < 5) {
    const at = haystack.indexOf(needle, index);
    if (at < 0) break;
    count++;
    index = at + needle.length;
  }
  return count;
}

/// 关键词打分召回；查询没有有效关键词时退化为最近更新的 Top-N，
/// 保证长期用户即使问短句也能带上基本记忆。
function rankFacts(facts, query, { topN = 5, maxChars = 600 } = {}) {
  const tokens = tokenizeQuery(query);
  let scored;
  if (tokens.length) {
    scored = [];
    for (const fact of facts || []) {
      const body = String(fact.fact || '').toLowerCase();
      let score = 0;
      for (const token of tokens) score += countOccurrences(body, token);
      if (score > 0) scored.push({ ...fact, score });
    }
    scored.sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt);
  } else {
    scored = [...(facts || [])].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  const picked = [];
  let used = 0;
  for (const item of scored) {
    const length = String(item.fact || '').length;
    if (picked.length && used + length > maxChars) continue;
    picked.push(item);
    used += length;
    if (picked.length >= topN) break;
  }
  return picked;
}

function buildMemoryBlock(facts) {
  if (!Array.isArray(facts) || !facts.length) return '';
  const lines = [
    '【用户记忆】以下是你与该用户过往对话中记住的事实，自然地在回复中体现；',
    '记忆可能过时，用户明确否定时以当前对话为准，不要生硬复述。',
  ];
  facts.forEach((item, index) => lines.push(`${index + 1}. ${item.fact}`));
  return lines.join('\n');
}

/// 从模型输出中解析事实数组：容忍代码块包裹与首尾噪声，只接受字符串数组。
function parseExtractedFacts(content) {
  const text = String(content || '').trim();
  if (!text) return [];
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch (_) {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim().slice(0, 300))
    .filter((item) => item.length >= 4)
    .slice(0, EXTRACT_MAX_FACTS);
}

const EXTRACT_SYSTEM_PROMPT = [
  '你是事实抽取器。从用户与 AI 的一轮对话中，抽取值得长期记住的、关于用户的稳定事实：',
  '偏好、身份特征、计划、约定、明确要求。',
  '规则：最多 3 条，每条不超过 60 字，用简体中文陈述句；',
  '不抽取寒暄、一次性请求、AI 自己的观点；没有值得记住的事实就输出空数组。',
  '只输出 JSON 字符串数组，不要输出任何其他内容。',
  '若候选事实与「已有记忆」语义重复，不要重复输出。',
].join('\n');

function createElfMemory({
  db,
  upstream,
  logger,
  recordCost,
  enabled = process.env.ELF_MEMORY_ENABLED !== 'false',
  model = process.env.ELF_MEMORY_MODEL || 'deepseek/deepseek-chat',
  maxFactsPerPair = envInt('ELF_MEMORY_MAX_FACTS_PER_PAIR', 50),
  recallTopN = envInt('ELF_MEMORY_RECALL_TOP_N', 5),
  recallMaxChars = envInt('ELF_MEMORY_RECALL_MAX_CHARS', 600),
  dailyExtractPerElf = envInt('ELF_MEMORY_DAILY_EXTRACT_PER_ELF', 100),
  extractMinChars = envInt('ELF_MEMORY_EXTRACT_MIN_CHARS', 4),
} = {}) {
  async function loadFacts(elfId, userId) {
    const [rows] = await db.execute(
      `SELECT id, fact, confidence, updated_at FROM elf_memory
       WHERE elf_id = ? AND user_id = ?
       ORDER BY updated_at DESC, id ASC LIMIT ${FACT_SCAN_LIMIT}`,
      [elfId, userId],
    );
    return (rows || []).map((row) => ({
      id: row.id,
      fact: row.fact,
      confidence: Number(row.confidence) || 0,
      updatedAt: Number(row.updated_at) || 0,
    }));
  }

  async function recall(elfId, userId, query) {
    if (!enabled || !elfId || !userId) return [];
    const facts = await loadFacts(elfId, userId);
    return rankFacts(facts, query, { topN: recallTopN, maxChars: recallMaxChars });
  }

  /// 抽取配额：单精灵每日上限，防止记忆抽取拖垮平台预算。
  /// 先读后写存在轻微并发超限，属于可接受的软限制。
  async function consumeExtractQuota(elfId) {
    const key = `${elfId}:${dayKey()}`;
    const [rows] = await db.execute(
      'SELECT calls FROM elf_memory_quota WHERE id = ? LIMIT 1', [key],
    );
    const calls = Number(rows?.[0]?.calls) || 0;
    if (calls >= dailyExtractPerElf) return false;
    await db.execute(
      `INSERT INTO elf_memory_quota (id, elf_id, calls, updated_at)
       VALUES (?, ?, 1, ?)
       ON DUPLICATE KEY UPDATE calls = calls + 1, updated_at = VALUES(updated_at)`,
      [key, elfId, Date.now()],
    );
    return true;
  }

  async function mergeFacts(elfId, userId, candidates) {
    if (!candidates.length) return { stored: 0, updated: 0 };
    const existing = await loadFacts(elfId, userId);
    const byNormalized = new Map();
    for (const row of existing) {
      const key = normalizeFact(row.fact);
      if (key && !byNormalized.has(key)) byNormalized.set(key, row);
    }

    const now = Date.now();
    let stored = 0;
    let updated = 0;
    for (const fact of candidates) {
      const key = normalizeFact(fact);
      if (!key) continue;
      const hit = byNormalized.get(key);
      if (hit) {
        // 重复出现的事实提高置信度，同时刷新时间让它更晚被淘汰。
        await db.execute(
          'UPDATE elf_memory SET confidence = confidence + 1, updated_at = ? WHERE id = ?',
          [now, hit.id],
        );
        updated++;
      } else {
        const id = `em_${crypto.randomBytes(12).toString('hex')}`;
        await db.execute(
          `INSERT INTO elf_memory (id, elf_id, user_id, fact, source, confidence, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'chat', 1, ?, ?)`,
          [id, elfId, userId, fact, now, now],
        );
        byNormalized.set(key, { id, fact });
        stored++;
      }
    }

    // 容量上限：超出后按更新时间淘汰最旧的记忆。
    const total = existing.length + stored;
    if (total > maxFactsPerPair) {
      const all = await loadFacts(elfId, userId);
      const evict = all.slice(maxFactsPerPair);
      for (const row of evict) {
        await db.execute('DELETE FROM elf_memory WHERE id = ?', [row.id]);
      }
    }
    return { stored, updated };
  }

  /// 一轮对话完成后的异步抽取：任何一步失败都只记日志，绝不影响对话链路。
  async function extractAndStore({ elfId, userId, text, reply, trace }) {
    if (!enabled || !upstream || !elfId || !userId) return { skipped: true };
    const userText = String(text || '').trim();
    const replyText = String(reply || '').trim();
    if (userText.length < extractMinChars || !replyText) return { skipped: true };
    if (!(await consumeExtractQuota(elfId))) return { skipped: true, reason: 'quota' };

    const existing = await loadFacts(elfId, userId);
    const existingBlock = existing.slice(0, EXTRACT_EXISTING_LIMIT)
      .map((row) => `- ${row.fact}`).join('\n') || '（空）';
    const userPrompt = [
      `【已有记忆】\n${existingBlock}`,
      `【本轮对话】\n用户：${userText.slice(0, EXTRACT_INPUT_CHARS)}\nAI：${replyText.slice(0, EXTRACT_INPUT_CHARS)}`,
    ].join('\n\n');

    const result = await upstream.chatCompletions({
      model,
      messages: [
        { role: 'system', content: EXTRACT_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0,
      max_tokens: 300,
      trace: trace || { name: 'elf-memory-extract', userId, sessionId: elfId, tags: ['elf-memory'] },
    });
    await recordCost?.(elfId, result?.usage?.total_tokens);

    const facts = parseExtractedFacts(result?.choices?.[0]?.message?.content);
    const merged = await mergeFacts(elfId, userId, facts);
    logger?.debug?.({ elfId, userId, extracted: facts.length, ...merged }, 'elf memory extracted');
    return { extracted: facts.length, ...merged };
  }

  return { recall, buildMemoryBlock, extractAndStore, mergeFacts, parseExtractedFacts };
}

module.exports = {
  ELF_MEMORY_TABLES,
  createElfMemory,
  rankFacts,
  buildMemoryBlock,
  normalizeFact,
};
