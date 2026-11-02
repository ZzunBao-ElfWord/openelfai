'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const cp = require('node:child_process');
const baseline = 'fc20271ef6a4ea6030cf423170e6c2573d7158b9f3805e9ca8d276b0295a17ef';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function prepare(current, next, existingFeed, nextFeed) {
  if (hash(current) !== baseline && current !== next) throw new Error('线上内容安全模块不是已核对的v2版本，停止，未修改文件');
  if (existingFeed != null && existingFeed !== nextFeed) throw new Error('已存在未知公共信息流模块，停止覆盖');
  for (const source of [next, nextFeed]) new vm.Script(source);
  if (!next.includes("app.get('/api/v1/community/feed'")) throw new Error('压缩包缺少公共内容接口');
  return { 'community.js': next, 'public_feed.js': nextFeed };
}
const run = (cmd, args) => cp.execFileSync(cmd, args, { timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
async function verify() {
  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      const health = await fetch('http://127.0.0.1:8787/api/v1/health', { signal: AbortSignal.timeout(1500) });
      const feed = await fetch('http://127.0.0.1:8787/api/v1/community/feed', { signal: AbortSignal.timeout(1500) });
      if (health.ok && feed.status === 401 && (await feed.json()).error?.code === 'UNAUTHORIZED') return;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 600));
  }
  throw new Error('公共信息流接口或服务健康检查未通过');
}
async function main() {
  const mode = process.argv[2];
  if (!['--check', '--install'].includes(mode)) throw new Error('参数为 --check 或 --install');
  const root = '/opt/openelf-api/src';
  for (const file of ['/opt/openelf-api', root, root + '/community.js', root + '/commerce.js', root + '/resource_policy.js']) {
    if (fs.realpathSync(file) !== file) throw new Error('目标路径是软链接，停止');
  }
  const originals = {};
  for (const name of ['community.js', 'public_feed.js']) {
    const file = root + '/' + name;
    if (fs.existsSync(file) && fs.realpathSync(file) !== file) throw new Error('模块路径是软链接，停止');
    originals[name] = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  }
  const next = prepare(originals['community.js'], fs.readFileSync(path.join(__dirname, 'community.js'), 'utf8'),
    originals['public_feed.js'], fs.readFileSync(path.join(__dirname, 'public_feed.js'), 'utf8'));
  console.log('公共信息流升级预检通过；仅更新community.js和public_feed.js，不改实名、CORS、支付配置或余额');
  console.log('未审核内容仍不公开；没有自动导入演示帖子或批量批准内容。客户端需升级build16。');
  if (mode === '--check') return;
  if (Object.entries(next).every(([name, source]) => originals[name] === source)) {
    await verify(); console.log('相同公共信息流补丁已安装'); return;
  }
  run('systemctl', ['is-active', '--quiet', 'openelf-api']);
  const backup = fs.mkdtempSync('/opt/openelf-public-feed-backup-'); fs.chmodSync(backup, 0o700);
  for (const [name, source] of Object.entries(originals)) if (source != null) {
    fs.writeFileSync(path.join(backup, name), source, { mode: 0o600 });
  }
  const originalStat = fs.statSync(root + '/community.js');
  const replace = (name, source) => {
    const file = root + '/' + name;
    const tmp = file + '.feed-' + process.pid;
    fs.writeFileSync(tmp, source, { mode: originalStat.mode & 0o777 });
    fs.chownSync(tmp, originalStat.uid, originalStat.gid); fs.renameSync(tmp, file);
  };
  try {
    for (const [name, source] of Object.entries(next)) replace(name, source);
    run('systemctl', ['restart', 'openelf-api']); await verify();
    console.log('公共信息流接口已生效；未登录账号、未发短信、未发起付款或审批内容。备份：' + backup);
  } catch (_) {
    for (const [name, source] of Object.entries(originals)) if (source != null) replace(name, source);
    try { run('systemctl', ['restart', 'openelf-api']); }
    catch (_) { throw new Error('已恢复原模块，但服务恢复未确认；备份：' + backup); }
    const health = await fetch('http://127.0.0.1:8787/api/v1/health', { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (!health?.ok) throw new Error('已恢复原模块，但服务恢复未确认；备份：' + backup);
    throw new Error('升级未通过，原模块已恢复且服务健康；未引用的新模块保留。备份：' + backup);
  }
}
module.exports = { prepare, baseline };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
