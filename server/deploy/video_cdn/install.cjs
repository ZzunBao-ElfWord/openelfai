'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const ROOT = '/opt/openelf-api/src';
const SERVICE = 'openelf-api.service';
const IMPORT = "const { videoDeliveryUrl } = require('./video_delivery');";
const SAMPLE = '/api/v1/world-assets/videos/doubao-2026-10-28-26330b01.mp4';
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
function once(s, from, to) {
  if (s.split(from).length !== 2) throw Error('补丁锚点不唯一或版本不匹配，停止；请回传预检结果');
  return s.replace(from, to);
}
function prepare(name, input) {
  const eol = input.includes('\r\n') ? '\r\n' : '\n';
  let s = input.replace(/\r\n/g, '\n');
  // Exact deployed legacy version supplied by the user. Do not add/remove its
  // moderation checks or review state during this unrelated CDN deployment.
  const legacyReturn = '      return { post };';
  const legacyNext = '      return { post: { ...post, videoUrl: videoDeliveryUrl(post.videoUrl) } };';
  if (name === 'world_uploads.js' && (s.includes(legacyReturn) || s.includes(legacyNext))) {
    const installed = s.includes(legacyNext);
    const original = installed ? once(once(s, IMPORT + '\n', ''), legacyNext, legacyReturn) : s;
    if (hash(original) !== 'c565ca47ba239f1aacc56a0261114716274ee0003620d23e0f8501462ef6e79e')
      throw Error('旧上传模块不是已核对的线上版本，停止覆盖');
    if (installed) return input;
    return once(once(original, legacyReturn, legacyNext),
      "const crypto = require('node:crypto');", "const crypto = require('node:crypto');\n" + IMPORT).replace(/\n/g, eol);
  }
  const anchor = name === 'commerce.js' ? 'function normalizePost(post) {'
    : name === 'world_uploads.js' ? "      return { post, reviewState: 'pending_review' };"
    : name === 'world_videos.js' ? "      await tx.put('elf', ELF_ID, elf, { owner: null });\n      return post;" : null;
  if (!anchor) throw Error('未知补丁目标');
  const next = name === 'commerce.js'
    ? anchor + "\n  // Work on a response copy: never migrate database URLs during a feed read.\n  post = { ...post };\n  if (post.kind === 'video') post.videoUrl = videoDeliveryUrl(post.videoUrl);"
    : name === 'world_uploads.js'
    ? "      return { post: { ...post, videoUrl: videoDeliveryUrl(post.videoUrl) }, reviewState: 'pending_review' };"
    : "      await tx.put('elf', ELF_ID, elf, { owner: null });\n      return { ...post, videoUrl: videoDeliveryUrl(post.videoUrl) };";
  if (s.includes('videoDeliveryUrl')) {
    if (s.split(IMPORT).length !== 2 || s.split(next).length !== 2 ||
        (s.match(/videoDeliveryUrl/g) || []).length !== 2) throw Error('存在未知或不完整的CDN改动，停止覆盖');
    return input;
  }
  s = once(s, anchor, next);
  const cryptoLine = name === 'world_videos.js' ? "const crypto = require('crypto');" : "const crypto = require('node:crypto');";
  return once(s, cryptoLine, cryptoLine + '\n' + IMPORT).replace(/\n/g, eol);
}
function run(exe, args) {
  const r = cp.spawnSync(exe, args, { encoding: 'utf8', timeout: 45000 });
  if (r.error || r.status !== 0) throw Error('检查/命令失败：' + path.basename(exe) + '；不输出配置日志');
  return r.stdout.trim();
}
function checkSyntax(bytes) {
  const r = cp.spawnSync(process.execPath, ['--check', '--input-type=commonjs'],
    { input: bytes, encoding: 'utf8', timeout: 10000 });
  if (r.error || r.status !== 0) throw Error('增量结果语法检查失败，未修改线上文件');
}
function read(file, optional = false) {
  if (optional && !fs.existsSync(file)) return null;
  const st = fs.lstatSync(file);
  if (!st.isFile() || st.isSymbolicLink() || fs.realpathSync(file) !== file) throw Error('文件路径异常：' + file);
  return { bytes: fs.readFileSync(file), mode: st.mode & 0o777, uid: st.uid, gid: st.gid };
}
function replace(file, bytes, old) {
  const temp = file + '.cdn-' + crypto.randomUUID() + '.cjs';
  try {
    fs.writeFileSync(temp, bytes, { mode: old?.mode || 0o644, flag: 'wx' });
    if (old) fs.chownSync(temp, old.uid, old.gid);
    run(process.execPath, ['--check', temp]);
    fs.renameSync(temp, file);
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
async function json(url) {
  const r = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw Error('运行接口检查失败');
  return r.json();
}
async function state() {
  const h = await json('http://127.0.0.1:8787/api/v1/health');
  const c = await json('http://127.0.0.1:8787/api/v1/auth/captcha/config');
  if (h.ok !== true || c.enabled !== true || c.mode !== 'enforce') throw Error('健康检查或强制验证码不符合预期，停止');
  return { enabled: c.enabled, mode: c.mode, appId: c.appId, platform: c.platform };
}
async function verifyVideo() {
  const r = await fetch('https://media.openelfai.com' + SAMPLE, {
    headers: { Range: 'bytes=0-1023' }, redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  if (r.status !== 206 || r.headers.get('content-type')?.split(';')[0] !== 'video/mp4' ||
      !/^bytes 0-1023\/\d+$/.test(r.headers.get('content-range') || '') || r.headers.get('content-length') !== '1024') {
    await r.body?.cancel(); throw Error('CDN证书/视频Range预检失败，未切换地址');
  }
  if ((await r.arrayBuffer()).byteLength !== 1024) throw Error('CDN分段读取不完整');
}
async function verifyMapping(root) {
  const { videoDeliveryUrl } = require(path.join(root, 'video_delivery.js'));
  const original = 'https://openelfai.com' + SAMPLE, cdn = 'https://media.openelfai.com' + SAMPLE;
  if (videoDeliveryUrl(original) !== cdn || videoDeliveryUrl(original, false) !== original ||
      videoDeliveryUrl(original + '?token=private') !== original + '?token=private') throw Error('CDN映射自检失败');
  const post = { id: 'cdn-precheck', elfId: 'cdn-precheck', kind: 'video', videoUrl: original };
  const deny = () => { throw Error('部署自检禁止数据库写入'); };
  const service = require(path.join(root, 'commerce.js')).createCommerceService({
    settings: { enabled: true, allowSandbox: false, sandboxOnly: false },
    store: { transaction: async (env, work) => {
      if (env !== 'Production') throw Error('错误环境');
      return work({ list: async kind => kind === 'post' ? [post] : [], get: async () => null,
        put: deny, lockWallet: deny, saveWallet: deny });
    } },
  });
  const result = await service.listFeed({ id: 'cdn-precheck' }, { channel: 'video', environment: 'Production' });
  if (result.posts[0]?.videoUrl !== cdn || post.videoUrl !== original) throw Error('信息流只读映射自检失败');
}
function protectedSnapshot() {
  return ['app.js', 'config.js', 'captcha.js', 'web_captcha.js', 'payment_store.js', 'alipay.js',
    'apple_iap.js', 'platform/web_topup.js', 'platform/web_diamonds.js', '/etc/openelf-api.env'].map(name => {
    const file = name.startsWith('/') ? name : path.join(ROOT, name), old = read(file, true);
    return { file, digest: old ? hash(old.bytes) : null };
  });
}
function unchanged(snapshot) {
  for (const item of snapshot) {
    const now = read(item.file, true);
    if ((now ? hash(now.bytes) : null) !== item.digest) throw Error('非目标文件发生并发变化：' + item.file);
  }
}
async function main() {
  const mode = process.argv[2];
  if (mode === '--verify') { await verifyMapping(process.argv[3]); return; }
  if (!['--check', '--install'].includes(mode)) throw Error('使用 --check 或 --install');
  if (process.platform !== 'linux' || process.getuid() !== 0) throw Error('请在服务器使用root执行');
  if (process.env.VIDEO_CDN_ENABLED === 'false') throw Error('原配置明确停用CDN映射，未覆盖原设置');
  for (const dir of ['/opt/openelf-api', ROOT]) {
    if (fs.realpathSync(dir) !== dir || !fs.lstatSync(dir).isDirectory()) throw Error('服务目录异常');
  }
  if (run('systemctl', ['is-active', SERVICE]) !== 'active') throw Error('服务原本未运行，停止');
  const before = await state(), protectedFiles = protectedSnapshot();
  await verifyVideo();
  const payload = path.join(__dirname, 'payload/video_delivery.js'), helper = fs.readFileSync(payload);
  run(process.execPath, ['--check', payload]);
  const changes = [], target = path.join(ROOT, 'video_delivery.js'), oldHelper = read(target, true);
  if (oldHelper && !oldHelper.bytes.equals(helper)) throw Error('线上已有不同CDN模块，停止覆盖');
  if (!oldHelper) changes.push({ file: target, old: null, next: helper });
  for (const name of ['commerce.js', 'world_uploads.js', 'world_videos.js']) {
    const file = path.join(ROOT, name), old = read(file), next = Buffer.from(prepare(name, old.bytes.toString('utf8')));
    checkSyntax(next);
    if (!old.bytes.equals(next)) changes.push({ file, old, next });
    console.log(name + '：锚点通过；原SHA256=' + hash(old.bytes));
    if (name === 'world_uploads.js' && old.bytes.toString('utf8').includes('      return { post };'))
      console.log('识别已核对旧上传版本：只转换返回视频URL，不增删上传校验或审核字段。');
  }
  unchanged(protectedFiles);
  console.log('预检通过：CDN HTTPS/206正常、服务运行、网页验证码enforce；只改3个地址返回位置和独立映射模块。');
  if (mode === '--check') { console.log('只读预检结束：未修改文件/数据库/配置，未重启，未发送短信或推送。'); return; }
  if (!changes.length) {
    run(process.execPath, [__filename, '--verify', ROOT]);
    console.log('补丁已经安装；模块自检通过，未重复重启。'); return;
  }
  const backup = fs.mkdtempSync('/opt/openelf-video-cdn-backup-'); fs.chmodSync(backup, 0o700);
  for (const item of changes) if (item.old)
    fs.writeFileSync(path.join(backup, path.basename(item.file)), item.old.bytes, { mode: 0o600, flag: 'wx' });
  fs.writeFileSync(path.join(backup, 'manifest.json'), JSON.stringify(changes.map(i => ({ file: i.file,
    existed: Boolean(i.old), oldSha256: i.old ? hash(i.old.bytes) : null, newSha256: hash(i.next),
  })), null, 2), { mode: 0o600, flag: 'wx' });
  console.log('原文件备份：' + backup);
  const written = [];
  try {
    for (const item of changes) {
      const current = read(item.file, true);
      if (item.old ? !current || !current.bytes.equals(item.old.bytes) : current) throw Error('文件发生并发修改');
      replace(item.file, item.next, item.old); written.push(item);
    }
    run(process.execPath, [__filename, '--verify', ROOT]); // Fake store, no database connection.
    unchanged(protectedFiles);
    run('systemctl', ['restart', SERVICE]);
    let healthy = false;
    for (let i = 0; i < 12; i++) {
      try { if (JSON.stringify(await state()) === JSON.stringify(before)) { healthy = true; break; } } catch (_) {}
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!healthy) throw Error('运行验证未通过');
    unchanged(protectedFiles);
    console.log('视频CDN补丁已安装，API已重启，健康检查与原强制验证码配置正常。');
    console.log('实际commerce模块模拟信息流返回CDN地址，原记录仍为源站；新上传/生成返回位置已接入。');
    console.log('未修改环境文件、密钥、数据库、Nginx、网页或安装包；请登录页面刷新验证真实信息流。');
  } catch (_) {
    for (const item of written.reverse()) {
      const current = read(item.file, true);
      if (!current || !current.bytes.equals(item.next)) throw Error('发生并发修改，未强制回滚；备份：' + backup);
      if (item.old) replace(item.file, item.old.bytes, item.old);
      else fs.unlinkSync(item.file); // Only this installation's exact new helper.
    }
    run('systemctl', ['restart', SERVICE]);
    let recovered = false;
    for (let i = 0; i < 12; i++) {
      try { if (JSON.stringify(await state()) === JSON.stringify(before)) { recovered = true; break; } } catch (_) {}
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!recovered) throw Error('原代码已恢复但健康验证未通过；请检查服务。备份：' + backup);
    throw Error('安装未完成，原代码已恢复，重启与健康验证通过；请回传结果。备份：' + backup);
  }
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { prepare };
