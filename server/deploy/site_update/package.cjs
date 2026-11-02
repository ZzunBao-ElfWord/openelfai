'use strict';
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const crypto = require('node:crypto');
const stage = path.resolve(process.argv[2] || '');
const output = path.resolve(process.argv[3] || '');
if (!process.argv[2] || !process.argv[3] || fs.existsSync(output) || fs.existsSync(output + '.sha256')) {
  throw Error('Specify prepared staging folder and NEW archive path; never overwrite a delivered package');
}
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const auth = fs.readFileSync(path.resolve(__dirname, '../../../web/public/console/auth/console-auth.js'));
for (const site of ['site', 'open']) {
  const html = fs.readFileSync(path.join(stage, site, 'console/index.html'), 'utf8');
  if (!html.includes('/console/auth/console-auth.js?v=20261102-source-v2') || !html.includes('beforeInteractive')) {
    throw Error('Compiled auth entry absent: ' + site);
  }
  if (!fs.readFileSync(path.join(stage, site, 'console/auth/console-auth.js')).equals(auth)) {
    throw Error('Stale compiled auth: ' + site);
  }
  // The open-site Nginx only serves /console/, /platform/, /docs/ etc.
  // A root-level release JSON is redirected to the main site, so verify under /console/.
  fs.writeFileSync(path.join(stage, site, 'console/openelf-site-release.json'), JSON.stringify({
    release: 'sites-console-20261102-r2', variant: site,
    domains: site === 'open' ? ['open.openelfai.com'] : ['openelfai.com', 'www.openelfai.com'],
    consoleAuthSha256: digest(auth), features: ['real-captcha', 'session-refresh', 'server-logout'],
  }) + '\n', { flag: 'wx' });
}
const hashes = {};
function walk(dir, prefix = '') {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.isSymbolicLink()) throw Error('Symlinks refused');
    const name = prefix + item.name;
    if (item.isDirectory()) walk(path.join(dir, item.name), name + '/');
    else if (item.isFile()) hashes[name] = digest(fs.readFileSync(path.join(dir, item.name)));
    else throw Error('Unknown file type');
  }
}
walk(stage);
fs.writeFileSync(path.join(stage, 'files.json'), JSON.stringify(hashes, null, 2) + '\n', { flag: 'wx' });
const archive = cp.spawnSync('tar', ['-czf', output, '-C', stage, 'site', 'open', 'install.cjs', 'README.md', 'files.json'], { encoding: 'utf8' });
if (archive.error || archive.status !== 0) throw Error(archive.stderr || 'Archive failed');
const hash = digest(fs.readFileSync(output));
fs.writeFileSync(output + '.sha256', hash + '  ' + path.basename(output) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, bytes: fs.statSync(output).size, sha256: hash, files: Object.keys(hashes).length }));
