'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const cp = require('node:child_process');
const { applyResourceDelta } = require('./asset-delta.cjs');
function once(source, before, after) {
  if (source.includes(after)) return source;
  if (source.split(before).length !== 2) throw new Error('目标代码与已核对版本不同，停止增量安装；匹配点：' + before.split('\n')[0].trim().slice(0, 120));
  return source.replace(before, after);
}
function prepare(input) {
  let app = once(input.app, "const { createCommerceService } = require('./commerce');",
    "const { createCommerceService } = require('./commerce');\nconst { wrapStore, registerCommunity } = require('./community');");
  app = once(app, '  const paymentStore = options.paymentStore || createPaymentStore(db);',
    '  const communityReviewStore = options.paymentStore || createPaymentStore(db);\n  const paymentStore = wrapStore(communityReviewStore);');
  const registration = "  registerCommunity(app, { store: paymentStore, reviewStore: communityReviewStore,\n    authenticate, reviewToken: process.env.COMMUNITY_REVIEW_TOKEN || '' });";
  if (!app.includes(registration)) {
    const deletionRegistration = "  require('./account_deletion').registerAccountDeletion(app, { db, authenticate });";
    if (app.includes(deletionRegistration)) app = once(app, deletionRegistration, deletionRegistration + '\n' + registration);
    else {
      // Confirmed production OCR adapter variant: do not invent a deletion route.
      if (app.split('  async function authenticate(request) {').length !== 2) throw new Error('认证函数不是已核对的声明形式，停止安装');
      app = once(app, '  async function ensureUser(phone) {', registration + '\n\n  async function ensureUser(phone) {');
    }
  }
  let commerce = once(input.commerce, '      return { channel, sort, page, size, posts, elves,',
    '      return { communityViewer: user.id, channel, sort, page, size, posts, elves,');
  commerce = once(commerce, '      for (const elf of due) {',
    "      for (const elf of due) {\n        // Content restrictions do not alter ownership, balances or withdrawals.\n        if ((await tx.get('community_sanction', 'elf:' + elf.id))?.active ||\n            (await tx.get('community_sanction', 'user:' + elf.ownerId))?.active) continue;");
  let deletion = input.deletion;
  const match = deletion.match(/const PERSONAL_KINDS = \[[\s\S]*?\];/g);
  if (match?.length !== 1) throw new Error('未找到已核对的注销清理列表');
  if (!match[0].includes("'community_block'")) deletion = deletion.replace(match[0], match[0].replace(/\];$/, ",\n  'community_block', 'community_terms', 'community_report', 'community_queue'];"));
  const output = applyResourceDelta({ ...input, app, commerce, deletion });
  for (const source of Object.values(output)) new vm.Script(source);
  return output;
}
const run = (cmd, args, timeout = 20000) => cp.execFileSync(cmd, args, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] });
function healthy() {
  for (let i = 0; i < 10; i++) {
    try { run('curl', ['--noproxy', '*', '-fsS', '--max-time', '2', 'http://127.0.0.1:8787/api/v1/health']); return; }
    catch (_) { if (i < 9) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000); }
  }
  throw new Error('服务健康检查失败');
}
async function verify(token) {
  const base = 'http://127.0.0.1:8787';
  if ((await fetch(base + '/api/v1/community', { signal: AbortSignal.timeout(5000) })).status !== 401) throw new Error('安全入口认证检查失败');
  const response = await fetch(base + '/internal/community/review', { method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(5000) });
  if (response.status !== 400 || (await response.json()).error?.code !== 'INVALID_REVIEW') throw new Error('审核权限检查失败');
  console.log('入口与审核权限验证通过；未提交举报、未批准内容、未登录账号');
}
async function main() {
  const mode = process.argv[2];
  if (!['--check', '--install'].includes(mode)) throw new Error('使用 --check 或 --install');
  const root = '/opt/openelf-api';
  const files = { app: root + '/src/app.js', commerce: root + '/src/commerce.js',
    deletion: root + '/src/account_deletion.js', gateway: root + '/src/alipay_gateway.js' };
  const envFile = '/etc/openelf-api.env';
  for (const file of [root, ...Object.values(files), envFile]) if (fs.realpathSync(file) !== file) throw new Error('路径是软链接，停止安装');
  const input = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')]));
  const output = prepare(input);
  const modules = ['community.js', 'resource_policy.js'].map(name => ({
    file: root + '/src/' + name, source: fs.readFileSync(path.join(__dirname, name), 'utf8') }));
  for (const module of modules) {
    new vm.Script(module.source);
    if (fs.existsSync(module.file) && fs.readFileSync(module.file, 'utf8') !== module.source) throw new Error('已有未知安全/资源模块，停止覆盖');
  }
  const envSource = fs.readFileSync(envFile, 'utf8');
  const hasToken = /^\s*(?:export\s+)?COMMUNITY_REVIEW_TOKEN\s*=/m.test(envSource);
  if (hasToken && (!process.env.COMMUNITY_REVIEW_TOKEN || process.env.COMMUNITY_REVIEW_TOKEN.length < 32)) throw new Error('现有审核令牌未加载或不足32位，请使用 node --env-file=/etc/openelf-api.env');
  console.log('内容安全、站内资源、沙盒出款隔离与语法预检通过；不发起付款或迁移现有余额');
  console.log('注意：新内容与尚未审核的旧内容均不公开，需人工处理审核队列。');
  if (!input.app.includes("require('./account_deletion').registerAccountDeletion")) console.log('注意：未发现模块式注销注册，保留现有注销逻辑；其新社区数据清理能力仍需另行核验。');
  if (mode === '--check') return;
  const token = hasToken ? process.env.COMMUNITY_REVIEW_TOKEN : crypto.randomBytes(32).toString('hex');
  const envOutput = hasToken ? envSource : envSource.replace(/\s*$/, '') + '\nCOMMUNITY_REVIEW_TOKEN=' + token + '\n';
  if (Object.keys(files).every(key => output[key] === input[key]) && modules.every(module => fs.existsSync(module.file)) && hasToken) {
    healthy(); await verify(token); console.log('相同补丁已安装'); return;
  }
  run('systemctl', ['is-active', '--quiet', 'openelf-api']);
  const backup = fs.mkdtempSync('/opt/openelf-community-backup-'); fs.chmodSync(backup, 0o700);
  for (const file of [...Object.values(files), envFile]) {
    fs.copyFileSync(file, path.join(backup, path.basename(file)));
    fs.chmodSync(path.join(backup, path.basename(file)), 0o600);
  }
  const replace = (file, value) => {
    const stat = fs.existsSync(file) ? fs.statSync(file) : fs.statSync(files.app);
    const temporary = file + '.community-' + process.pid;
    fs.writeFileSync(temporary, value, { mode: stat.mode & 0o777 });
    fs.chownSync(temporary, stat.uid, stat.gid); fs.renameSync(temporary, file);
  };
  console.log('备份（含敏感配置，请勿外传）：' + backup);
  try {
    for (const module of modules) replace(module.file, module.source);
    for (const [key, file] of Object.entries(files)) replace(file, output[key]);
    if (!hasToken) replace(envFile, envOutput);
    run('systemctl', ['restart', 'openelf-api'], 60000); healthy(); await verify(token);
    console.log('内容安全补丁安装成功；审核令牌仅保存在服务器环境文件，不打印、不发送到客户端');
  } catch (_) {
    for (const [key, file] of Object.entries(files)) replace(file, input[key]);
    replace(envFile, envSource);
    // An unreferenced new module is retained, not destructively removed.
    try { run('systemctl', ['restart', 'openelf-api'], 60000); healthy(); }
    catch (_) { throw new Error('原配置已恢复，但服务恢复未确认；请检查 openelf-api。备份：' + backup); }
    throw new Error('部署未通过，已恢复原代码和环境且服务健康。备份：' + backup);
  }
}
module.exports = { prepare };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
