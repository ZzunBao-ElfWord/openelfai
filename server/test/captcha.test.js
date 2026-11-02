'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { CaptchaError, createCaptchaVerifier } = require('../src/captcha');

const settings = {
  enabled: true,
  allowOnError: false,
  endpoint: 'https://captcha.alicaptcha.com/validate',
  timeoutMs: 1000,
  schemes: {
    android: { appId: 'android-id', appKey: 'android-secret' },
    ios: { appId: 'ios-id', appKey: 'ios-secret' },
  },
};

const proof = {
  platform: 'android',
  lot_number: 'lot-123',
  pass_token: 'pass-token',
  gen_time: '1700000000',
  captcha_output: 'output',
};

test('提交阿里云 Captcha4 要求的表单和签名', async () => {
  let request;
  const verifier = createCaptchaVerifier(settings, {
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, async json() { return { result: 'success' }; } };
    },
  });

  assert.deepEqual(await verifier.verify(proof), { passed: true });
  assert.equal(request.url.searchParams.get('captcha_id'), 'android-id');
  assert.equal(request.options.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.equal(request.options.body.get('lot_number'), proof.lot_number);
  assert.equal(
    request.options.body.get('sign_token'),
    crypto.createHmac('sha256', 'android-secret').update(proof.lot_number).digest('hex'),
  );
});

test('阿里云明确拒绝时拦截短信发送', async () => {
  const verifier = createCaptchaVerifier(settings, {
    fetchImpl: async () => ({
      ok: true,
      async json() { return { result: 'fail', reason: 'invalid' }; },
    }),
  });

  await assert.rejects(
    () => verifier.verify(proof),
    (error) => error instanceof CaptchaError && error.code === 'CAPTCHA_REJECTED',
  );
});

test('缺少验证凭证时不请求上游', async () => {
  const verifier = createCaptchaVerifier(settings, {
    fetchImpl: async () => assert.fail('不应请求阿里云'),
  });

  await assert.rejects(
    () => verifier.verify({ platform: 'android' }),
    (error) => error instanceof CaptchaError && error.code === 'CAPTCHA_REQUIRED',
  );
});

test('上游异常可按配置使用限流兜底放行', async () => {
  const verifier = createCaptchaVerifier(
    { ...settings, allowOnError: true },
    { fetchImpl: async () => { throw new Error('timeout'); } },
  );

  assert.deepEqual(await verifier.verify(proof), { passed: true, fallback: true });
});

test('网页默认强制验证，配置缺失不能静默跳过', async () => {
  const verifier = createCaptchaVerifier(settings, {
    fetchImpl: async () => assert.fail('缺少配置时不应请求阿里云'),
  });
  await assert.rejects(verifier.verify({ platform: 'web' }), { code: 'CAPTCHA_NOT_CONFIGURED' });
  const disabled = createCaptchaVerifier({ ...settings, enabled: false });
  await assert.rejects(disabled.verify({ platform: 'web' }), { code: 'CAPTCHA_UNAVAILABLE' });
});

test('网页已配置时默认、空值和未知模式均要求真实凭证', async () => {
  const schemes = { ...settings.schemes, web: { appId: 'web-id', appKey: 'web-secret' } };
  for (const webMode of [undefined, '', 'enforce', 'typo']) {
    const verifier = createCaptchaVerifier({ ...settings, schemes, webMode }, {
      fetchImpl: async () => ({ ok: true, json: async () => ({ result: 'success' }) }),
    });
    await assert.rejects(verifier.verify({ platform: 'web' }), { code: 'CAPTCHA_REQUIRED' });
    assert.deepEqual(await verifier.verify({ ...proof, platform: 'web' }), { passed: true });
    const config = require('../src/web_captcha').publicWebCaptcha({ ...settings, schemes, webMode });
    assert.equal(config.enabled, true);
    assert.equal(config.mode, 'enforce');
    assert.equal(config.appId, 'web-id');
    assert.equal(config.appKey, undefined);
  }
});

test('网页端 enforce 模式必须带完整凭证', async () => {
  const verifier = createCaptchaVerifier(
    { ...settings, webMode: 'enforce', schemes: { ...settings.schemes, web: { appId: 'web-id', appKey: 'web-secret' } } },
    { fetchImpl: async () => ({ ok: true, async json() { return { result: 'success' }; } }) },
  );

  await assert.rejects(
    () => verifier.verify({ platform: 'web' }),
    (error) => error instanceof CaptchaError && error.code === 'CAPTCHA_REQUIRED',
  );
  assert.deepEqual(await verifier.verify({ ...proof, platform: 'web' }), { passed: true });
});
