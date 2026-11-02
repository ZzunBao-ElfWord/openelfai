'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const TAG = "  require('./push_routes').registerPush(app, { db, authenticate });";
const INTEGRATED = "  require('./push_routes').registerPush(app, { db, authenticate,\n    settings: options.pushSettings, fetchImpl: options.pushFetch });";
const ANCHOR = '  async function ensureUser(phone) {';
const LEGACY_PUSH = '314d881a5af8bc2d2caec26759853ed5ef940d2827db5e3d60c3a5d7575cffa7';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sourceHash = bytes => hash(bytes.toString('utf8').replace(/\r\n/g, '\n'));
function prepare(source) {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const markers = [TAG, INTEGRATED.replace(/\n/g, eol)];
  if (markers.some(marker => source.includes(marker))) {
    if ((source.match(/registerPush\(/g) || []).length !== 1) throw Error('推送注册重复，停止');
    return source;
  }
  if (/registerPush|createPushService|require\(['"].*push/.test(source)) throw Error('发现未知推送注册，停止覆盖');
  if (!source.includes('async function authenticate(request)') || source.split(ANCHOR).length !== 2)
    throw Error('鉴权入口或插入位置与预期不符，停止修改');
  return source.replace(ANCHOR, TAG + eol + eol + ANCHOR);
}
function run(exe, args) {
  const r = cp.spawnSync(exe, args, { encoding: 'utf8', timeout: 30000 });
  if (r.error || r.status !== 0) throw Error('命令执行失败：' + exe + '；不输出日志以避免泄露配置');
  return r.stdout.trim();
}
function safeFile(file) {
  if (!fs.existsSync(file)) return null;
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('目标不是普通文件，停止：' + file);
  return { bytes: fs.readFileSync(file), mode: stat.mode & 0o777, uid: stat.uid, gid: stat.gid };
}
function configStatus() {
  const env = {};
  if (fs.existsSync('/etc/openelf-api.env')) {
    for (const line of fs.readFileSync('/etc/openelf-api.env', 'utf8').split(/\r?\n/)) {
      const match = /^\s*(JPUSH_[A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (!match) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      env[match[1]] = value;
    }
  }
  const present = key => Boolean(env[key]?.trim());
  const matches = (key, expected) => present(key) && env[key] === expected;
  console.log(JSON.stringify({ environmentFile: '/etc/openelf-api.env',
    enabled: /^(true|1)$/i.test(env.JPUSH_ENABLED || ''),
    androidAppKeyPresent: present('JPUSH_ANDROID_APP_KEY'),
    androidAppKeyMatchesClient: matches('JPUSH_ANDROID_APP_KEY', '3439c18b0c3021ae5e29ba92'),
    androidMasterSecretPresent: present('JPUSH_ANDROID_MASTER_SECRET'),
    iosAppKeyPresent: present('JPUSH_IOS_APP_KEY'),
    iosAppKeyMatchesClient: matches('JPUSH_IOS_APP_KEY', '26cb5da674a8da5e9aa0128d'),
    iosMasterSecretPresent: present('JPUSH_IOS_MASTER_SECRET'),
    adminTokenPresent: present('JPUSH_ADMIN_TOKEN'),
    adminTokenLongEnough: (env.JPUSH_ADMIN_TOKEN || '').length >= 32,
    note: '仅输出配置存在/匹配状态；未输出密钥；APNs证书需在极光后台单独核验。',
  }, null, 2));
}
function routeStatus(route) {
  return run('curl', ['--noproxy', '*', '-sS', '--connect-timeout', '3', '--max-time', '8',
    '-o', '/dev/null', '-w', '%{http_code}', '-X', 'POST',
    '-H', 'Content-Type: application/json', '--data', '{}', 'http://127.0.0.1:8787' + route]);
}
function ready() {
  if (routeStatus('/api/v1/push/bind') !== '401' || routeStatus('/api/v1/push/unbind') !== '401' ||
      routeStatus('/api/v1/internal/push/send') !== '403') throw Error('推送入口或发送鉴权检查未通过');
}
function main() {
  const mode = process.argv[2];
  if (!['--check', '--install'].includes(mode)) throw Error('用法：node install.cjs --check 或 --install');
  if (process.platform !== 'linux' || process.getuid() !== 0) throw Error('请在Debian服务器使用root执行');
  const root = '/opt/openelf-api';
  for (const folder of [root, path.join(root, 'src')]) {
    if (fs.lstatSync(folder).isSymbolicLink() || fs.realpathSync(folder) !== folder)
      throw Error('服务目录为链接，停止');
  }
  const payload = fs.existsSync(path.join(__dirname, 'payload'))
    ? path.join(__dirname, 'payload') : path.resolve(__dirname, '../../src');
  const files = ['push.js', 'push_routes.js'];
  const changes = [];
  for (const name of files) {
    const next = fs.readFileSync(path.join(payload, name));
    run(process.execPath, ['--check', path.join(payload, name)]);
    const target = path.join(root, 'src', name), old = safeFile(target);
    if (old && sourceHash(old.bytes) !== sourceHash(next) &&
        !(name === 'push.js' && sourceHash(old.bytes) === LEGACY_PUSH))
      throw Error('服务器存在未知推送模块版本，停止覆盖：' + name);
    if (!old || !old.bytes.equals(next)) changes.push({ target, old, next });
  }
  const entry = path.join(root, 'src/app.js'), oldEntry = safeFile(entry);
  if (!oldEntry) throw Error('缺少app.js');
  const nextEntry = Buffer.from(prepare(oldEntry.bytes.toString('utf8')));
  if (!oldEntry.bytes.equals(nextEntry)) changes.push({ target: entry, old: oldEntry, next: nextEntry });
  configStatus();
  console.log('增量预检通过：仅添加推送模块和注册语句；不改环境文件、支付、实名或CORS。');
  if (mode === '--check') { console.log('只读检查结束，未修改文件或数据库、未重启、未发送推送。'); return; }
  if (!changes.length) { ready(); console.log('代码已安装，推送路由鉴权正常；未发送通知。'); return; }
  if (run('systemctl', ['is-active', 'openelf-api.service']) !== 'active') throw Error('服务原本未运行，停止安装');
  const backup = fs.mkdtempSync('/opt/openelf-push-backup-'); fs.chmodSync(backup, 0o700);
  for (const item of changes) if (item.old) fs.writeFileSync(path.join(backup, path.basename(item.target)), item.old.bytes, { mode: 0o600, flag: 'wx' });
  fs.writeFileSync(path.join(backup, 'manifest.json'), JSON.stringify(changes.map(item => ({
    target: item.target, existed: Boolean(item.old), oldSha256: item.old ? hash(item.old.bytes) : null,
    installedSha256: hash(item.next),
  })), null, 2), { mode: 0o600, flag: 'wx' });
  console.log('原文件备份：' + backup);
  const written = [];
  try {
    for (const item of changes) {
      const current = safeFile(item.target);
      if ((item.old && (!current || !current.bytes.equals(item.old.bytes))) || (!item.old && current))
        throw Error('目标文件发生并发改动，停止');
      const staged = item.target + '.push-' + crypto.randomUUID() + '.cjs';
      fs.writeFileSync(staged, item.next, { mode: item.old?.mode || 0o644, flag: 'wx' });
      if (item.old) fs.chownSync(staged, item.old.uid, item.old.gid);
      run(process.execPath, ['--check', staged]);
      fs.renameSync(staged, item.target); written.push(item);
    }
    run('systemctl', ['restart', 'openelf-api.service']);
    let success = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      try { ready(); success = true; break; } catch (_) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 700);
      }
    }
    if (!success) throw Error('推送路由检查失败');
    console.log('推送接口已部署，匿名绑定/解绑401、未授权发送403；未登录、未创建设备记录、未发送通知。');
    console.log('保留原有开关和密钥；路由存在不代表配置完整或真机已收到通知。');
  } catch (_) {
    for (const item of written.reverse()) {
      const current = safeFile(item.target);
      if (!current || !current.bytes.equals(item.next)) throw Error('发现并发改动，未强制回滚；请检查备份：' + backup);
      if (item.old) {
        const staged = item.target + '.rollback-' + crypto.randomUUID();
        fs.writeFileSync(staged, item.old.bytes, { mode: item.old.mode, flag: 'wx' });
        fs.chownSync(staged, item.old.uid, item.old.gid); fs.renameSync(staged, item.target);
      } else fs.unlinkSync(item.target); // Only the exact new files written above.
    }
    try { run('systemctl', ['restart', 'openelf-api.service']); }
    catch (_) { throw Error('原文件已恢复，但服务重启失败；检查：' + backup); }
    throw Error('安装检查失败，已恢复原文件并重启；备份：' + backup);
  }
}
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { prepare, TAG, ANCHOR };
