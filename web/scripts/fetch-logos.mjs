/* 批量抓取各条目官网 Logo → public/logos/{id}.{ext}
 * 主源 favicon.im（服务端聚合，可覆盖海外被墙域名）；结果过小（低清）时回退
 * 站点自身 apple-touch-icon / favicon.ico，取体积最大者。
 * 成功后把 logo_url 回填进 data/tools.json。
 * 用法：node scripts/fetch-logos.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataPath = join(root, 'data', 'tools.json');
const outDir = join(root, 'public', 'logos');
mkdirSync(outDir, { recursive: true });

const tools = JSON.parse(readFileSync(dataPath, 'utf8'));

const EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/svg+xml': '.svg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico'
};

async function fetchBuf(url) {
  try {
    const r = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
      headers: { 'User-Agent': 'Mozilla/5.0 (logo-fetch)' }
    });
    if (!r.ok) return null;
    const ct = (r.headers.get('content-type') || '').split(';')[0].trim();
    if (!EXT[ct]) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length) return null;
    return { buf, ct };
  } catch {
    return null;
  }
}

function domainOf(t) {
  const u = t.download_url || t.official_url || '';
  try {
    return new URL(u).hostname;
  } catch {
    return '';
  }
}

async function bestLogo(domain) {
  const cands = [];
  const primary = await fetchBuf(`https://favicon.im/${domain}?larger=true`);
  if (primary) cands.push(primary);
  // 低清结果（<1.2KB 的位图）尝试站点自有高清图标
  if (!primary || (primary.ct !== 'image/svg+xml' && primary.buf.length < 1200)) {
    for (const p of ['/apple-touch-icon.png', '/favicon.ico']) {
      const alt = await fetchBuf(`https://${domain}${p}`);
      if (alt && alt.ct !== 'image/svg+xml') cands.push(alt);
      if (cands.length > 2) break;
    }
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b.buf.length - a.buf.length);
  return cands[0];
}

let ok = 0;
const failed = [];
for (const t of tools) {
  const domain = domainOf(t);
  if (!domain) {
    failed.push(t.id + '(无域名)');
    continue;
  }
  const got = await bestLogo(domain);
  if (!got) {
    failed.push(t.id + '(' + domain + ')');
    continue;
  }
  const ext = EXT[got.ct];
  const file = join(outDir, t.id + ext);
  writeFileSync(file, got.buf);
  t.logo_url = '/logos/' + t.id + ext;
  ok++;
  console.log('OK', t.id, got.ct, got.buf.length);
}

writeFileSync(dataPath, JSON.stringify(tools, null, 2) + '\n');
console.log(`\n完成 ${ok}/${tools.length}，失败：`, failed);
