'use strict';
const { PUSH_TABLES, createPushService, adminAuthorized } = require('./push');

function readPushSettings(env = process.env) {
  return {
    enabled: /^(true|1)$/i.test(env.JPUSH_ENABLED || ''),
    adminToken: env.JPUSH_ADMIN_TOKEN || '',
    android: { appKey: env.JPUSH_ANDROID_APP_KEY || '', masterSecret: env.JPUSH_ANDROID_MASTER_SECRET || '' },
    ios: { appKey: env.JPUSH_IOS_APP_KEY || '', masterSecret: env.JPUSH_IOS_MASTER_SECRET || '' },
  };
}

function registerPush(app, { db, authenticate, settings = readPushSettings(), fetchImpl } = {}) {
  const service = createPushService({ db, settings, fetchImpl });
  // Compatible with older servers: no replacement of db.js, config.js or env.
  // Table creation is lazy and contains only push registration metadata.
  let schemaReady;
  const ensureTables = () => schemaReady ||= (async () => {
    for (const sql of PUSH_TABLES) await db.execute(sql);
  })().catch(error => { schemaReady = null; throw error; });
  const enabled = () => {
    if (!settings.enabled) throw Object.assign(new Error('消息通知暂时不可用，请稍后重试'),
      { statusCode: 503, code: 'PUSH_DISABLED' });
  };
  app.decorate('push', service);
  app.post('/api/v1/push/bind', {
    bodyLimit: 4096, config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async request => {
    const { user, session } = await authenticate(request);
    enabled();
    await ensureTables();
    return service.bind(user, session, request.body);
  });
  app.post('/api/v1/push/unbind', { bodyLimit: 4096 }, async request => {
    const { user, session } = await authenticate(request);
    // Unbind remains possible after sending is disabled. Do not create a new
    // table on a server that never enabled the feature.
    try { return await service.unbind(user, session); }
    catch (error) {
      if (error.code === 'ER_NO_SUCH_TABLE') return { bound: false };
      throw error;
    }
  });
  app.post('/api/v1/internal/push/send', {
    bodyLimit: 4096, config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async request => {
    if (!adminAuthorized(request.headers.authorization, settings.adminToken)) {
      throw Object.assign(new Error('无权发送通知'), { statusCode: 403, code: 'FORBIDDEN' });
    }
    enabled();
    await ensureTables();
    return service.send(request.body?.userId, request.body);
  });
  return service;
}
module.exports = { registerPush, readPushSettings };
