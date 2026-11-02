'use strict';
// Only static sites + one explicit CORS origin. Never replace the production API tree.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const mode = process.argv[2];
const root = __dirname;
const apiFile = '/opt/openelf-api/src/app.js';
const targets = [
  ['site', '/var/www/openelf', 'openelfai.com'],
  ['open', '/var/www/openelf-open', 'open.openelfai.com'],
];
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
function run(command, args) {
  const result = cp.spawnSync(command, args, { encoding: 'utf8', timeout: 45000 });
  if (result.error || result.status !== 0) throw Error(command + ' failed: ' + (result.stderr || result.error || ''));
  return result.stdout.trim();
}
function safeDir(dir) {
  if (!fs.lstatSync(dir).isDirectory() || fs.lstatSync(dir).isSymbolicLink() || fs.realpathSync(dir) !== dir) {
    throw Error('Unsafe directory: ' + dir);
  }
}
function checkTree(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.isSymbolicLink()) throw Error('Symlink refused: ' + item.name);
    if (item.isDirectory()) checkTree(path.join(dir, item.name));
    else if (!item.isFile()) throw Error('Non-file refused');
  }
}
function curl(url, args = []) {
  return run('curl', ['--noproxy', '*', '-fsS', '--connect-timeout', '5', '--max-time', '20', ...args, url]);
}
function apiState() {
  const health = JSON.parse(curl('http://127.0.0.1:8787/api/v1/health'));
  if (!health || health.ok === false) throw Error('API health failed');
  const captcha = JSON.parse(curl('http://127.0.0.1:8787/api/v1/auth/captcha/config'));
  if (captcha.enabled !== true || captcha.mode !== 'enforce') throw Error('Captcha must remain enforce');
  for (const route of ['/api/v1/web/alipay/products', '/api/v1/android/alipay/products',
    '/api/v1/ios/products', '/api/v1/platform/web-topup/products']) {
    const response = run('curl', ['--noproxy', '*', '-sS', '--max-time', '10', '-w', '\n%{http_code}',
      'http://127.0.0.1:8787' + route]);
    const split = response.lastIndexOf('\n');
    if (response.slice(split + 1) !== '401' || JSON.parse(response.slice(0, split)).error?.code !== 'UNAUTHORIZED') {
      throw Error('Payment route changed: ' + route);
    }
  }
  return JSON.stringify(captcha);
}
function preflight(origin) {
  return curl('https://api.openelfai.com/api/v1/auth/send-code', ['-D', '-', '-o', '/dev/null', '-X', 'OPTIONS',
    '-H', 'Origin: ' + origin, '-H', 'Access-Control-Request-Method: POST',
    '-H', 'Access-Control-Request-Headers: content-type']);
}
async function main() {
  if (!['--check', '--install'].includes(mode)) throw Error('Use node install.cjs --check or --install');
  if (process.platform !== 'linux' || process.getuid() !== 0) throw Error('Linux root required');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'files.json'), 'utf8'));
  for (const [name, hash] of Object.entries(manifest)) {
    if (name.includes('..') || path.isAbsolute(name)) throw Error('Unsafe manifest path');
    if (digest(fs.readFileSync(path.join(root, name))) !== hash) throw Error('Package hash mismatch: ' + name);
  }
  for (const [source, target] of targets) {
    safeDir(target);
    if (!fs.existsSync(path.join(target, 'console/index.html'))) throw Error('Unknown site root: ' + target);
    checkTree(path.join(root, source));
    const html = fs.readFileSync(path.join(root, source, 'console/index.html'), 'utf8');
    if (!html.includes('/console/auth/console-auth.js?v=20261102-source-v2') || !html.includes('beforeInteractive')) {
      throw Error('Compiled login safety missing');
    }
    for (const asset of ['console-auth.js', 'web-captcha.js', 'ct4.js']) {
      if (!fs.statSync(path.join(root, source, 'console/auth', asset)).isFile()) throw Error('Missing auth asset');
    }
  }
  if (fs.lstatSync(apiFile).isSymbolicLink() || fs.realpathSync(apiFile) !== apiFile) throw Error('Unsafe API target');
  const original = fs.readFileSync(apiFile, 'utf8');
  const anchor = ".concat('https://web.openelfai.com')";
  const addition = ".concat('https://open.openelfai.com')";
  let patched = original;
  if (!original.includes(addition)) {
    if (original.split(anchor).length !== 2) throw Error('CORS anchor not unique; stop and return preflight output');
    patched = original.replace(anchor, anchor + '\n  ' + addition);
  }
  if (run('systemctl', ['is-active', 'openelf-api']) !== 'active') throw Error('API not active');
  const before = apiState();
  const originalHash = digest(original);
  console.log('Preflight passed: two sites, actual auth assets, payment authentication, captcha enforce.');
  console.log('Original app.js SHA256=' + originalHash);
  if (mode === '--check') { console.log('Read-only check complete. No SMS/orders/changes/restarts.'); return; }
  const backup = fs.mkdtempSync('/opt/openelf-sites-backup-');
  fs.chmodSync(backup, 0o700);
  fs.copyFileSync(apiFile, path.join(backup, 'app.js'));
  const switched = [];
  let apiChanged = false;
  try {
    if (digest(fs.readFileSync(apiFile)) !== originalHash) throw Error('Concurrent API change; stopped');
    if (patched !== original) {
      const tempApi = path.join(path.dirname(apiFile), '.openelf-cors-' + Date.now() + '.js');
      fs.writeFileSync(tempApi, patched, { flag: 'wx', mode: fs.statSync(apiFile).mode });
      run(process.execPath, ['--check', tempApi]);
      fs.renameSync(tempApi, apiFile); apiChanged = true;
      run('systemctl', ['restart', 'openelf-api']);
      let ready = false;
      for (let attempt = 0; attempt < 15; attempt++) {
        try { if (apiState() === before) { ready = true; break; } } catch (_) {}
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      if (!ready) throw Error('API validation failed');
    }
    for (const [source, target, domain] of targets) {
      const stage = fs.mkdtempSync('/var/www/openelf-site-stage-');
      fs.cpSync(path.join(root, source), stage, { recursive: true });
      // Preserve production ACME/app-association files; never replace certificate configuration.
      if (fs.existsSync(path.join(target, '.well-known'))) {
        checkTree(path.join(target, '.well-known'));
        fs.cpSync(path.join(target, '.well-known'), path.join(stage, '.well-known'), { recursive: true });
      }
      run('chmod', ['-R', 'u=rwX,go=rX', stage]);
      const old = path.join(backup, source);
      fs.renameSync(target, old);
      switched.push({ target, old });
      fs.renameSync(stage, target);
      for (const asset of ['console/index.html', 'console/auth/console-auth.js',
        'console/auth/web-captcha.js', 'console/auth/ct4.js', 'openelf-site-release.json']) {
        const bytes = cp.spawnSync('curl', ['--noproxy', '*', '-fsS', '--connect-timeout', '5', '--max-time', '20',
          '--resolve', domain + ':443:127.0.0.1', 'https://' + domain + '/' + asset + '?verify=sites-20261102-r1'],
        { timeout: 25000, maxBuffer: 8 * 1024 * 1024 });
        if (bytes.error || bytes.status !== 0 || digest(bytes.stdout) !== digest(fs.readFileSync(path.join(root, source, asset)))) {
          throw Error('HTTPS site verification failed: ' + domain + '/' + asset);
        }
      }
    }
    const allowed = preflight('https://open.openelfai.com');
    if (!/access-control-allow-origin:\s*https:\/\/open\.openelfai\.com\s*\r?$/im.test(allowed)) throw Error('CORS still blocked');
    if (/access-control-allow-origin:/i.test(preflight('https://untrusted.example'))) throw Error('Untrusted origin allowed');
    if (apiState() !== before) throw Error('Captcha configuration changed');
    console.log('Installed and verified both websites + exact CORS origin. Backup: ' + backup);
    console.log('No env/keys/database/Nginx/mobile packages/payment flags changed. No SMS, orders or chain calls.');
  } catch (error) {
    for (const { target, old } of switched.reverse()) {
      if (fs.existsSync(target)) fs.renameSync(target, fs.mkdtempSync('/var/www/openelf-site-failed-') + '/site');
      fs.renameSync(old, target);
    }
    if (apiChanged) { fs.copyFileSync(path.join(backup, 'app.js'), apiFile); run('systemctl', ['restart', 'openelf-api']); }
    console.error('Rolled back. Preserved backup: ' + backup);
    throw error;
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
