'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { prepare } = require('../deploy/captcha/patch.cjs');

const originalApp = `const config = require('./config');
async function buildApp(options = {}) {
  const sms = options.sms || createSmsProvider(config);
  app.post('/api/v1/auth/send-code', async (request) => {
      const code = generateSmsCode();
      await sms.sendCode({ code });
  });
}
`;
const originalConfig = `function bool() {}
module.exports = {
  db: { name: 'existing-db' },
  appleIap: { enabled: false },
};
`;

test('部署补丁保留原配置，仅在短信生成前加入图形校验', () => {
  const result = prepare(originalApp, originalConfig);
  assert.ok(result.app.indexOf('await captcha.verify') < result.app.indexOf('const code ='));
  assert.ok(result.config.includes("db: { name: 'existing-db' }"));
  assert.ok(result.config.includes('appleIap: { enabled: false }'));
  assert.ok(result.config.includes('ALIYUN_CAPTCHA_ANDROID_APP_KEY'));
  assert.ok(!result.app.includes('createAppleIapService'));
});

test('重复部署不会重复插入代码', () => {
  const first = prepare(originalApp, originalConfig);
  assert.deepEqual(prepare(first.app, first.config), first);
});

test('无法匹配服务器源码时停止更新', () => {
  assert.throws(() => prepare('unrecognized source', originalConfig), /未进行更新/);
});
