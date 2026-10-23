const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonFileStore, createAuthService } = require('../auth_service');
const { createServer } = require('../server');

test('SMS code is not returned, expires, is single-use, and sessions require a token', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openelf-auth-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let time = Date.parse('2026-10-21T00:00:00Z');
  let deliveredCode;
  const store = new JsonFileStore(path.join(dir, 'state.json'));
  const auth = createAuthService({
    store,
    sendSms: async (_, code) => { deliveredCode = code; },
    secret: 'a-test-secret-with-at-least-32-characters',
    now: () => time,
    generateCode: () => '987654',
  });
  const server = createServer(auth);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (route, body, token) => {
    const response = await fetch(base + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };

  const sent = await post('/api/v1/auth/send-code', { phone: '13800138000' });
  assert.equal(sent.status, 200);
  assert.equal(deliveredCode, '987654');
  assert.equal(JSON.stringify(sent.body).includes('987654'), false);
  assert.equal((await post('/api/v1/auth/send-code', { phone: '13800138000' })).status, 429);
  assert.equal((await post('/api/v1/auth/login-by-code', { phone: '13800138000', code: '123456' })).status, 401);
  const login = await post('/api/v1/auth/login-by-code', { phone: '13800138000', code: '987654' });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.phone, '13800138000');
  assert.equal((await post('/api/v1/auth/login-by-code', { phone: '13800138000', code: '987654' })).status, 401);
  const me = await fetch(base + '/api/v1/auth/me', { headers: { Authorization: `Bearer ${login.body.token}` } });
  assert.equal(me.status, 200);
  assert.equal((await post('/api/v1/auth/logout', {}, login.body.token)).status, 200);
  const afterLogout = await fetch(base + '/api/v1/auth/me', { headers: { Authorization: `Bearer ${login.body.token}` } });
  assert.equal(afterLogout.status, 401);

  time += 61_000;
  await post('/api/v1/auth/send-code', { phone: '13800138000' });
  time += 301_000;
  assert.equal((await post('/api/v1/auth/login-by-code', { phone: '13800138000', code: '987654' })).status, 401);
});

test('SMS provider failure does not create a valid code', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openelf-auth-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const auth = createAuthService({
    store: new JsonFileStore(path.join(dir, 'state.json')),
    sendSms: async () => { throw new Error('provider unavailable'); },
    secret: 'a-test-secret-with-at-least-32-characters',
  });
  await assert.rejects(() => auth.sendCode('13800138000', '127.0.0.1'));
  assert.throws(() => auth.loginWithCode('13800138000', '123456'), { status: 401 });
});
