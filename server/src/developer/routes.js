'use strict';

const config = require('../config');
const { ensureDefaultKey, getDefaultKeyPlain } = require('../platform/user_keys');
const { createSandbox } = require('./sandbox');
const { createDeveloperService } = require('./service');

const CHAT_TIMEOUT_MS = 30_000;

// 沙箱内的大模型调用走平台自己的网关：用开发者默认 Key 计费，
// 与 App 内对话、开放平台调用共用同一套人民币钱包。
function createLlmChat({ db, baseUrl, defaultModel }) {
  return async ({ user, messages, model, max_tokens }) => {
    // 开发者可能还没打开过「我的 API Key」，这里按需补一把默认 Key。
    await ensureDefaultKey(db, user.id);
    const apiKey = await getDefaultKeyPlain(db, user.id);
    if (!apiKey) throw new Error('开发者账号暂无可用 API Key');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
    try {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: model || defaultModel,
          messages,
          max_tokens: max_tokens || 400,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 402) throw new Error('开发者钱包余额不足，无法发起大模型调用');
        throw new Error(`大模型调用失败（${response.status}）`);
      }
      const payload = await response.json().catch(() => null);
      return {
        content: payload?.choices?.[0]?.message?.content || '',
        usage: payload?.usage || null,
        model: payload?.model || model || defaultModel,
      };
    } finally {
      clearTimeout(timer);
    }
  };
}

function createDeveloperRuntime({ db, app }) {
  const baseUrl = process.env.PLATFORM_SELF_URL || `http://127.0.0.1:${config.port}`;
  const defaultModel = process.env.PLATFORM_CHAT_MODEL || 'deepseek/deepseek-chat';
  const sandbox = createSandbox({
    mode: process.env.DEV_SANDBOX_RUNNER || 'disabled',
    endpoint: process.env.DEV_SANDBOX_ENDPOINT || '',
    token: process.env.DEV_SANDBOX_TOKEN || '',
    logger: app?.log,
  });
  const service = createDeveloperService({
    db,
    sandbox,
    llmChat: createLlmChat({ db, baseUrl, defaultModel }),
    maxDailyRuns: Number(process.env.DEV_MAX_DAILY_RUNS) || 50,
  });
  return { sandbox, service };
}

function registerDeveloperRoutes(app, { db, authenticate }) {
  const { service } = createDeveloperRuntime({ db, app });
  const auth = (request) => authenticate(request);

  app.get('/api/v1/developer/profile', async (request) => {
    const { user } = await auth(request);
    return service.getProfile(user);
  });

  app.post(
    '/api/v1/developer/apply',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request) => {
      const { user } = await auth(request);
      return service.apply(user, request.body);
    },
  );

  app.get('/api/v1/developer/skills', async (request) => {
    const { user } = await auth(request);
    return service.listSkills(user);
  });

  app.post(
    '/api/v1/developer/skills',
    { bodyLimit: 96 * 1024, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request) => {
      const { user } = await auth(request);
      return service.createSkill(user, request.body);
    },
  );

  app.get('/api/v1/developer/skills/:id', async (request) => {
    const { user } = await auth(request);
    return service.getSkill(user, request.params.id);
  });

  app.put(
    '/api/v1/developer/skills/:id',
    { bodyLimit: 96 * 1024, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request) => {
      const { user } = await auth(request);
      return service.updateSkill(user, request.params.id, request.body);
    },
  );

  app.post(
    '/api/v1/developer/skills/:id/test',
    { bodyLimit: 32 * 1024, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request) => {
      const { user } = await auth(request);
      return service.testSkill(user, request.params.id, request.body);
    },
  );

  app.post('/api/v1/developer/skills/:id/submit', async (request) => {
    const { user } = await auth(request);
    return service.submitSkill(user, request.params.id);
  });

  app.post('/api/v1/developer/skills/:id/offline', async (request) => {
    const { user } = await auth(request);
    return service.offlineSkill(user, request.params.id);
  });

  return service;
}

module.exports = { registerDeveloperRoutes, createDeveloperRuntime };
