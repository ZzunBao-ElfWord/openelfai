'use strict';

/// 知识库运维脚本：开关、入库、预览检索。默认只操作 Production 环境。
///
/// 用法：
///   node scripts/knowledge.js list-elves --q 专家
///   node scripts/knowledge.js enable --name "大模型 API&Key 管理专家"
///   node scripts/knowledge.js enable --elf-id ELF_ID --by kongling
///   node scripts/knowledge.js disable --elf-id ELF_ID
///   node scripts/knowledge.js status --elf-id ELF_ID
///   node scripts/knowledge.js docs
///   node scripts/knowledge.js ingest --file ./knowledge/docs.json
///   node scripts/knowledge.js remove --id DOC_ID
///   node scripts/knowledge.js retrieve --elf-id ELF_ID --query "429 怎么处理"
///
/// docs.json 格式（数组，或 { "docs": [...] }）：
/// [
///   {
///     "id": "deepseek_chat_api",
///     "category": "vendor_api",
///     "vendor": "deepseek",
///     "title": "DeepSeek Chat API 调用",
///     "sourceUrl": "https://platform.deepseek.com/api-docs/",
///     "content": "……正文，支持 Markdown 与空行分段……"
///   }
/// ]

const fs = require('node:fs');
const path = require('node:path');

const { createPool } = require('../src/db');
const config = require('../src/config');
const { createKnowledgeService } = require('../src/knowledge');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next != null && !next.startsWith('--')) {
      args[key] = next;
      i++;
    } else {
      args[key] = 'true';
    }
  }
  return args;
}

function required(args, key) {
  const value = typeof args[key] === 'string' ? args[key].trim() : '';
  if (!value || value === 'true') throw new Error(`缺少 --${key}`);
  return value;
}

async function findElves(pool, environment, keyword) {
  const like = `%${String(keyword || '').trim()}%`;
  const [rows] = await pool.execute(
    `SELECT object_id, owner_id, payload FROM payment_objects
     WHERE environment = ? AND kind = 'elf'
       AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.name')) LIKE ?
     ORDER BY updated_at DESC LIMIT 50`,
    [environment, like],
  );
  return rows.map((row) => {
    let payload = {};
    try { payload = JSON.parse(row.payload); } catch (_) { /* ignore */ }
    return {
      id: row.object_id,
      name: payload.name || '',
      ownerId: payload.ownerId || row.owner_id || null,
      isOfficial: !!payload.isOfficial,
    };
  });
}

async function resolveElfId(pool, environment, args) {
  if (typeof args['elf-id'] === 'string' && args['elf-id'] !== 'true') return args['elf-id'].trim();
  const name = required(args, 'name');
  const matches = await findElves(pool, environment, name);
  const exact = matches.filter((item) => item.name === name);
  const candidates = exact.length ? exact : matches;
  if (candidates.length === 1) return candidates[0].id;
  if (!candidates.length) throw new Error(`没有找到名称为「${name}」的 AI`);
  const lines = candidates.map((item) => `  ${item.id}  ${item.name}${item.isOfficial ? '（官方）' : ''}`);
  throw new Error(`名称匹配到 ${candidates.length} 只 AI，请改用 --elf-id 指定：\n${lines.join('\n')}`);
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!command) {
    process.stdout.write('缺少命令，见 scripts/knowledge.js 文件头注释。\n');
    process.exitCode = 1;
    return;
  }

  const environment = typeof args.env === 'string' && args.env !== 'true' ? args.env : 'Production';
  const pool = await createPool(config);
  const knowledge = createKnowledgeService({ db: pool, environment });

  try {
    if (command === 'list-elves') {
      printJson(await findElves(pool, environment, args.q === 'true' ? '' : (args.q || '')));
      return;
    }

    if (command === 'enable' || command === 'disable') {
      const elfId = await resolveElfId(pool, environment, args);
      const result = await knowledge.setEnabled(elfId, command === 'enable', args.by || 'script');
      printJson(result);
      return;
    }

    if (command === 'status') {
      const elfId = await resolveElfId(pool, environment, args);
      printJson({ elfId, environment, enabled: await knowledge.isEnabled(elfId) });
      return;
    }

    if (command === 'docs') {
      printJson(await knowledge.listDocs());
      return;
    }

    if (command === 'ingest') {
      const file = path.resolve(process.cwd(), required(args, 'file'));
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      const docs = Array.isArray(raw) ? raw : raw.docs;
      if (!Array.isArray(docs) || !docs.length) throw new Error('文件里没有 docs 数组');
      printJson(await knowledge.ingestDocs(docs));
      return;
    }

    if (command === 'remove') {
      printJson(await knowledge.removeDoc(required(args, 'id')));
      return;
    }

    if (command === 'retrieve') {
      const elfId = await resolveElfId(pool, environment, args);
      const enabled = await knowledge.isEnabled(elfId);
      const hits = enabled ? await knowledge.retrieve(required(args, 'query')) : [];
      printJson({ elfId, enabled, hits });
      return;
    }

    throw new Error(`未知命令：${command}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
