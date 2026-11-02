'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const out = path.resolve(process.argv[2] || '');
if (!process.argv[2] || fs.existsSync(out)) throw Error('需要新的输出压缩包路径，禁止覆盖旧包');
const stage = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'openelf-video-cdn-stage-'));
fs.mkdirSync(path.join(stage, 'payload'));
const files = [
  [path.join(__dirname, 'install.cjs'), 'install.cjs'],
  [path.join(__dirname, 'README.md'), 'README.md'],
  [path.resolve(__dirname, '../../src/video_delivery.js'), 'payload/video_delivery.js'],
];
const sums = [];
for (const [source, relative] of files) {
  const bytes = fs.readFileSync(source);
  fs.writeFileSync(path.join(stage, relative), bytes, { flag: 'wx' });
  sums.push(crypto.createHash('sha256').update(bytes).digest('hex') + '  ' + relative);
}
fs.writeFileSync(path.join(stage, 'SHA256SUMS'), sums.join('\n') + '\n', { flag: 'wx' });
const tar = cp.spawnSync('tar', ['-czf', out, '-C', stage, 'install.cjs', 'README.md', 'payload/video_delivery.js', 'SHA256SUMS'],
  { encoding: 'utf8' });
if (tar.error || tar.status !== 0) throw Error('归档失败');
const digest = crypto.createHash('sha256').update(fs.readFileSync(out)).digest('hex');
fs.writeFileSync(out + '.sha256', digest + '  ' + path.basename(out) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ archive: out, bytes: fs.statSync(out).size, sha256: digest, stage }, null, 2));
