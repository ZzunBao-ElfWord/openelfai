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
function prepare(original) {
  const updated = prepareApple(original);
  const desiredApp = fs.readFileSync(path.join(payload, 'src/app.js'), 'utf8');
  const desiredConfig = fs.readFileSync(path.join(payload, 'src/config.js'), 'utf8');
  let { app, config } = updated;
  for (const [file, symbol] of [['alipay_gateway', 'createAlipayGateway'], ['alipay', 'createAlipayService']]) {
    if (!app.includes(`require('./${file}')`)) app = app.replace("const config = require('./config');", `const config = require('./config');\nconst { ${symbol} } = require('./${file}');`);
  }
  const setup = section(desiredApp, '  const androidCommerce =', '\n\n  const app = Fastify');
  if (app.includes('  const androidCommerce =')) {
    const pattern = /  const androidCommerce = createCommerceService\([\s\S]*?\n    gateway: options\.alipayGateway \|\| createAlipayGateway\(config\.alipay\) }\);/g;
    if ([...app.matchAll(pattern)].length !== 1) throw new Error('已有安卓初始化无法识别');
    app = app.replace(pattern, setup);
  } else {
    const pattern = /  const appleIap = createAppleIapService\([\s\S]*?\n  }\);/g;
    if ([...app.matchAll(pattern)].length !== 1) throw new Error('无法定位共享钱包初始化');
    app = app.replace(pattern, match => match + '\n' + setup);
  }
  const marker = '  // Android Alipay:';
  const routes = section(desiredApp, marker, '  // —— 发送验证码 ——');
  if (app.includes(marker)) {
    app = app.replace(section(app, marker, '  // —— 发送验证码 ——'), routes);
  } else {
    for (const route of ['/api/v1/android/wallet', '/api/v1/android/commerce/actions', '/api/v1/android/alipay/notify']) {
      if (app.includes(route)) throw new Error('存在未知安卓钱包路由，停止更新');
    }
    app = app.replace('  // —— 发送验证码 ——', routes + '  // —— 发送验证码 ——');
  }
  const block = section(desiredConfig, '  androidCommerce: {', '  appleIap: {');
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
