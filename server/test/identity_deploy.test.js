'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { prepare } = require('../deploy/identity/patch.cjs');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const reference = { app: read('server/src/app.js'), config: read('server/src/config.js'), db: read('server/src/db.js') };
const old = file => execFileSync('git', ['show', 'HEAD:server/' + file], { cwd: root, encoding: 'utf8' }).replace(/\r\n/g, '\n');
test('身份认证增量部署保留支付、短信、已有配置，并可重复执行', () => {
  const input = { app: old('src/app.js'), config: old('src/config.js'), db: old('src/db.js'), manifest: old('package.json') };
  const output = prepare(input, reference);
  assert.ok(output.app.includes("'/api/v1/identity/status'"));
  assert.ok(output.app.includes("'/api/v1/ios/verify'"));
  assert.ok(output.app.includes('await captcha.verify(request.body);'));
  assert.ok(output.db.includes('CREATE TABLE IF NOT EXISTS identity_verifications'));
  assert.deepEqual(prepare(output, reference), output);
  const oldPkg = JSON.parse(input.manifest);
  const pkg = JSON.parse(output.manifest);
  for (const [key, value] of Object.entries(oldPkg.dependencies)) assert.equal(pkg.dependencies[key], value);
});
test('遇到不匹配和部分路由时在写入前拒绝部署', () => {
  const input = { app: old('src/app.js'), config: old('src/config.js'), db: old('src/db.js'), manifest: old('package.json') };
  assert.throws(() => prepare({ ...input, app: input.app.replace('  // 内购默认关闭。', '  // 不匹配') }, reference));
  assert.throws(() => prepare({ ...input, app: input.app + "\n// '/api/v1/identity/status'" }, reference));
});
