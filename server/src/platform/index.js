'use strict';
const fp = require('fastify-plugin');
const config = require('./config');
const { createBillingService } = require('./billing');
const { createUpstream } = require('./upstream');
const { createGateway } = require('./gateway');

async function platformPlugin(fastify, opts) {
  const db = fastify.db;
  const billing = createBillingService(db);
  const upstream = createUpstream({
    baseUrl: config.litellm.baseUrl,
    masterKey: config.litellm.masterKey,
    timeoutMs: config.litellm.timeoutMs,
  });
  const gateway = createGateway({ db, billing, upstream });

  // App 内对话的上下文最多约 1 万字符（中文 UTF-8 会超过默认 16KB），因此单独放宽该路由。
  // 外部 Agent 类工具单次请求会带上大量历史与工具定义，64KB 会直接 413，按 4MB 放宽。
  fastify.post('/v1/chat/completions', { bodyLimit: 4 * 1024 * 1024 }, gateway.chatCompletionsHandler);
  fastify.post('/internal/v1/chat/completions', { bodyLimit: 4 * 1024 * 1024 }, gateway.internalChatHandler);

  fastify.get('/v1/models', async (req, reply) => {
    const [rows] = await db.execute("SELECT model_id, display_name FROM platform_model_catalog WHERE status = 'active'");
    return {
      object: 'list',
      data: rows.map((r) => ({ id: r.model_id, object: 'model', owned_by: 'openelf' })),
    };
  });

  fastify.get('/health', async () => ({ status: 'ok' }));
}

module.exports = fp(platformPlugin, { name: 'platform' });
