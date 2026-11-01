'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { prepare: prepareApple } = require('../apple/patch.cjs');
const payload = path.resolve(__dirname, '../..');
function section(source, start, end) {
  if (source.split(start).length !== 2) throw new Error('更新片段不唯一：' + start);
  const begin = source.indexOf(start); const stop = source.indexOf(end, begin);
  if (stop < 0) throw new Error('无法匹配更新片段');
  return source.slice(begin, stop);
}
/// 交付源码统一按 LF 切片，插入时再对齐目标文件的换行，避免不同行尾叠加累积。
function readSource(relative) {
  return fs.readFileSync(path.join(payload, relative), 'utf8').replace(/\r\n/g, '\n');
}
function eolOf(source) {
  const total = source.split('\n').length - 1;
  const crlf = source.split('\r\n').length - 1;
  return total > 0 && crlf * 2 >= total ? '\r\n' : '\n';
}
function alignEol(text, source) {
  const normalized = text.replace(/\r\n/g, '\n');
  return eolOf(source) === '\r\n' ? normalized.replace(/\n/g, '\r\n') : normalized;
}
function prepare(original) {
  const updated = prepareApple(original);
  const desiredApp = readSource('src/app.js');
  const desiredConfig = readSource('src/config.js');
  let { app, config } = updated;
  for (const [file, symbol] of [['alipay_gateway', 'createAlipayGateway'], ['alipay', 'createAlipayService']]) {
    if (!app.includes(`require('./${file}')`)) app = app.replace("const config = require('./config');", `const config = require('./config');\nconst { ${symbol} } = require('./${file}');`);
  }
  const setup = alignEol(section(desiredApp, '  const androidCommerce =', '\n\n  const app = Fastify'), app);
  if (app.includes('  const androidCommerce =')) {
    // 兼容旧版单行网关初始化与当前拆分后的支付宝/充值初始化。
    const pattern = /  const androidCommerce = createCommerceService\([\s\S]*?(?:gateway: options\.alipayGateway \|\| createAlipayGateway\(config\.alipay\) }\);|const platformTopup = createTopupService\([\s\S]*?\n  \}\);)/g;
    if ([...app.matchAll(pattern)].length !== 1) throw new Error('已有安卓初始化无法识别');
    app = app.replace(pattern, setup);
  } else {
    const pattern = /  const appleIap = createAppleIapService\([\s\S]*?\n  }\);/g;
    if ([...app.matchAll(pattern)].length !== 1) throw new Error('无法定位共享钱包初始化');
    app = app.replace(pattern, match => match + eolOf(app) + setup);
  }
  const marker = '  // Android Alipay:';
  const routes = alignEol(section(desiredApp, marker, '  // —— 发送验证码 ——'), app);
  if (app.includes(marker)) {
    app = app.replace(section(app, marker, '  // —— 发送验证码 ——'), routes);
  } else {
    for (const route of ['/api/v1/android/wallet', '/api/v1/android/commerce/actions', '/api/v1/android/alipay/notify']) {
      if (app.includes(route)) throw new Error('存在未知安卓钱包路由，停止更新');
    }
    app = app.replace('  // —— 发送验证码 ——', routes + '  // —— 发送验证码 ——');
  }
  const block = alignEol(section(desiredConfig, '  androidCommerce: {', '  appleIap: {'), config);
  if (config.includes('  androidCommerce: {')) {
    const previous = section(config, '  androidCommerce: {', '  appleIap: {');
    if (!previous.includes('  alipay: {')) throw new Error('已有支付宝配置无法识别');
    config = config.replace(previous, block);
  } else {
    if (config.includes('  alipay: {')) throw new Error('存在未知支付宝配置');
    config = config.replace('  appleIap: {', block + '  appleIap: {');
  }
  const manifest = JSON.parse(updated.packageJson);
  manifest.dependencies['alipay-sdk'] = '4.14.0';
  new vm.Script(app); new vm.Script(config);
  return { ...updated, app, config, packageJson: JSON.stringify(manifest, null, 2) + '\n' };
}
if (require.main === module) {
  const root = fs.realpathSync(process.argv[2]);
  if (root !== '/opt/openelf-api') throw new Error('仅支持 /opt/openelf-api');
  const locations = { app: 'src/app.js', config: 'src/config.js', db: 'src/db.js', packageJson: 'package.json' };
  const original = Object.fromEntries(Object.entries(locations).map(([key, file]) => [key, fs.readFileSync(path.join(root, file), 'utf8')]));
  const updated = prepare(original);
  if (process.argv[3] !== '--check') for (const [key, file] of Object.entries(locations)) fs.writeFileSync(path.join(root, file), updated[key]);
  console.log(process.argv[3] === '--check' ? '安卓支付宝增量补丁检查通过' : '安卓支付宝增量补丁已应用');
}
module.exports = { prepare };
