'use strict';

function env(name, fallback) {
  const v = process.env[name];
  return v == null ? fallback : v;
}

function envInt(name, fallback) {
  const v = process.env[name];
  if (v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

module.exports = {
  litellm: {
    baseUrl: env('LITELLM_BASE_URL', 'http://127.0.0.1:4000'),
    masterKey: env('LITELLM_MASTER_KEY', ''),
    timeoutMs: envInt('LITELLM_TIMEOUT_MS', 60000),
  },
  key: {
    pepper: env('PLATFORM_KEY_PEPPER', 'dev-pepper-change-me'),
    prefixLength: 12,
    secretLength: 40,
  },
  billing: {
    defaultMaxTokens: envInt('PLATFORM_DEFAULT_MAX_TOKENS', 4096),
    freezeTtlMs: envInt('PLATFORM_FREEZE_TTL_MS', 180000),
    markupBp: {
      domestic_external: envInt('PLATFORM_MARKUP_DOMESTIC', 1150),
      internal: 1000,
    },
  },
  rateLimit: {
    defaultQps: envInt('PLATFORM_DEFAULT_QPS', 5),
  },
};
