#!/usr/bin/env node
// 生成静态预览页 preview/index.html：左侧专家卡片，右侧技能流程。
// 纯静态、不联网（头像以 base64 内联）。
// 用法：node scripts/preview.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter, markdownSections } from './validate.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PKG_DIR = join(ROOT, 'packages');
const OUT_DIR = join(ROOT, 'preview');

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 头像内联成 data URL，保证预览页离线可用
function avatarDataUrl(pkgDir, rel) {
  const abs = join(pkgDir, rel);
  if (!existsSync(abs)) return '';
  const mime = extname(rel).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${readFileSync(abs).toString('base64')}`;
}

// 把 markdown 段落拆成「要点列表」与「不适用」提示
function splitBullets(body) {
  const bullets = [];
  let notApplicable = '';
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('不适用')) {
      notApplicable = line.replace(/^不适用[：:]\s*/, '');
      continue;
    }
    if (line.startsWith('- ')) bullets.push(line.slice(2).trim());
  }
  return { bullets, notApplicable };
}

function renderExpert(dirName) {
  const pkgDir = join(PKG_DIR, dirName);
  const plugin = JSON.parse(readFileSync(join(pkgDir, '.codebuddy-plugin', 'plugin.json'), 'utf8'));
  const avatar = avatarDataUrl(pkgDir, plugin.avatar);
  const name = plugin.displayName?.zh ?? plugin.name;
  const prompts = (plugin.quickPrompts ?? [])
    .map((p) => `<li>${esc(p.zh ?? p)}</li>`)
    .join('');
  return `
  <section class="card">
    <div class="card-head">
      <span class="kind expert">专家</span>
      <span class="ver">v${esc(plugin.version)}</span>
    </div>
    <div class="expert-top">
      ${avatar ? `<img class="avatar" src="${avatar}" alt="${esc(name)}" />` : '<div class="avatar placeholder">无头像</div>'}
      <div>
        <h2>${esc(name)}</h2>
        <p class="muted">${esc(plugin.name)} · ${esc(plugin.categoryId)}</p>
      </div>
    </div>
    <p class="desc">${esc(plugin.displayDescription?.zh ?? plugin.description)}</p>
    <h3>开场白</h3>
    <p class="bubble">${esc(plugin.defaultInitPrompt?.zh ?? plugin.defaultInitPrompt)}</p>
    <h3>快捷提示</h3>
    <ul class="prompts">${prompts}</ul>
  </section>`;
}

function renderSkill(dirName) {
  const pkgDir = join(PKG_DIR, dirName);
  const text = readFileSync(join(pkgDir, 'SKILL.md'), 'utf8');
  const fm = parseFrontmatter(text) ?? {};
  const sections = markdownSections(text);
  const when = splitBullets(sections.get('何时使用') ?? '');
  const order = splitBullets(sections.get('调用顺序') ?? '');
  const connector = fm['x-openelf.requires_connector'] ?? '';
  const whenList = when.bullets.map((b) => `<li>${esc(b)}</li>`).join('');
  const orderList = order.bullets.map((b) => `<li>${esc(b)}</li>`).join('');
  return `
  <section class="card">
    <div class="card-head">
      <span class="kind skill">技能</span>
      <span class="ver">v${esc(fm.version)}</span>
    </div>
    <h2>${esc(fm.name)}</h2>
    <p class="desc">${esc(fm.description)}</p>
    ${connector ? `<p class="dep">依赖连接器：<code>${esc(connector)}</code></p>` : ''}
    <h3>何时使用</h3>
    <ul>${whenList}</ul>
    ${when.notApplicable ? `<p class="warn"><strong>不适用：</strong>${esc(when.notApplicable)}</p>` : ''}
    <h3>调用顺序</h3>
    <ol class="steps">${orderList}</ol>
  </section>`;
}

function main() {
  if (!existsSync(PKG_DIR)) {
    console.error(`packages 目录不存在：${PKG_DIR}`);
    process.exit(1);
  }
  const dirs = readdirSync(PKG_DIR).filter((n) => statSync(join(PKG_DIR, n)).isDirectory());
  const experts = dirs.filter((n) => existsSync(join(PKG_DIR, n, '.codebuddy-plugin', 'plugin.json')));
  const skills = dirs.filter((n) => existsSync(join(PKG_DIR, n, 'SKILL.md')));

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>WorkBuddy 上架包预览</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px; background: #f5f6f8; color: #1f2933;
    font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
  header { max-width: 1080px; margin: 0 auto 24px; }
  header h1 { margin: 0 0 6px; font-size: 22px; }
  header p { margin: 0; color: #6b7a8c; font-size: 14px; }
  main { max-width: 1080px; margin: 0 auto; display: grid; gap: 20px; }
  .grid { display: grid; gap: 20px; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); }
  .card { background: #fff; border: 1px solid #e3e8ee; border-radius: 12px; padding: 24px;
    box-shadow: 0 1px 3px rgba(16, 24, 40, .04); }
  .card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
  .kind { font-size: 12px; padding: 2px 8px; border-radius: 999px; }
  .kind.expert { background: #eef2ff; color: #4338ca; }
  .kind.skill { background: #ecfdf3; color: #067647; }
  .ver { font-size: 12px; color: #8a94a6; font-family: ui-monospace, Consolas, monospace; }
  .expert-top { display: flex; align-items: center; gap: 16px; }
  .avatar { width: 72px; height: 72px; border-radius: 12px; object-fit: cover; border: 1px solid #e3e8ee; }
  .avatar.placeholder { display: flex; align-items: center; justify-content: center; background: #f0f2f5;
    color: #98a2b3; font-size: 12px; }
  h2 { margin: 0 0 4px; font-size: 18px; }
  h3 { margin: 20px 0 8px; font-size: 13px; color: #475467; letter-spacing: .02em; }
  .muted { margin: 0; font-size: 12px; color: #8a94a6; font-family: ui-monospace, Consolas, monospace; }
  .desc { margin: 16px 0 0; font-size: 14px; line-height: 1.7; color: #344054; }
  .bubble { margin: 0; padding: 12px 14px; background: #f8fafc; border-left: 3px solid #c7d2fe;
    border-radius: 6px; font-size: 13px; line-height: 1.7; color: #344054; }
  ul, ol { margin: 0; padding-left: 20px; font-size: 13px; line-height: 1.8; color: #475467; }
  .prompts li { margin-bottom: 4px; }
  .warn { margin: 12px 0 0; padding: 10px 12px; background: #fffaeb; border: 1px solid #fedf89;
    border-radius: 6px; font-size: 13px; color: #93370d; }
  .dep { margin: 12px 0 0; font-size: 12px; color: #475467; }
  code { background: #f2f4f7; padding: 1px 6px; border-radius: 4px; font-size: 12px; }
  .steps li { margin-bottom: 6px; }
  footer { max-width: 1080px; margin: 24px auto 0; font-size: 12px; color: #98a2b3; }
</style>
</head>
<body>
  <header>
    <h1>WorkBuddy 上架包预览</h1>
    <p>纯静态预览，内容与 packages/ 源码一致；图片均为 AI 生成。生成时间 ${esc(new Date().toISOString())}</p>
  </header>
  <main>
    <div class="grid">
      ${experts.map(renderExpert).join('\n')}
      ${skills.map(renderSkill).join('\n')}
    </div>
  </main>
  <footer>专家 ${experts.length} 个 · 技能 ${skills.length} 个</footer>
</body>
</html>
`;

  mkdirSync(OUT_DIR, { recursive: true });
  const out = join(OUT_DIR, 'index.html');
  writeFileSync(out, html, 'utf8');
  console.log(`预览已生成：preview/index.html（专家 ${experts.length} 个，技能 ${skills.length} 个）`);
}

main();
