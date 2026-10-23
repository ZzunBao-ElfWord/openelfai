'use strict';

const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
if (!/^openelf_[a-z0-9_]*test$/.test(process.env.DB_NAME || '')) {
  throw new Error('鉴权集成测试会清空测试数据，必须显式指定独立 DB_NAME=openelf_*test，禁止使用生产数据库');
}

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-0123456789abcdef';
process.env.SMS_CODE_PEPPER = 'test-sms-pepper-0123456789abcdef';
process.env.REFRESH_TOKEN_PEPPER = 'test-refresh-pepper-0123456789abcdef';
process.env.SMS_PROVIDER = 'mock';
process.env.AUTH_DEBUG_CODES = '1';

const buildApp = require('../src/app');

const deviceId = 'test-device-0001';
let app;

before(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
  await app.db.query('DELETE FROM refresh_sessions');
  await app.db.query('DELETE FROM sms_codes');
  await app.db.query('DELETE FROM users');
});

after(async () => {
  await app.close();
});

async function sendCode(phone) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/send-code',
    payload: { phone },
  });
}

async function login(phone, code) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/login-by-code',
    payload: { phone, code, deviceId },
  });
}

function me(accessToken) {
  return app.inject({
    method: 'GET',
    url: '/api/v1/auth/me',
    headers: { authorization: `Bearer ${accessToken}` },
  });
}

test('健康检查', async () => {
  const response = await app.inject({ method: 'GET', url: '/api/v1/health' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
});

test('验证码登录、会话恢复与 refresh 旋转', async () => {
  const phone = '13800138000';

  const sent = await sendCode(phone);
  assert.equal(sent.statusCode, 200);
  const code = sent.json().debugCode;
  assert.match(code, /^\d{6}$/);

  const signedIn = await login(phone, code);
  assert.equal(signedIn.statusCode, 200);
  const session = signedIn.json();
  assert.match(session.accessToken, /^[\w-]+\./);
  assert.ok(session.refreshToken.length > 20);
  assert.equal(session.user.phone, phone);
  assert.match(session.user.nickname, /^用户/);

  const current = await me(session.accessToken);
  assert.equal(current.statusCode, 200);
  assert.equal(current.json().user.id, session.user.id);

  const refreshed = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/refresh',
    payload: { refreshToken: session.refreshToken, deviceId },
  });
  assert.equal(refreshed.statusCode, 200);
  const rotated = refreshed.json();
  assert.notEqual(rotated.refreshToken, session.refreshToken);
  assert.equal((await me(rotated.accessToken)).statusCode, 200);

  // 旧 refresh token 重放：判定为泄漏，撤销该用户全部会话。
  const replay = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/refresh',
    payload: { refreshToken: session.refreshToken, deviceId },
  });
  assert.equal(replay.statusCode, 401);
  assert.equal(replay.json().error.code, 'SESSION_REVOKED');
  assert.equal((await me(rotated.accessToken)).statusCode, 401);
});

test('验证码错误 5 次后锁定', async () => {
  const phone = '13900139000';
  const sent = await sendCode(phone);
  assert.equal(sent.statusCode, 200);
  const code = sent.json().debugCode;
  const wrongCode = code === '000000' ? '000001' : '000000';

  for (let i = 0; i < 4; i += 1) {
    const response = await login(phone, wrongCode);
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, 'INVALID_CODE');
  }

  const locked = await login(phone, wrongCode);
  assert.equal(locked.statusCode, 429);
  assert.equal(locked.json().error.code, 'TOO_MANY_ATTEMPTS');

  const correctAfterLock = await login(phone, code);
  assert.equal(correctAfterLock.statusCode, 400);
  assert.equal(correctAfterLock.json().error.code, 'INVALID_CODE');
});

test('60 秒内重复发送被限流', async () => {
  const phone = '13700137000';
  assert.equal((await sendCode(phone)).statusCode, 200);

  const again = await sendCode(phone);
  assert.equal(again.statusCode, 429);
  assert.equal(again.json().error.code, 'RATE_LIMITED');
});

test('退出登录后 access token 立即失效', async () => {
  const phone = '13600136000';
  const sent = await sendCode(phone);
  const session = (await login(phone, sent.json().debugCode)).json();

  const logout = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/logout',
    headers: { authorization: `Bearer ${session.accessToken}` },
    payload: { refreshToken: session.refreshToken },
  });
  assert.equal(logout.statusCode, 204);

  const afterLogout = await me(session.accessToken);
  assert.equal(afterLogout.statusCode, 401);
});
