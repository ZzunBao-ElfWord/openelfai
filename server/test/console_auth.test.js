'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync(path.resolve(__dirname, '../../web/public/console/auth/console-auth.js'), 'utf8');
test('both website variants retain parser-early login safety in source', () => {
  const layout = fs.readFileSync(path.resolve(__dirname, '../../web/app/layout.js'), 'utf8');
  assert.ok(layout.includes('/console/auth/console-auth.js?v=20261102-source-v2'));
  assert.ok(layout.includes('strategy="beforeInteractive"'));
  for (const asset of ['ct4.js', 'web-captcha.js']) {
    assert.ok(fs.statSync(path.resolve(__dirname, '../../web/public/console/auth/', asset)).size > 0);
  }
});
const API = 'https://api.openelfai.com';
const AUTH = 'openelf:console:auth';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function harness(network, initial = null, proofError = null) {
  const stored = new Map(initial ? [[AUTH, JSON.stringify(initial)]] : []);
  const listeners = {};
  let proofs = 0, reloads = 0;
  const storage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) };
  const document = {
    addEventListener: (event, callback) => { listeners[event] = callback; },
    createElement() { throw new Error('Scripts should be preloaded in unit test'); },
  };
  const window = { fetch: network, addEventListener: (event, fn) => { listeners[event] = fn; },
    initAlicom4() {}, OpenElfWebCaptcha: { async requestProof() {
      proofs++; if (proofError) throw new Error(proofError);
      return { platform: 'web', lot_number: 'lot', pass_token: 'pass', gen_time: '123', captcha_output: 'output' };
    } } };
  const location = { pathname: '/console/', reload() { reloads++; } };
  vm.runInNewContext(source, { window, document, location, navigator: { locks: { request: async (_key, fn) => fn() } },
    localStorage: storage, sessionStorage: storage, crypto: webcrypto, Request, Response, Headers, URL, AbortController,
    setTimeout, clearTimeout, Uint8Array });
  return { fetch: window.fetch, stored, listeners, proofs: () => proofs, reloads: () => reloads };
}
const config = () => json({ enabled: true, platform: 'web', appId: '83a70a4cfa97f37954692b81c2055b90' });
const post = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
test('短信发送必须先获得Web凭证；取消或无效手机号不发送短信', async () => {
  let sends = 0;
  const h = harness(async request => {
    if (request.url.endsWith('/captcha/config')) return config();
    assert.ok(request.url.endsWith('/send-code'));
    const body = await request.json(); sends++;
    assert.equal(body.platform, 'web'); assert.equal(body.lot_number, 'lot');
    assert.equal(body.phone, '13800138000');
    return json({ ok: true, resendAfter: 60, debugCode: '000000' });
  });
  let response = await h.fetch(API + '/api/v1/auth/send-code', post({ phone: '13800138000' }));
  assert.equal(response.status, 200); assert.equal(h.proofs(), 1); assert.equal(sends, 1);
  assert.equal('debugCode' in await response.json(), false);
  response = await h.fetch(API + '/api/v1/auth/send-code', post({ phone: 'invalid' }));
  assert.equal(response.status, 400); assert.equal(sends, 1);
  const cancelled = harness(async request => { assert.ok(request.url.endsWith('/captcha/config')); return config(); }, null, '已取消图形验证');
  assert.equal((await cancelled.fetch(API + '/api/v1/auth/send-code', post({ phone: '13800138000' }))).status, 503);
});
test('验证码登录校验6位数字且使用稳定的随机设备ID', async () => {
  const ids = [];
  const h = harness(async request => { ids.push((await request.json()).deviceId); return json({ accessToken: 'access' }); });
  assert.equal((await h.fetch(API + '/api/v1/auth/login-by-code', post({ phone: '13800138000', code: '123' }))).status, 400);
  for (let i = 0; i < 2; i++) await h.fetch(API + '/api/v1/auth/login-by-code', post({ phone: '13800138000', code: '123456' }));
  assert.equal(ids.length, 2); assert.equal(ids[0], ids[1]); assert.match(ids[0], /^web-console-[a-f0-9]{32}$/);
});
test('并发401只续期一次；后续请求替换旧页面闭包内的过期令牌', async () => {
  let rotations = 0;
  const h = harness(async request => {
    if (request.url.endsWith('/auth/refresh')) {
      rotations++; await new Promise(resolve => setTimeout(resolve, 10));
      return json({ accessToken: 'new-access', refreshToken: 'new-refresh', user: { id: 'user-1' } });
    }
    return request.headers.get('Authorization') === 'Bearer new-access' ? json({ ok: true }) : json({ error: 'expired' }, 401);
  }, { accessToken: 'old-access', refreshToken: 'old-refresh', user: { id: 'user-1' } });
  const options = { headers: { Authorization: 'Bearer old-access' } };
  const responses = await Promise.all([h.fetch(API + '/api/v1/platform/console/overview', options), h.fetch(API + '/api/v1/platform/console/usage', options)]);
  assert.equal(rotations, 1); assert.ok(responses.every(r => r.status === 200));
  assert.equal((await h.fetch(API + '/api/v1/platform/console/overview', options)).status, 200);
});
test('退出登录调用后端注销、清除本地会话，且不向第三方发送登录令牌', async () => {
  let logouts = 0;
  const h = harness(async request => {
    if (request.url.endsWith('/auth/logout')) { logouts++; assert.equal((await request.json()).refreshToken, 'refresh'); return new Response(null, { status: 204 }); }
    assert.equal(request.headers.has('Authorization'), false); return json({});
  }, { accessToken: 'access', refreshToken: 'refresh', user: { id: 'user-1' } });
  await h.fetch(new Request('https://unrelated.example/public'));
  const button = { textContent: '退出登录' };
  await h.listeners.click({ target: { closest: () => button }, preventDefault() {}, stopImmediatePropagation() {} });
  assert.equal(logouts, 1); assert.equal(h.stored.has(AUTH), false); assert.equal(h.reloads(), 1);
});
test('刷新令牌失效不无限重试，回到未登录状态', async () => {
  let calls = 0;
  const h = harness(async () => { calls++; return json({ error: { code: 'SESSION_REVOKED' } }, 401); },
    { accessToken: 'access', refreshToken: 'revoked', user: { id: 'user-1' } });
  const response = await h.fetch(API + '/api/v1/platform/console/overview', { headers: { Authorization: 'Bearer access' } });
  assert.equal(response.status, 401); assert.equal(calls, 2); assert.equal(h.stored.has(AUTH), false);
});
test('网络或服务端错误不自动重试业务POST，避免重复操作', async () => {
  let calls = 0;
  const h = harness(async () => { calls++; return json({ error: 'unavailable' }, 502); },
    { accessToken: 'access', refreshToken: 'refresh', user: { id: 'user-1' } });
  const response = await h.fetch(API + '/api/v1/platform/my-key/reset', {
    ...post({}), headers: { Authorization: 'Bearer access', 'Content-Type': 'application/json' }
  });
  assert.equal(response.status, 502); assert.equal(calls, 1);
});
test('退出与续期竞争时不恢复旧账号，并撤销被丢弃的新会话', async () => {
  let finishRefresh;
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const revoked = [];
  const h = harness(async request => {
    if (request.url.endsWith('/auth/refresh')) {
      markStarted();
      return new Promise(resolve => { finishRefresh = () => resolve(json({ accessToken: 'new', refreshToken: 'new-refresh', user: { id: 'user-1' } })); });
    }
    if (request.url.endsWith('/auth/logout')) { revoked.push((await request.json()).refreshToken); return new Response(null, { status: 204 }); }
    return json({}, 401);
  }, { accessToken: 'old', refreshToken: 'old-refresh', user: { id: 'user-1' } });
  const pending = h.fetch(API + '/api/v1/platform/console/overview', { headers: { Authorization: 'Bearer old' } });
  await started;
  await h.listeners.click({ target: { closest: () => ({ textContent: '退出登录' }) }, preventDefault() {}, stopImmediatePropagation() {} });
  finishRefresh(); await pending;
  assert.equal(h.stored.has(AUTH), false);
  assert.deepEqual(revoked, ['old-refresh', 'new-refresh']);
});
