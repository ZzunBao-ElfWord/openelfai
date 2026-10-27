'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const entry = '/opt/openelf-api/src/app.js';
const modulePath = '/opt/openelf-api/src/account_deletion.js';
const source = fs.readFileSync(path.join(__dirname, 'account_deletion.js'));
const marker = "  require('./account_deletion').registerAccountDeletion(app, { db, authenticate });";
const anchor = '  async function ensureUser(phone) {';
const original = fs.readFileSync(entry, 'utf8');
const previousModuleSha256 = '0643c9992edf58580fefea3bcfd613910483d5ef963a09626a6dd813342423ad';
if (!original.includes('async function authenticate(request)') || original.split(anchor).length !== 2) throw new Error('未知鉴权入口，停止，未覆盖');
if (fs.existsSync(modulePath) && !fs.readFileSync(modulePath).equals(source)) {
  const existingHash = crypto.createHash('sha256').update(fs.readFileSync(modulePath)).digest('hex');
  if (existingHash !== previousModuleSha256) throw new Error('已有未知注销模块，停止，未覆盖');
}
if (original.includes('/api/v1/auth/delete-account') && !original.includes(marker)) throw new Error('已有注销路由，停止，未覆盖');
const updated = original.includes(marker) ? original : original.replace(anchor, marker + '\n\n' + anchor);
if (!process.argv.includes('--install')) {
  console.log('注销V2增量安装预检通过；未修改代码、账号、配置或数据库');
  process.exit(0);
}
if (process.getuid() !== 0) throw new Error('请在服务器使用 root 执行');
const backup = fs.mkdtempSync('/opt/openelf-account-deletion-backup-');
fs.copyFileSync(entry, path.join(backup, 'app.js'));
const existed = fs.existsSync(modulePath);
if (existed) fs.copyFileSync(modulePath, path.join(backup, 'account_deletion.js'));
const temporary = entry + '.account-deletion.js';
try {
  fs.writeFileSync(modulePath, source, { mode: 0o644 });
  fs.writeFileSync(temporary, updated, { mode: fs.statSync(entry).mode });
  cp.execFileSync(process.execPath, ['--check', temporary], { stdio: 'inherit' });
  fs.renameSync(temporary, entry);
  cp.execFileSync('systemctl', ['restart', 'openelf-api']);
  let ready = false;
  for (let i = 0; i < 20; i++) {
    try {
      cp.execFileSync('curl', ['-fsS', 'http://127.0.0.1:8787/api/v1/health'], { stdio: 'ignore' });
      const status = cp.execFileSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '-X', 'POST',
        '-H', 'Content-Type: application/json', '-d', '{}', 'http://127.0.0.1:8787/api/v1/auth/delete-account'], { encoding: 'utf8' });
      if (status !== '401') throw new Error('注销接口必须要求登录');
      ready = true; break;
    } catch (_) { cp.execFileSync('sleep', ['1']); }
  }
  if (!ready) throw new Error('启动验收失败');
  console.log('账号注销接口安装完成，未登录返回401。备份：' + backup);
  console.log('未注销任何账号；未改支付、验证码、环境文件或数据库结构。需安装配套新客户端。');
} catch (error) {
  fs.copyFileSync(path.join(backup, 'app.js'), entry);
  if (existed) fs.copyFileSync(path.join(backup, 'account_deletion.js'), modulePath);
  else if (fs.existsSync(modulePath)) fs.unlinkSync(modulePath);
  if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  cp.execFileSync('systemctl', ['restart', 'openelf-api']);
  throw error;
}
