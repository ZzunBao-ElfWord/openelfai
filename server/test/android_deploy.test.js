'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { prepare } = require('../deploy/android/patch.cjs');
const { prepare: prepareApple } = require('../deploy/apple/patch.cjs');
const original = {
  app: `const config = require('./config');
const { createCaptchaVerifier } = require('./captcha');
async function buildApp(options = {}) {
  const sms = options.sms || createSmsProvider(config);
  const captcha = options.captcha || createCaptchaVerifier(config.captcha);
  // —— 发送验证码 ——
  app.post('/api/v1/auth/send-code', async (request) => { await captcha.verify(request.body); });
}
`,
  config: `function bool() {}\nmodule.exports = {\n  captcha: { enabled: true },\n  db: { name: 'existing-db' },\n};\n`,
  db: `const TABLES = [\n  'existing user table',\n];\n`,
  packageJson: JSON.stringify({ dependencies: { fastify: '^5.12.7', 'custom-module': '1.2.3' } }),
};
test('安卓部署保留短信、验证码、Apple路由和既有依赖，重复执行不重复插入', () => {
  const baseline = prepareApple(original); const updated = prepare(baseline);
  assert.deepEqual(prepare(updated), updated);
  assert.ok(updated.app.includes('await captcha.verify(request.body)'));
  assert.ok(updated.config.includes("db: { name: 'existing-db' }"));
  assert.ok(updated.config.includes("bool('ALIPAY_ENABLED', false)"));
  assert.ok(updated.config.includes("bool('ANDROID_COMMERCE_ENABLED', false)"));
  assert.equal(JSON.parse(updated.packageJson).dependencies['custom-module'], '1.2.3');
  assert.equal(JSON.parse(updated.packageJson).dependencies['alipay-sdk'], '4.14.0');
  const marker = '  // 内购默认关闭。';
  assert.equal(baseline.app.slice(baseline.app.indexOf(marker), baseline.app.indexOf('  // —— 发送验证码 ——')),
    updated.app.slice(updated.app.indexOf(marker), updated.app.indexOf('  // Android Alipay:')));
});
test('对不认识的Android钱包或配置停止部署，不静默覆盖', () => {
  assert.throws(() => prepare({ ...original, app: original.app + "\n// '/api/v1/android/wallet'" }));
  assert.throws(() => prepare({ ...original, config: original.config.replace('  db:', '  alipay: {},\n  db:') }));
});
test('纯Apple补丁不引入安卓路由/SDK，已更新安卓时保留其路由', () => {
  const baseline = prepareApple(original);
  assert.ok(!baseline.app.includes('/api/v1/android/alipay/notify'));
  assert.ok(!baseline.app.includes('const alipay ='));
  const updated = prepare(baseline);
  assert.deepEqual(prepareApple(updated), updated);
});
