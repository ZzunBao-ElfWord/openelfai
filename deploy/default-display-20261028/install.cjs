'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const cp = require('node:child_process');
const baseline = '87ba28cf5fdcfc111fa039721709921692a7aabd3f6e78920abfdca0dfa4ca9f';
const feedHash = 'c267f5efd6d7ac7a20a3005a05ac9460c19701f544e8a713d721b0b5776c62d3';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
function prepare(current, next, feed) {
  if (sha(current) !== baseline && current !== next) throw new Error('内容模块不是已核对的build16版本，停止，未修改文件');
  if (sha(feed) !== feedHash) throw new Error('公共信息流模块版本不同，停止，未修改文件');
  new vm.Script(next);
  if (!next.includes('const HIDDEN_STATES = new Set(') || !next.includes("existing?.moderationStatus || 'public'")) throw new Error('补丁不是默认展示版本');
  return next;
}
const run = (cmd, args) => cp.execFileSync(cmd, args, { timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
async function verify() {
  for (let i = 0; i < 15; i++) {
    try {
      const health = await fetch('http://127.0.0.1:8787/api/v1/health', { signal: AbortSignal.timeout(1500) });
      const feed = await fetch('http://127.0.0.1:8787/api/v1/community/feed', { signal: AbortSignal.timeout(1500) });
      if (health.ok && feed.status === 401 && (await feed.json()).error?.code === 'UNAUTHORIZED') return;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 600));
  }
  throw new Error('服务健康或信息流鉴权验证未通过');
}
async function probe() {
  // In-memory policy verification only; no database, account or content writes.
  const { filterResult } = require('/opt/openelf-api/src/community.js');
  const rows = {
    'elf:e': { id: 'e', ownerId: 'u_probe', moderationStatus: 'pending' },
    'post:p': { id: 'p', elfId: 'e', moderationStatus: 'pending' },
    'post:h': { id: 'h', elfId: 'e', moderationStatus: 'hidden' },
  };
  const tx = { get: async (kind, id) => rows[kind + ':' + id] || null, list: async () => [] };
  const result = await filterResult(tx, { posts: [rows['post:p'], rows['post:h']] }, 'u_probe');
  if (result.posts.length !== 1 || result.posts[0].id !== 'p') throw new Error('默认展示/下架保护行为验证未通过');
}
async function main() {
  const mode = process.argv[2];
  if (!['--check', '--install'].includes(mode)) throw new Error('参数为 --check 或 --install');
  const file = '/opt/openelf-api/src/community.js';
  const feedFile = '/opt/openelf-api/src/public_feed.js';
  for (const target of ['/opt/openelf-api', '/opt/openelf-api/src', file, feedFile]) {
    if (fs.realpathSync(target) !== target) throw new Error('目标路径是软链接，停止');
  }
  const current = fs.readFileSync(file, 'utf8');
  const next = prepare(current, fs.readFileSync(path.join(__dirname, 'community.js'), 'utf8'), fs.readFileSync(feedFile, 'utf8'));
  console.log('默认展示预检通过：仅更新community.js；不改实名、支付、余额或数据库记录');
  console.log('旧pending/unreviewed不再阻止展示；保留下架、删除、私有、封禁、举报和个人屏蔽。不是审核通过或内容安全认证。');
  if (mode === '--check') return;
  if (current === next) { await verify(); await probe(); console.log('相同默认展示补丁已安装'); return; }
  run('systemctl', ['is-active', '--quiet', 'openelf-api']);
  const backup = fs.mkdtempSync('/opt/openelf-default-display-backup-'); fs.chmodSync(backup, 0o700);
  fs.writeFileSync(path.join(backup, 'community.js'), current, { mode: 0o600 });
  const stat = fs.statSync(file);
  const replace = source => {
    const tmp = file + '.display-' + process.pid;
    fs.writeFileSync(tmp, source, { mode: stat.mode & 0o777 });
    fs.chownSync(tmp, stat.uid, stat.gid); fs.renameSync(tmp, file);
  };
  try {
    replace(next); run('systemctl', ['restart', 'openelf-api']); await verify(); await probe();
    console.log('默认展示已启用；未修改任何内容的审核状态、资金或用户资料。备份：' + backup);
    console.log('现有build16可直接重新加载；历史pending标签仍会留存，不代表仍需审批。');
  } catch (_) {
    replace(current);
    try { run('systemctl', ['restart', 'openelf-api']); await verify(); }
    catch (_) { throw new Error('原模块已恢复，但服务恢复未确认。备份：' + backup); }
    throw new Error('安装未通过，已恢复原模块且服务健康。备份：' + backup);
  }
}
module.exports = { prepare, baseline, feedHash };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
