#!/usr/bin/env node
// 打包单个 WorkBuddy 上架包：先整体校验，任一包不通过则拒绝打包。
// 用法：node scripts/pack.mjs <package-name> [<package-name> ...]

import { existsSync, mkdirSync, statSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateAll } from './validate.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PKG_DIR = join(ROOT, 'packages');
const DIST_DIR = join(ROOT, 'dist');

const names = process.argv.slice(2).filter((a) => !a.startsWith('-'));
if (names.length === 0) {
  console.error('用法：node scripts/pack.mjs <package-name> [<package-name> ...]');
  process.exit(1);
}

// 打包前先跑一次全量校验，保证 manifest 与源码一致
const { ok, packages } = validateAll();
if (!ok) {
  console.error('校验未通过，已停止打包；请先修复 validate.mjs 列出的问题');
  process.exit(1);
}

mkdirSync(DIST_DIR, { recursive: true });

let failed = 0;
for (const name of names) {
  const meta = packages.find((p) => p.name === name);
  if (!meta) {
    console.error(`[SKIP] ${name}：packages/ 下不存在该包`);
    failed += 1;
    continue;
  }
  const src = join(PKG_DIR, name);
  const dest = join(DIST_DIR, `${name}-${meta.version}.zip`);
  if (existsSync(dest)) rmSync(dest);

  let res;
  if (process.platform === 'win32') {
    // 用 .NET ZipFile 逐文件写入，确保条目名使用正斜杠（Compress-Archive 会写反斜杠，
    // Linux 解压时会被当成文件名的一部分，导致目录结构错乱）
    const q = (p) => p.replace(/'/g, "''");
    const script = `
Add-Type -AssemblyName System.IO.Compression.FileSystem
$src = '${q(src)}'
$dest = '${q(dest)}'
if (Test-Path $dest) { Remove-Item $dest -Force }
$zip = [System.IO.Compression.ZipFile]::Open($dest, 'Create')
Get-ChildItem -LiteralPath $src -Recurse -File -Force | ForEach-Object {
  $rel = $_.FullName.Substring($src.Length + 1).Replace('\\', '/')
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $rel) | Out-Null
}
$zip.Dispose()
`;
    res = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: 'inherit',
    });
  } else {
    // Linux/macOS 走系统 zip，保留相对路径
    res = spawnSync('zip', ['-r', '-q', dest, '.'], { cwd: src, stdio: 'inherit' });
  }

  if (res.status !== 0 || !existsSync(dest)) {
    console.error(`[FAIL] ${name}：打包失败（退出码 ${res.status}）`);
    failed += 1;
    continue;
  }
  const size = statSync(dest).size;
  console.log(`[OK] ${name} v${meta.version} → dist/${name}-${meta.version}.zip（${(size / 1024).toFixed(0)}KB）`);
}

process.exit(failed === 0 ? 0 : 1);
