'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { prepare } = require('../deploy/apple/patch.cjs');

const original = {
  app: `const config = require('./config');
const { createCaptchaVerifier } = require('./captcha');
async function buildApp(options = {}) {
  const sms = options.sms || createSmsProvider(config);
  const captcha = options.captcha || createCaptchaVerifier(config.captcha);
  // —— 发送验证码 ——
  app.post('/api/v1/auth/send-code', async (request) => {
    await captcha.verify(request.body);
  });
}
`,
  config: `function bool() {}
module.exports = {
  captcha: { enabled: true },
  db: { name: 'existing-db' },
};
`,
  db: `const TABLES = [
  'existing user table',
];
`,
  packageJson: JSON.stringify({ dependencies: { fastify: '^5.12.7', 'custom-module': '1.2.3' } }),
};

test('支付补丁保留现有短信、验证码、数据库配置和其他依赖', () => {
  const result = prepare(original);
  assert.ok(result.app.includes('await captcha.verify(request.body);'));
  assert.ok(result.config.includes("db: { name: 'existing-db' }"));
  assert.ok(result.config.includes('captcha: { enabled: true }'));
  assert.ok(result.db.includes("'existing user table'"));
  assert.ok(result.app.includes("'/api/v1/ios/verify'"));
  assert.ok(result.db.includes('CREATE TABLE IF NOT EXISTS user_wallets'));
  assert.ok(result.config.includes("bool('APPLE_IAP_ENABLED', false)"));
  assert.equal(JSON.parse(result.packageJson).dependencies['custom-module'], '1.2.3');
});

test('支付部署补丁可重复运行，不重复插入路由和表定义', () => {
  const first = prepare(original);
  assert.deepEqual(prepare(first), first);
});

test('不认识的入口、部分钱包路由、冲突的钱包定义会阻止部署', () => {
  assert.throws(() => prepare({ ...original, app: 'unrecognized source' }));
  assert.throws(() => prepare({ ...original, app: original.app + "\n// '/api/v1/wallet'" }));
  assert.throws(() => prepare({ ...original, db: 'CREATE TABLE IF NOT EXISTS user_wallets (other)' }));
});

test('可升级已部署的旧苹果模块，保留验证码并补入账号绑定与沙盒表', () => {
  const legacy = prepare(original);
  legacy.app = legacy.app.replace(
    /    return \{\s+mode: appleIap.mode,\s+appAccountToken: appleIap.accountToken\(user.id\),\s+products: appleIap.listProducts\(\),\s+};/,
    '    return { products: appleIap.listProducts() };',
  ).replace('mode: appleIap.mode, wallet:', 'wallet:')
    .replace(/(app\.get\('\/api\/v1\/ios\/products', async \(request\) => \{\s+)const \{ user } = await authenticate\(request\);/,
      '$1await authenticate(request);');
  legacy.config = legacy.config.replace(/^.*sandboxOnly:.*\r?\n/gm, '');
  legacy.db = legacy.db.replace(/  `CREATE TABLE IF NOT EXISTS apple_iap_sandbox_[\s\S]*?`,\r?\n/g, '');
  const upgraded = prepare(legacy);
  assert.ok(upgraded.app.includes('appAccountToken: appleIap.accountToken(user.id)'));
  assert.ok(upgraded.config.includes('APPLE_IAP_SANDBOX_ONLY'));
  assert.ok(upgraded.db.includes('CREATE TABLE IF NOT EXISTS apple_iap_sandbox_wallets'));
  assert.ok(upgraded.app.includes('await captcha.verify(request.body);'));
  assert.deepEqual(prepare(upgraded), upgraded);
});

test('修复仅手工添加 protocol 2 但缺少 commerce 初始化的线上混合版本', () => {
  const legacy = prepare(original);
  legacy.app = legacy.app
    .replace(/^const \{ createPaymentStore \} = require\('\.\/payment_store'\);\r?\n/m, '')
    .replace(/^const \{ createCommerceService \} = require\('\.\/commerce'\);\r?\n/m, '')
    .replace(/^  const paymentStore = .*\r?\n/m, '')
    .replace(/^  const commerce = .*\r?\n/m, '')
    .replace(/^    paymentStore,\r?\n/m, '')
    .replace('return commerce.snapshot(user, request.query?.environment);',
      'return { mode: appleIap.mode, wallet: await appleIap.wallet(user.id) };');
  assert.ok(legacy.app.includes('mode: commerce.environment('));
  assert.ok(!legacy.app.includes('const commerce ='));
  const fixed = prepare(legacy);
  assert.ok(fixed.app.includes("require('./payment_store')"));
  assert.ok(fixed.app.includes("require('./commerce')"));
  assert.ok(fixed.app.includes('const commerce = createCommerceService('));
  assert.ok(fixed.app.includes('return commerce.snapshot(user, request.query?.environment);'));
  assert.ok(!fixed.app.includes('[DEBUG ios/products]'));
  assert.deepEqual(prepare(fixed), fixed);
});
