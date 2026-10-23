'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function once(source, anchor, value) {
  if (source.split(anchor).length !== 2) throw new Error('无法唯一定位源码: ' + anchor);
  return source.replace(anchor, value);
}
function between(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error('部署包内容不完整');
  return source.slice(a, b);
}
function prepare(files, reference) {
  let { app, config, db, manifest } = files;
  if (!app.includes("require('./identity')")) {
    app = once(app, "const { createCaptchaVerifier } = require('./captcha');",
      "const { createCaptchaVerifier } = require('./captcha');\nconst { IdentityError, createAliyunIdentityProvider, decodeImage } = require('./identity');");
  }
  if (!app.includes('const identityProvider =')) {
    app = once(app, '  const captcha = options.captcha || createCaptchaVerifier(config.captcha);',
      '  const captcha = options.captcha || createCaptchaVerifier(config.captcha);\n  const identityProvider = options.identityProvider || createAliyunIdentityProvider(config.identity);');
  }
  const marker = '  // —— 身份证 OCR 二要素核验 ——';
  const anchor = '  // 内购默认关闭。';
  const hasStatus = app.includes("'/api/v1/identity/status'");
  const hasVerify = app.includes("'/api/v1/identity/verify'");
  if (hasStatus !== hasVerify) throw new Error('实名认证路由不完整，请人工检查');
  const routes = between(reference.app, marker, anchor);
  if (!hasStatus) app = once(app, anchor, routes + anchor);
  else if (!app.includes(routes)) throw new Error('已有实名认证代码与补丁不一致');

  const configBlock = between(reference.config, '  identity: {', '  androidCommerce: {');
  if (!config.includes('  identity: {')) {
    config = once(config, '  appleIap: {', configBlock + '  appleIap: {');
  } else if (!config.includes(configBlock)) throw new Error('已有实名认证配置与补丁不一致');

  const table = between(reference.db, '  `CREATE TABLE IF NOT EXISTS identity_verifications', '  `CREATE TABLE IF NOT EXISTS user_wallets');
  if (!db.includes('CREATE TABLE IF NOT EXISTS identity_verifications')) {
    db = once(db, '  `CREATE TABLE IF NOT EXISTS user_wallets', table + '  `CREATE TABLE IF NOT EXISTS user_wallets');
  } else if (!db.includes(table)) throw new Error('已有实名认证表结构与补丁不一致');

  const pkg = JSON.parse(manifest);
  pkg.dependencies ||= {};
  pkg.dependencies['@alicloud/cloudauth20190307'] = '3.14.0';
  for (const [filename, code] of Object.entries({ app, config, db })) new vm.Script(code, { filename });
  return { app, config, db, manifest: JSON.stringify(pkg, null, 2) + '\n' };
}

if (require.main === module) {
  const root = fs.realpathSync(process.argv[2]);
  if (root !== '/opt/openelf-api') throw new Error('仅支持 /opt/openelf-api');
  const bundled = path.resolve(__dirname, '../..');
  const read = (dir, file) => fs.readFileSync(path.join(dir, file), 'utf8').replace(/\r\n/g, '\n');
  const names = { app: 'src/app.js', config: 'src/config.js', db: 'src/db.js', manifest: 'package.json' };
  const input = Object.fromEntries(Object.entries(names).map(([k, file]) => [k, read(root, file)]));
  const ref = Object.fromEntries(['app', 'config', 'db'].map(k => [k, read(bundled, names[k])]));
  const output = prepare(input, ref);
  if (process.argv[3] !== '--check') {
    for (const [key, file] of Object.entries(names)) fs.writeFileSync(path.join(root, file), output[key]);
  }
  console.log(process.argv[3] === '--check' ? '实名认证补丁预检通过' : '实名认证补丁已应用');
}
module.exports = { prepare };
