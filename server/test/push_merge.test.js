'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Fastify = require('fastify');
const { registerPush, readPushSettings } = require('../src/push_routes');
const { createPushService, adminAuthorized } = require('../src/push');
const settings = { enabled: true, adminToken: 'push-test-only-token-longer-than-32-characters',
  android: { appKey: 'android-public-test-key', masterSecret: 'test-only-android-secret' },
  ios: { appKey: 'ios-public-test-key', masterSecret: 'test-only-ios-secret' } };

function fixture(enabled = true) {
  const queries = [], devices = [], sent = [];
  const db = { async execute(sql, params = []) {
    queries.push({ sql, params });
    if (sql.startsWith('CREATE TABLE')) return [[], []];
    if (sql.startsWith('INSERT INTO push_devices')) {
      const [platform, registration_id, user_id, device_id, environment] = params;
      const old = devices.findIndex(d => d.platform === platform &&
        (d.registration_id === registration_id || d.device_id === device_id));
      if (old >= 0) devices.splice(old, 1);
      devices.push({ platform, registration_id, user_id, device_id, environment });
      return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith('DELETE FROM push_devices')) {
      const index = devices.findIndex(d => d.user_id === params[0] && d.device_id === params[1]);
      if (index >= 0) devices.splice(index, 1);
      return [{ affectedRows: index >= 0 ? 1 : 0 }, []];
    }
    if (sql.includes('SELECT p.* FROM push_devices')) {
      assert.match(sql, /u.status = 'active'/);
      assert.match(sql, /s.revoked_at IS NULL/);
      assert.match(sql, /s.expires_at > \?/);
      return [devices.filter(d => d.user_id === params[0]), []];
    }
    throw new Error('Unexpected SQL');
  } };
  const app = Fastify();
  const authenticate = async request => {
    if (!['Bearer user-a', 'Bearer user-b'].includes(request.headers.authorization))
      throw Object.assign(new Error('login required'), { statusCode: 401 });
    return { user: { id: request.headers.authorization.slice(7) }, session: { device_id: 'test-device' } };
  };
  registerPush(app, { db, authenticate, settings: { ...settings, enabled },
    fetchImpl: async (_, options) => {
      sent.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ msg_id: 'test-message' }) };
    } });
  return { app, db, queries, devices, sent };
}

test('push merge: env settings default closed; admin auth handles Unicode without throwing', () => {
  assert.equal(readPushSettings({}).enabled, false);
  assert.equal(readPushSettings({ JPUSH_ENABLED: 'true' }).enabled, true);
  assert.equal(adminAuthorized('Bearer ' + settings.adminToken, settings.adminToken), true);
  assert.equal(adminAuthorized('Bearer 中文测试', settings.adminToken), false);
  assert.equal(adminAuthorized('Bearer anything', ''), false);
});

test('push merge: anonymous/regular login never authorizes push send; no DB/network calls', async () => {
  const f = fixture();
  try {
    for (const url of ['/api/v1/push/bind', '/api/v1/push/unbind']) {
      assert.equal((await f.app.inject({ method: 'POST', url, payload: {} })).statusCode, 401);
    }
    assert.equal((await f.app.inject({ method: 'POST', url: '/api/v1/internal/push/send',
      headers: { authorization: 'Bearer user-a' }, payload: {} })).statusCode, 403);
    assert.equal(f.queries.length, 0); assert.equal(f.sent.length, 0);
  } finally { await f.app.close(); }
});

test('push merge: binding uses session identity, switches account atomically, and logout unbinds', async () => {
  const f = fixture();
  const payload = { platform: 'android', registrationId: 'registration-123', environment: 'production', userId: 'forged' };
  try {
    for (const id of ['user-a', 'user-b']) {
      assert.equal((await f.app.inject({ method: 'POST', url: '/api/v1/push/bind',
        headers: { authorization: 'Bearer ' + id }, payload })).statusCode, 200);
      assert.equal(f.devices[0].user_id, id); assert.equal(f.devices.length, 1);
    }
    assert.equal(f.queries.filter(q => q.sql.startsWith('CREATE TABLE')).length, 1);
    await f.app.inject({ method: 'POST', url: '/api/v1/push/unbind',
      headers: { authorization: 'Bearer user-b' }, payload: {} });
    assert.equal(f.devices.length, 0);
  } finally { await f.app.close(); }
});

test('push merge: defaults disabled, never creates schema or sends a notification', async () => {
  const f = fixture(false);
  try {
    const r = await f.app.inject({ method: 'POST', url: '/api/v1/push/bind',
      headers: { authorization: 'Bearer user-a' }, payload: {} });
    assert.equal(r.statusCode, 503); assert.equal(f.queries.length, 0);
    assert.equal(f.sent.length, 0);
  } finally { await f.app.close(); }
});

test('push merge: send targets registration IDs only, correctly separates iOS APNs environments', async () => {
  const f = fixture();
  try {
    f.devices.push({ platform: 'ios', environment: 'production', registration_id: 'ios-prod', user_id: 'user-a' },
      { platform: 'ios', environment: 'development', registration_id: 'ios-dev', user_id: 'user-a' });
    const r = await f.app.inject({ method: 'POST', url: '/api/v1/internal/push/send',
      headers: { authorization: 'Bearer ' + settings.adminToken },
      payload: { userId: 'user-a', title: 'test', alert: 'test message', target: { route: 'home' } } });
    assert.equal(r.statusCode, 200); assert.equal(r.json().accepted, 2);
    assert.equal(f.sent.length, 2);
    assert.deepEqual(f.sent.map(s => s.options.apns_production), [true, false]);
    assert.ok(f.sent.every(s => s.options.time_to_live === 0 && s.audience.registration_id.length === 1));
  } finally { await f.app.close(); }
});

test('push merge: invalid target and provider failure never report successful delivery', async () => {
  const f = fixture();
  try {
    const service = createPushService({ db: f.db, settings,
      fetchImpl: async () => { throw new Error('timeout'); } });
    await assert.rejects(service.send('user-a', { title: 't', alert: 'a', target: { route: 'https://evil.test' } }),
      { code: 'INVALID_PUSH_TARGET' });
    f.devices.push({ platform: 'android', environment: 'production', registration_id: 'android-1', user_id: 'user-a' });
    await assert.rejects(service.send('user-a', { title: 't', alert: 'a', target: { route: 'home' } }),
      { code: 'PUSH_PROVIDER_ERROR' });
  } finally { await f.app.close(); }
});
