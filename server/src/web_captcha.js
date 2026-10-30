'use strict';

function publicWebCaptcha(settings) {
  const scheme = settings?.schemes?.web;
  const mode = settings?.webMode || 'off';
  const configured = Boolean(settings?.enabled && scheme?.appId && scheme?.appKey);
  // 只有显式开启 enforce 时才要求网页端渲染图形验证控件。
  const enabled = configured && mode === 'enforce';
  return {
    enabled,
    mode,
    appId: enabled ? scheme.appId : null,
    platform: 'web',
    provider: 'aliyun-pnvs',
  };
}

function registerWebCaptcha(app, { settings, verifier }) {
  app.get('/api/v1/auth/captcha/config', async (_request, reply) => {
    return reply.header('Cache-Control', 'no-store').send(publicWebCaptcha(settings));
  });
  // Diagnostic only: never issues a login token or sends a billable SMS.
  // After this check, obtain a NEW proof before invoking send-code.
  app.post('/api/v1/auth/captcha/check', {
    bodyLimit: 16 * 1024,
    config: { rateLimit: { max: 8, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    if (!publicWebCaptcha(settings).enabled) {
      return reply.code(503).send({ error: { code: 'CAPTCHA_NOT_CONFIGURED', message: '网页图形验证尚未配置' } });
    }
    await verifier.verify({ ...request.body, platform: 'web' });
    return reply.header('Cache-Control', 'no-store').send({ passed: true, smsSent: false });
  });
}
module.exports = { publicWebCaptcha, registerWebCaptcha };
