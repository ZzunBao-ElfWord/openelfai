'use strict';
const crypto = require('node:crypto');
const { verifyKey, keyPrefix } = require('./api_key');

function createGateway({ db, billing, upstream }) {
  async function resolveKey(authorization) {
    if (!authorization || !authorization.startsWith('Bearer ')) return null;
    const plain = authorization.slice(7).trim();
    const prefix = keyPrefix(plain);
    const [rows] = await db.execute(
      'SELECT id, user_id, key_hash, allowed_models, qps_limit, revoked_at FROM platform_api_keys WHERE key_prefix = ? LIMIT 1',
      [prefix]
    );
    if (!rows.length) return null;
    const row = rows[0];
    if (row.revoked_at) return null;
    if (!verifyKey(plain, row.key_hash)) return null;
    return row;
  }

  async function chatCompletionsHandler(req, reply) {
    const key = await resolveKey(req.headers.authorization);
    if (!key) {
      return reply.code(401).send({ error: { message: 'invalid api key', type: 'invalid_request_error', code: 'invalid_api_key' } });
    }

    const body = req.body || {};
    const { model, messages, stream = false, max_tokens, temperature } = body;
    if (!model || !Array.isArray(messages)) {
      return reply.code(400).send({ error: { message: 'model and messages required', type: 'invalid_request_error' } });
    }

    // 透传 OpenAI 标准参数：Agent 类工具依赖 tools / tool_choice 发起函数调用，
    // 之前只转发 model/messages/temperature/max_tokens，工具调用会被静默丢弃。
    const FORWARD_KEYS = [
      'tools', 'tool_choice', 'parallel_tool_calls', 'response_format',
      'stop', 'top_p', 'frequency_penalty', 'presence_penalty', 'seed',
      'logprobs', 'top_logprobs', 'user',
    ];
    const passthrough = {};
    for (const k of FORWARD_KEYS) {
      if (body[k] !== undefined) passthrough[k] = body[k];
    }

    const [priceRows] = await db.execute(
      'SELECT input_micro_per_1m, output_micro_per_1m, markup_bp FROM platform_model_price WHERE model_id = ? ORDER BY effective_from DESC LIMIT 1',
      [model]
    );
    if (!priceRows.length) {
      return reply.code(404).send({ error: { message: 'model not found', type: 'invalid_request_error' } });
    }
    const price = priceRows[0];

    // 估算 prompt 长度：兼容多模态 content 数组，并把 tools 定义计入预授权。
    const contentChars = (m) => {
      if (typeof m.content === 'string') return m.content.length;
      if (Array.isArray(m.content)) {
        return m.content.reduce((s, p) => s + (typeof p?.text === 'string' ? p.text.length : 0), 0);
      }
      return 0;
    };
    let promptEst = messages.reduce((s, m) => s + contentChars(m), 0);
    if (passthrough.tools) promptEst += JSON.stringify(passthrough.tools).length;
    const promptTokens = Math.max(1, Math.ceil(promptEst / 2.2));
    const maxTok = max_tokens || 4096;
    const start = Date.now();

    let preauth;
    try {
      preauth = await billing.preauth({
        userId: key.user_id, keyId: key.id, model,
        promptTokens, maxTokens: maxTok,
        price, markupBp: price.markup_bp,
      });
    } catch (e) {
      if (e.statusCode === 402) {
        return reply.code(402).send({ error: { message: '余额不足，请充值', type: 'insufficient_quota', code: 'insufficient_balance' } });
      }
      throw e;
    }

    try {
      if (stream) {
        let completionTokens = 0;
        await upstream.chatCompletionsStream(
          { model, messages, max_tokens: maxTok, temperature, ...passthrough },
          (chunk) => {
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) {
              completionTokens += delta.length;
              reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
            }
          },
          () => {
            reply.raw.writeHead(200, {
              'content-type': 'text/event-stream',
              'cache-control': 'no-cache',
              'x-request-id': preauth.requestId,
            });
          }
        );
        await billing.settle({
          userId: key.user_id, requestId: preauth.requestId, keyId: key.id,
          promptTokens, completionTokens: Math.ceil(completionTokens / 2.2),
          resolvedModel: model, latencyMs: Date.now() - start, ttftMs: 0,
          price, markupBp: price.markup_bp, estimated: true,
        });
        reply.raw.write('data: [DONE]\n\n');
        reply.raw.end();
        return;
      }

      const result = await upstream.chatCompletions({ model, messages, max_tokens: maxTok, temperature, ...passthrough });
      const usage = result.usage || { prompt_tokens: 0, completion_tokens: 0 };
      await billing.settle({
        userId: key.user_id, requestId: preauth.requestId, keyId: key.id,
        promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens,
        resolvedModel: result.model || model, latencyMs: Date.now() - start,
        price, markupBp: price.markup_bp,
      });
      reply.header('x-request-id', preauth.requestId);
      return result;
    } catch (e) {
      await billing.release({ userId: key.user_id, requestId: preauth.requestId });
      if (reply.raw.headersSent) {
        // SSE 已开始下发，只能在流内下发错误并正常收尾。
        reply.raw.write(`data: ${JSON.stringify({ error: { message: 'upstream error', type: 'api_error' } })}\n\n`);
        reply.raw.write('data: [DONE]\n\n');
        reply.raw.end();
        return;
      }
      if (e.statusCode) {
        return reply.code(e.statusCode).send({ error: { message: 'upstream error', type: 'api_error' } });
      }
      throw e;
    }
  }

  async function internalChatHandler(req, reply) {
    const ts = req.headers['x-oe-timestamp'];
    const sig = req.headers['x-oe-signature'];
    const secret = process.env.INTERNAL_CALLBACK_SECRET || 'dev-internal-secret';
    const bodyStr = JSON.stringify(req.body);
    const expected = crypto.createHmac('sha256', secret)
      .update(ts + req.url + crypto.createHash('sha256').update(bodyStr).digest('hex'))
      .digest('hex');
    if (!ts || !sig || Math.abs(Date.now() - Number(ts)) > 300_000 || sig !== expected) {
      return reply.code(401).send({ error: { message: 'invalid signature', type: 'authentication_error' } });
    }
    const { model, messages, ...rest } = req.body;
    try {
      return await upstream.chatCompletions({ model, messages, ...rest });
    } catch (e) {
      if (e.statusCode) {
        return reply.code(e.statusCode).send({ error: { message: 'upstream error', type: 'api_error' } });
      }
      throw e;
    }
  }

  return { chatCompletionsHandler, internalChatHandler, resolveKey };
}

module.exports = { createGateway };
