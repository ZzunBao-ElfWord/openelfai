'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const payload = path.resolve(__dirname, '../..');

function insertOnce(source, anchor, addition) {
  if (source.split(anchor).length !== 2) {
    throw new Error('服务器源码与补丁预期不一致，未进行更新');
  }
  return source.replace(anchor, anchor + addition);
}

function section(source, start, end) {
  if (source.split(start).length !== 2) throw new Error('部署包源码片段无效');
  const offset = source.indexOf(start);
  const stop = source.indexOf(end, offset);
  if (stop < 0) throw new Error('部署包源码片段不完整');
  return source.slice(offset, stop);
}

function prepare({ app, config, db, packageJson }) {
  const desiredApp = fs.readFileSync(path.join(payload, 'src/app.js'), 'utf8');
  const desiredConfig = fs.readFileSync(path.join(payload, 'src/config.js'), 'utf8');
  const desiredDb = fs.readFileSync(path.join(payload, 'src/db.js'), 'utf8');
  if (!app.includes("require('./apple_iap')")) {
    app = insertOnce(app, "const config = require('./config');",
      "\nconst { createAppleIapService, createAppleVerifier } = require('./apple_iap');");
  }
  for (const [module, symbol] of [['payment_store', 'createPaymentStore'], ['commerce', 'createCommerceService']]) {
    if (!app.includes("require('./" + module + "')")) app = insertOnce(app, "const config = require('./config');",
      `\nconst { ${symbol} } = require('./${module}');`);
  }
  const setup = section(desiredApp, '  const appleVerifier =', desiredApp.includes('  const androidCommerce =') ? '\n  const androidCommerce =' : '\n\n  const app = Fastify');
  if (!app.includes('const appleIap =')) {
    app = insertOnce(app, '  const sms = options.sms || createSmsProvider(config);', '\n' + setup);
  } else {
    const pattern = /  const appleVerifier =[\s\S]*?  const appleIap = createAppleIapService\([\s\S]*?\n  }\);/g;
    if ([...app.matchAll(pattern)].length !== 1) throw new Error('无法安全更新支付初始化');
    app = app.replace(pattern, setup);
  }
  const routes = ['/api/v1/ios/products', '/api/v1/wallet', '/api/v1/ios/verify'];
  const existingRoutes = routes.filter((route) => app.includes("'" + route + "'"));
  if (existingRoutes.length && existingRoutes.length !== routes.length) {
    throw new Error('发现部分支付路由，停止更新以避免重复或覆盖现有钱包');
  }
  if (!existingRoutes.length) {
    const routesCode = section(desiredApp, '  // 内购默认关闭。', desiredApp.includes('  // Android Alipay:') ? '  // Android Alipay:' : '  // —— 发送验证码 ——');
    const anchor = '  // —— 发送验证码 ——';
    if (app.split(anchor).length !== 2) throw new Error('无法安全定位支付路由插入点');
    app = app.replace(anchor, routesCode + anchor);
  } else {
    const start = '  // 内购默认关闭。';
    const end = app.includes('  // Android Alipay:') ? '  // Android Alipay:' : '  // —— 发送验证码 ——';
    const previous = section(app, start, end);
    if (!previous.includes('appleIap.listProducts()') ||
        !previous.includes('appleIap.wallet(user.id)') && !previous.includes('commerce.snapshot(user,')) {
      throw new Error('已有钱包接口无法识别，停止更新');
    }
    app = app.replace(previous, section(desiredApp, start, desiredApp.includes('  // Android Alipay:') ? '  // Android Alipay:' : end));
  }
  if (!config.includes('  appleIap: {')) {
    const block = section(desiredConfig, '  appleIap: {', '\n};');
    const ending = /\r?\n};\s*$/;
    if (!ending.test(config)) throw new Error('无法安全定位配置插入点');
    config = config.replace(ending, '\n' + block + '\n};\n');
  } else if (!config.includes('APPLE_IAP_SANDBOX_ONLY')) {
    config = insertOnce(config, "    enabled: bool('APPLE_IAP_ENABLED', false),",
      "\n    sandboxOnly: bool('APPLE_IAP_SANDBOX_ONLY', false),");
  }
  for (const table of ['user_wallets', 'apple_iap_transactions', 'apple_iap_sandbox_wallets', 'apple_iap_sandbox_transactions']) {
    const block = section(desiredDb, '  `CREATE TABLE IF NOT EXISTS ' + table + ' (', '`,') + '`,';
    if (db.includes('CREATE TABLE IF NOT EXISTS ' + table + ' (')) {
      if (!db.replace(/\r\n/g, '\n').includes(block.replace(/\r\n/g, '\n'))) {
        throw new Error('已有钱包表定义与当前版本不同，请先核对数据库结构');
      }
    } else {
      const ending = /\r?\n];/g;
      if ([...db.matchAll(ending)].length !== 1) throw new Error('无法安全定位数据库表定义');
      db = db.replace(ending, '\n\n' + block + '\n];');
    }
  }
  if (!db.includes("require('./payment_store')")) {
    db = "const { PAYMENT_TABLES } = require('./payment_store');\n" + db;
  }
  if (db.includes('for (const statement of TABLES)')) {
    db = db.replace('for (const statement of TABLES)', 'for (const statement of [...TABLES, ...PAYMENT_TABLES])');
  }
  if (db.includes('async function createPool') && !db.includes('...PAYMENT_TABLES')) {
    throw new Error('无法安全添加支付账本表');
  }
  const manifest = JSON.parse(packageJson);
  app = app.replace('if (!session || session.revoked_at || Number(session.expires_at) <= Date.now())',
    'if (!session || session.user_id !== payload.sub || session.revoked_at || Number(session.expires_at) <= Date.now())');
  manifest.dependencies ||= {};
  manifest.dependencies['@apple/app-store-server-library'] ||= '3.1.0';
  for (const [name, source] of Object.entries({ app, config, db })) {
    new vm.Script(source, { filename: name + '.js' });
  }
  return { app, config, db, packageJson: JSON.stringify(manifest, null, 2) + '\n' };
}

if (require.main === module) {
  const root = fs.realpathSync(process.argv[2]);
  if (root !== '/opt/openelf-api') throw new Error('仅支持 /opt/openelf-api');
  const locations = { app: 'src/app.js', config: 'src/config.js', db: 'src/db.js', packageJson: 'package.json' };
  const original = Object.fromEntries(Object.entries(locations)
    .map(([name, relative]) => [name, fs.readFileSync(path.join(root, relative), 'utf8')]));
  const updated = prepare(original);
  if (process.argv[3] !== '--check') {
    for (const [name, relative] of Object.entries(locations)) {
      fs.writeFileSync(path.join(root, relative), updated[name]);
    }
  }
  console.log(process.argv[3] === '--check' ? '苹果支付源码补丁检查通过' : '苹果支付源码补丁已应用');
}

module.exports = { prepare };
