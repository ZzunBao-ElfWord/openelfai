#!/usr/bin/env node
// WorkBuddy 上架包本地校验：元信息、依赖、敏感词、密钥与图片。
// 产出 dist/manifest.json 供后台「WorkBuddy 上架」页面只读展示。
// 用法：node scripts/validate.mjs

import {
  readdirSync,
  readFileSync,
  statSync,
  mkdirSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { join, resolve, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PKG_DIR = join(ROOT, 'packages');
const DIST_DIR = join(ROOT, 'dist');

const TEXT_EXT = new Set(['.md', '.json', '.txt', '.yaml', '.yml', '.mjs', '.js']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg']);
const OTHER_IMAGE_EXT = new Set(['.webp', '.gif', '.bmp', '.svg', '.avif']);
const FORBIDDEN = ['NFT', '区块链', '链上', '身份证', '铸造'];
const SECRET_RE = /(api[_-]?key|secret|token|password)\s*[:=]\s*["']?[A-Za-z0-9_\-/+=]{12,}/i;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

// 递归列出包内文件（相对包目录的 posix 路径）
function listFiles(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) {
      out.push(...listFiles(abs, base));
    } else {
      out.push({ abs, path: join(abs.slice(base.length + 1)).split('\\').join('/'), bytes: st.size });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function readText(abs) {
  return readFileSync(abs, 'utf8');
}

// 只解析 frontmatter 的一级字段 + x-openelf 下的二级字段，避免引入 YAML 依赖
export function parseFrontmatter(text) {
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end < 0) return null;
  const raw = text.slice(3, end).replace(/\r/g, '');
  const fields = {};
  let block = '';
  for (const line of raw.split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (/^\s+/.test(line)) {
      const m = line.trim().match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (m) fields[`${block}.${m[1]}`] = m[2].trim();
      continue;
    }
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    block = m[1];
    fields[block] = m[2].trim();
  }
  return fields;
}

// 正文按二级标题切块
export function markdownSections(text) {
  const map = new Map();
  let title = '';
  let lines = [];
  for (const line of text.replace(/\r/g, '').split('\n')) {
    if (line.startsWith('## ')) {
      if (title) map.set(title, lines.join('\n'));
      title = line.slice(3).trim();
      lines = [];
      continue;
    }
    if (title) lines.push(line);
  }
  if (title) map.set(title, lines.join('\n'));
  return map;
}

function newPkg(meta) {
  return {
    name: meta.name,
    kind: meta.kind,
    version: meta.version || '',
    dir: meta.dir,
    dependencies: { connectors: [] },
    files: [],
    checks: [],
    ok: true,
  };
}

function addCheck(pkg, name, ok, message = '') {
  // 通过时不展示细节，仅失败时保留原因
  pkg.checks.push({ name, ok, message: ok ? '' : message });
  if (!ok) pkg.ok = false;
}

function checkGlobal(pkg, files) {
  // 敏感词：所有文本文件都要干净
  const hits = [];
  for (const f of files) {
    if (!TEXT_EXT.has(extname(f.abs).toLowerCase())) continue;
    const text = readText(f.abs);
    for (const word of FORBIDDEN) {
      if (text.toLowerCase().includes(word.toLowerCase())) {
        hits.push(`${f.path}：${word}`);
      }
    }
  }
  addCheck(pkg, '敏感词拦截', hits.length === 0, hits.join('；'));

  // 疑似真实密钥
  const secretHits = [];
  for (const f of files) {
    if (!TEXT_EXT.has(extname(f.abs).toLowerCase())) continue;
    const m = readText(f.abs).match(SECRET_RE);
    if (m) secretHits.push(`${f.path}：${m[0].slice(0, 24)}…`);
  }
  addCheck(pkg, '真实密钥拦截', secretHits.length === 0, secretHits.join('；'));

  // 图片格式与体积
  const badImages = [];
  for (const f of files) {
    const ext = extname(f.abs).toLowerCase();
    if (OTHER_IMAGE_EXT.has(ext)) {
      badImages.push(`${f.path}：只允许 png/jpg`);
    } else if (IMAGE_EXT.has(ext) && f.bytes > MAX_IMAGE_BYTES) {
      badImages.push(`${f.path}：${(f.bytes / 1024).toFixed(0)}KB 超过 2MB`);
    }
  }
  addCheck(pkg, '图片格式与体积', badImages.length === 0, badImages.join('；'));
}

function checkPackageJson(pkg, dir, files) {
  const file = files.find((f) => f.path === 'package.json');
  if (!file) {
    addCheck(pkg, 'package.json 存在', false, '缺少 package.json');
    return;
  }
  let meta;
  try {
    meta = JSON.parse(readText(file.abs));
  } catch (err) {
    addCheck(pkg, 'package.json 可解析', false, err.message);
    return;
  }
  addCheck(pkg, 'package.json 可解析', true);
  addCheck(pkg, '包名与目录一致', meta.name === dir, `name=${meta.name ?? '缺失'} dir=${dir}`);
  addCheck(pkg, '包版本号', SEMVER_RE.test(meta.version ?? ''), `version=${meta.version ?? '缺失'}`);
  if (SEMVER_RE.test(meta.version ?? '')) pkg.version = meta.version;
  const connectors = meta.dependencies?.connectors;
  addCheck(
    pkg,
    '依赖连接器声明',
    Array.isArray(connectors),
    Array.isArray(connectors) ? '' : 'package.json 缺少 dependencies.connectors 数组',
  );
  if (Array.isArray(connectors)) pkg.dependencies.connectors = connectors;
}

// 校验 {en, zh} 双语字段
function localizedOk(v) {
  return Boolean(
    v &&
      typeof v === 'object' &&
      typeof v.en === 'string' &&
      v.en.trim() &&
      typeof v.zh === 'string' &&
      v.zh.trim(),
  );
}

// 只统计中日韩统一表意文字，用于展示描述字数校验
function cjkCount(s) {
  return [...String(s ?? '')].filter((c) => /[\u3400-\u9fff]/.test(c)).length;
}

function checkExpert(pkg, dir, files) {
  const file = files.find((f) => f.path === '.codebuddy-plugin/plugin.json');
  if (!file) {
    addCheck(pkg, '插件配置位置', false, '专家包必须把 plugin.json 放在 .codebuddy-plugin/ 目录');
    return;
  }
  let plugin;
  try {
    plugin = JSON.parse(readText(file.abs));
  } catch (err) {
    addCheck(pkg, 'plugin.json 可解析', false, err.message);
    return;
  }
  addCheck(pkg, 'plugin.json 可解析', true);

  const strings = ['name', 'version', 'description', 'categoryId', 'avatar', 'plugin'];
  const missingStr = strings.filter((k) => !(typeof plugin[k] === 'string' && plugin[k].trim()));
  addCheck(pkg, '专家基础字段', missingStr.length === 0, `缺少：${missingStr.join('、')}`);

  const authorOk =
    plugin.author &&
    typeof plugin.author === 'object' &&
    typeof plugin.author.name === 'string' &&
    plugin.author.name.trim() &&
    typeof plugin.author.email === 'string' &&
    plugin.author.email.trim();
  addCheck(pkg, '作者信息', Boolean(authorOk), 'author 需要 {name, email}');

  addCheck(pkg, '专家类型', plugin.expertType === 'agent', `expertType=${plugin.expertType ?? '缺失'}，要求 agent`);

  const agents = Array.isArray(plugin.agents) ? plugin.agents : [];
  addCheck(pkg, 'agents 列表', agents.length > 0, 'agents 必须是非空数组');
  const missingAgents = agents.filter(
    (p) => !(typeof p === 'string' && files.some((f) => f.path === p.replace(/^\.\//, ''))),
  );
  addCheck(pkg, 'agents 文件存在', missingAgents.length === 0, `缺少：${missingAgents.join('、')}`);

  const agentName = typeof plugin.agentName === 'string' ? plugin.agentName : '';
  addCheck(
    pkg,
    'agentName',
    Boolean(agentName) && files.some((f) => f.path === `agents/${agentName}.md`),
    `agentName=${agentName || '缺失'}，需与 agents/ 下文件名一致`,
  );

  const localizedFields = ['displayName', 'profession', 'displayDescription', 'defaultInitPrompt'];
  const badLocalized = localizedFields.filter((k) => !localizedOk(plugin[k]));
  addCheck(pkg, '展示字段双语', badLocalized.length === 0, `需要 {zh, en}：${badLocalized.join('、')}`);

  if (localizedOk(plugin.displayDescription)) {
    const len = cjkCount(plugin.displayDescription.zh);
    addCheck(pkg, '展示描述字数', len >= 40 && len <= 50, `中文 ${len} 个汉字，要求 40–50`);
  }

  addCheck(
    pkg,
    'plugin 与 name 一致',
    plugin.plugin === plugin.name,
    `plugin=${plugin.plugin ?? '缺失'} name=${plugin.name ?? '缺失'}`,
  );

  const tags = Array.isArray(plugin.tags) ? plugin.tags : [];
  addCheck(
    pkg,
    '标签数量与双语',
    tags.length === 3 && tags.every(localizedOk),
    `当前 ${tags.length} 个，要求 3 个 {zh, en}`,
  );

  const prompts = Array.isArray(plugin.quickPrompts) ? plugin.quickPrompts : [];
  addCheck(
    pkg,
    '快捷提示数量与双语',
    prompts.length === 3 && prompts.every(localizedOk),
    `当前 ${prompts.length} 个，要求 3 个 {zh, en}`,
  );
  if (prompts.length > 0 && localizedOk(prompts[0]) && localizedOk(plugin.defaultInitPrompt)) {
    const same =
      prompts[0].zh === plugin.defaultInitPrompt.zh && prompts[0].en === plugin.defaultInitPrompt.en;
    addCheck(pkg, '开场白与首条快捷提示一致', same, 'defaultInitPrompt 必须等于 quickPrompts[0]');
  }

  if (typeof plugin.avatar === 'string' && plugin.avatar.trim()) {
    const avatar = plugin.avatar.replace(/\\/g, '/');
    const found = files.find((f) => f.path === avatar);
    addCheck(
      pkg,
      '头像文件存在',
      Boolean(found) && IMAGE_EXT.has(extname(avatar).toLowerCase()),
      found ? '' : `缺少 ${avatar}`,
    );
  }

  addCheck(pkg, '专家版本号', SEMVER_RE.test(plugin.version ?? ''), `version=${plugin.version ?? '缺失'}`);
  if (SEMVER_RE.test(plugin.version ?? '')) {
    if (pkg.version && pkg.version !== plugin.version) {
      addCheck(pkg, '版本号一致', false, `package.json=${pkg.version} plugin.json=${plugin.version}`);
    } else {
      pkg.version = plugin.version;
    }
  }

  // 人设正文与 frontmatter
  const agentFiles = files.filter((f) => f.path.startsWith('agents/') && f.path.endsWith('.md'));
  addCheck(pkg, '人设正文存在', agentFiles.length > 0, 'agents/ 下缺少 .md 人设正文');
  const agentIssues = [];
  for (const f of agentFiles) {
    const fm = parseFrontmatter(readText(f.abs));
    if (!fm) {
      agentIssues.push(`${f.path}：缺少 frontmatter`);
      continue;
    }
    if (fm.name !== basename(f.path, '.md')) agentIssues.push(`${f.path}：name 与文件名不一致`);
    if (!fm.description) agentIssues.push(`${f.path}：缺少 description`);
    if (!(fm['displayName.en'] && fm['displayName.zh'])) agentIssues.push(`${f.path}：displayName 需要 {en, zh}`);
    if (!(fm['profession.en'] && fm['profession.zh'])) agentIssues.push(`${f.path}：profession 需要 {en, zh}`);
  }
  addCheck(pkg, '人设 frontmatter', agentIssues.length === 0, agentIssues.join('；'));
}

function checkSkill(pkg, dir, files) {
  const file = files.find((f) => f.path === 'SKILL.md');
  if (!file) {
    addCheck(pkg, 'SKILL.md 存在', false, '技能包必须有 SKILL.md');
    return;
  }
  const text = readText(file.abs);
  const fm = parseFrontmatter(text);
  addCheck(pkg, 'frontmatter 存在', Boolean(fm), 'SKILL.md 缺少 YAML frontmatter');

  if (fm) {
    // 与平台文档一致：展示名、中英描述、作者均为必填
    const required = [
      'name',
      'display_name',
      'display_name_en',
      'description',
      'description_zh',
      'description_en',
      'version',
      'author',
    ];
    const missing = required.filter((k) => !fm[k]);
    addCheck(pkg, 'frontmatter 必填字段', missing.length === 0, `缺少：${missing.join('、')}`);
    addCheck(pkg, '技能名与目录一致', fm.name === dir, `name=${fm.name ?? '缺失'} dir=${dir}`);
    // 命名规范：展示名统一以应用名 OpenElf 结尾，便于市场识别归属
    const named =
      String(fm.display_name ?? '').trim().endsWith('OpenElf') &&
      String(fm.display_name_en ?? '').trim().endsWith('OpenElf');
    addCheck(pkg, '展示名带应用标识', named, `display_name=${fm.display_name ?? '缺失'}，须以 OpenElf 结尾`);
    addCheck(pkg, '技能版本号', SEMVER_RE.test(fm.version ?? ''), `version=${fm.version ?? '缺失'}`);
    if (SEMVER_RE.test(fm.version ?? '')) {
      if (pkg.version && pkg.version !== fm.version) {
        addCheck(pkg, '版本号一致', false, `package.json=${pkg.version} SKILL.md=${fm.version}`);
      } else {
        pkg.version = fm.version;
      }
    }
    const connector = fm['x-openelf.requires_connector'] ?? '';
    if (connector) {
      const declared = pkg.dependencies.connectors.includes(connector);
      addCheck(
        pkg,
        '依赖连接器一致',
        declared,
        declared ? '' : `x-openelf.requires_connector=${connector} 未在 package.json 声明`,
      );
    }
  }

  const sections = markdownSections(text);
  const requiredSections = ['何时使用', '不适用', '调用顺序'];
  const missing = requiredSections.filter((s) => !sections.has(s));
  addCheck(pkg, '正文三节完整', missing.length === 0, `缺少：${missing.join('、')}`);
}

export function validateAll({ writeManifest = true } = {}) {
  const packages = [];
  if (!existsSync(PKG_DIR)) {
    throw new Error(`packages 目录不存在：${PKG_DIR}`);
  }

  for (const name of readdirSync(PKG_DIR).sort()) {
    const abs = join(PKG_DIR, name);
    if (!statSync(abs).isDirectory()) continue;
    const files = listFiles(abs);
    const entries = new Set(files.map((f) => f.path));
    const kind = entries.has('.codebuddy-plugin/plugin.json')
      ? 'expert'
      : entries.has('SKILL.md')
        ? 'skill'
        : '';
    const pkg = newPkg({ name, kind, version: '', dir: name });

    if (!kind) {
      addCheck(pkg, '包类型识别', false, '既没有 plugin.json，也没有 SKILL.md');
    } else {
      addCheck(pkg, '包类型识别', true);
    }

    checkPackageJson(pkg, name, files);
    if (kind === 'expert') checkExpert(pkg, name, files);
    if (kind === 'skill') checkSkill(pkg, name, files);
    checkGlobal(pkg, files);

    pkg.files = files.map((f) => ({ path: f.path, bytes: f.bytes }));
    packages.push(pkg);
  }

  const manifest = {
    generated_at: new Date().toISOString(),
    packages,
  };

  if (writeManifest) {
    mkdirSync(DIST_DIR, { recursive: true });
    writeFileSync(join(DIST_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }

  return { ok: packages.every((p) => p.ok), packages, manifest };
}

// 仅在直接执行时打印结果并设置退出码
const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const { ok, packages } = validateAll();
    if (packages.length === 0) {
      console.error('packages/ 下没有可校验的包');
      process.exit(1);
    }
    for (const pkg of packages) {
      const state = pkg.ok ? 'PASS' : 'FAIL';
      console.log(`[${state}] ${pkg.name}（${pkg.kind || '未知类型'} v${pkg.version || '?'}）`);
      for (const c of pkg.checks) {
        console.log(`  ${c.ok ? '✓' : '✗'} ${c.name}${c.message ? `：${c.message}` : ''}`);
      }
    }
    console.log(`\n清单已写入 dist/manifest.json，共 ${packages.length} 个包，结果 ${ok ? '全部通过' : '存在失败'}`);
    process.exit(ok ? 0 : 1);
  } catch (err) {
    console.error(`校验异常：${err.message}`);
    process.exit(1);
  }
}
