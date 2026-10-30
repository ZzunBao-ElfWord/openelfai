'use strict';

const crypto = require('node:crypto');

const REQUIRED_FIELDS = ['lot_number', 'pass_token', 'gen_time', 'captcha_output'];

class CaptchaError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'CaptchaError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function clean(value, maxLength = 8192) {
  if (typeof value !== 'string') return '';
  const result = value.trim();
  return result.length <= maxLength ? result : '';
}

function webCaptchaEnforced(settings) {
  return (settings?.webMode || 'off') === 'enforce';
}

function createCaptchaVerifier(settings, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  if (!settings.enabled) {
    return {
      enabled: false,
      async verify(payload) {
        if (clean(payload?.platform, 16).toLowerCase() === 'web') {
          // 网页端未启用图形验证时不做拦截，安全性由手机号/IP 频控兜底。
          if (!webCaptchaEnforced(settings)) return { passed: true, skipped: 'web_captcha_off' };
          throw new CaptchaError(503, 'CAPTCHA_UNAVAILABLE', '网页图形验证尚未启用');
        }
        return { passed: true, disabled: true };
      },
    };
  }

  if (typeof fetchImpl !== 'function') {
    throw new Error('当前 Node.js 运行时不支持 fetch');
  }

  for (const platform of ['android', 'ios']) {
    const scheme = settings.schemes[platform];
    if (!scheme?.appId || !scheme?.appKey) {
      throw new Error(`阿里云图形验证 ${platform} 方案未配置`);
    }
  }

  return {
    enabled: true,

    async verify(payload) {
      const platform = clean(payload?.platform, 16).toLowerCase();
      if (!['android', 'ios', 'web'].includes(platform)) {
        throw new CaptchaError(400, 'INVALID_CAPTCHA_PLATFORM', '图形验证平台不正确');
      }
      // 网页端在 webMode!=enforce 时只做频控，不要求阿里云 H5 证明。
      if (platform === 'web' && !webCaptchaEnforced(settings)) {
        return { passed: true, skipped: 'web_captcha_off' };
      }
      const scheme = settings.schemes[platform];
      if (!scheme?.appId || !scheme?.appKey) {
        throw new CaptchaError(503, 'CAPTCHA_NOT_CONFIGURED', '对应平台的图形验证尚未配置');
      }

      const proof = {};
      for (const field of REQUIRED_FIELDS) {
        proof[field] = clean(payload?.[field]);
        if (!proof[field]) {
          throw new CaptchaError(400, 'CAPTCHA_REQUIRED', '请先完成图形验证');
        }
      }

      const signToken = crypto
        .createHmac('sha256', scheme.appKey)
        .update(proof.lot_number)
        .digest('hex');
      const body = new URLSearchParams({
        ...proof,
        sign_token: signToken,
      });
      const url = new URL(settings.endpoint);
      url.searchParams.set('captcha_id', scheme.appId);

      try {
        const response = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body,
          signal: AbortSignal.timeout(settings.timeoutMs),
        });
        if (!response.ok) {
          throw new Error(`captcha upstream returned ${response.status}`);
        }
        const result = await response.json();
        if (result?.result !== 'success') {
          throw new CaptchaError(400, 'CAPTCHA_REJECTED', '图形验证未通过，请重试');
        }
        return { passed: true };
      } catch (error) {
        if (error instanceof CaptchaError) throw error;
        // Web must fail closed even if old mobile clients allow outage fallback.
        if (platform !== 'web' && settings.allowOnError) {
          return { passed: true, fallback: true };
        }
        throw new CaptchaError(503, 'CAPTCHA_UNAVAILABLE', '图形验证服务暂时不可用，请稍后重试');
      }
    },
  };
}

module.exports = { CaptchaError, createCaptchaVerifier };
