'use strict';
const fs = require('node:fs'), path = require('node:path');
const crypto = require('node:crypto'), cp = require('node:child_process');
const source = path.resolve(__dirname, '../../../app/build/web');
const out = path.resolve(process.argv[2] || '');
if (!process.argv[2] || fs.existsSync(out) || fs.existsSync(out + '.sha256')) throw Error('指定新的输出路径，禁止覆盖旧包');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const stage = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'openelf-web-recovery-20261102-'));
fs.cpSync(source, path.join(stage, 'site'), { recursive: true, errorOnExist: true, force: false });
for (const name of ['install.sh', 'README.md']) fs.copyFileSync(path.join(__dirname, name), path.join(stage, name), fs.constants.COPYFILE_EXCL);
const site = path.join(stage, 'site');
const release = 'web-recovery-20261102';
const js = fs.readFileSync(path.join(site, 'main.dart.js'), 'utf8')
  .replace(/\\u([0-9a-f]{4})|\\x([0-9a-f]{2})/gi, (_, u, x) => String.fromCharCode(parseInt(u || x, 16)));
for (const marker of ['https://openelfai.com', '/api/v1/web/alipay', '/api/v1/web/wallet',
  '/api/v1/platform/web-topup/products', '支付宝充值 · 请选择充值金额']) {
  if (!js.includes(marker)) throw Error('编译产物缺少业务标记：' + marker);
}
if (js.includes('暂无可用充值渠道')) throw Error('编译产物仍含充值关闭分支');
let index = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
if (!index.includes('auth-assets/captcha-bridge.js')) throw Error('验证码桥接缺失');
index = index.replace('src="flutter_bootstrap.js"', `src="flutter_bootstrap.js?v=${release}"`);
fs.writeFileSync(path.join(site, 'index.html'), index);
const bootstrap = fs.readFileSync(path.join(site, 'flutter_bootstrap.js'), 'utf8');
if (!bootstrap.includes('main.dart.js')) throw Error('未知bootstrap结构');
fs.writeFileSync(path.join(site, 'flutter_bootstrap.js'), bootstrap.replaceAll('main.dart.js', `main.dart.js?v=${release}`));
fs.writeFileSync(path.join(site, 'openelf-release.json'), JSON.stringify({
  release, version: '1.0.4', build: 22, api: 'https://openelfai.com',
  mainSha256: digest(fs.readFileSync(path.join(site, 'main.dart.js'))),
  features: ['web-diamond-recharge', 'web-api-topup', 'captcha-bridge', 'video-cdn'],
}) + '\n', { flag: 'wx' });
const sums = [];
function walk(dir, prefix = '') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isSymbolicLink()) throw Error('拒绝符号链接');
    if (entry.isDirectory()) walk(path.join(dir, entry.name), relative + '/');
    else sums.push(digest(fs.readFileSync(path.join(dir, entry.name))) + '  ' + relative);
  }
}
walk(stage);
fs.writeFileSync(path.join(stage, 'SHA256SUMS'), sums.sort().join('\n') + '\n', { flag: 'wx' });
const result = cp.spawnSync('tar', ['-czf', out, '-C', stage, 'site', 'install.sh', 'README.md', 'SHA256SUMS'], { encoding: 'utf8' });
if (result.error || result.status !== 0) throw Error('归档失败');
const hash = digest(fs.readFileSync(out));
fs.writeFileSync(out + '.sha256', hash + '  ' + path.basename(out) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ archive: out, bytes: fs.statSync(out).size, sha256: hash, stage }, null, 2));
