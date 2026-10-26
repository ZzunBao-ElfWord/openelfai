'use strict';
// 全部依赖（db / billing / upstream）均为内存 fake，不连接 MySQL，也不发起真实网络请求。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Fastify = require('fastify');
const { createGateway } = require('../src/platform/gateway');
const { generateKey, hashKey } = require('../src/platform/api_key');

const PRICE = { input_micro_per_1m: 1_000_000, output_micro_per_1m: 2_000_000, markup_bp: 1150 };

function makeDb({ keyRow = null, priceRows = [PRICE] } = {}) {
  const calls = [];
  return {
    calls,
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('platform_api_keys')) return [keyRow ? [keyRow] : [], []];
      if (sql.includes('platform_model_price')) return [priceRows, []];
      throw new Error('Unexpected SQL in gateway test: ' + sql);
    },
  };
}

function makeBilling({ requestId = 'req_test_1', preauthError = null } = {}) {
  const calls = { preauth: [], settle: [], release: [] };
  return {
    calls,
    async preauth(args) {
      calls.preauth.push(args);
      if (preauthError) throw preauthError;
      return { requestId, frozen: 1000 };
    },
    async settle(args) {
      calls.settle.push(args);
      return { charged: 1, actualCost: 1, actualPrice: 1 };
    },
    async release(args) {
      calls.release.push(args);
    },
  };
}

function makeUpstream({ result = null, chatError = null, chunks = [], streamError = null } = {}) {
  const calls = { chat: [], stream: [] };
  return {
    calls,
    async chatCompletions(args) {
      calls.chat.push(args);
      if (chatError) throw chatError;
      return result;
    },
    async chatCompletionsStream(args, onChunk, onReady) {
      calls.stream.push(args);
      if (streamError) throw streamError;
      if (onReady) onReady();
      for (const chunk of chunks) onChunk(chunk);
      return { usage: { prompt_tokens: 1, completion_tokens: 2 } };
    },
  };
}

async function setup({ priceRows, billingOpts, upstreamOpts, keyRowOverrides } = {}) {
  const { plain } = generateKey();
  const keyRow = {
    id: 'key_1', user_id: 'user_1', key_hash: hashKey(plain),
    allowed_models: null, qps_limit: 5, revoked_at: null, ...keyRowOverrides,
  };
  const db = makeDb({ keyRow, priceRows });
  const billing = makeBilling(billingOpts);
  const upstream = makeUpstream(upstreamOpts);
  const app = Fastify({ logger: false });
  app.decorate('db', db);
  const gateway = createGateway({ db, billing, upstream });
  app.post('/v1/chat/completions', gateway.chatCompletionsHandler);
  await app.ready();
  return { app, db, billing, upstream, plain, keyRow };
}

const BODY = { model: 'deepseek/deepseek-chat', messages: [{ role: 'user', content: '你好' }] };

test('缺少 Authorization 返回 401，且不调用 billing.preauth', async () => {
  const { app, billing } = await setup();
  try {
    const res = await app.inject({ method: 'POST', url: '/v1/chat/completions', payload: BODY });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().error.code, 'invalid_api_key');
    assert.equal(billing.calls.preauth.length, 0);
  } finally {
    await app.close();
  }
});

test('Authorization 密钥错误返回 401，且不调用 billing.preauth', async () => {
  const { app, billing, plain } = await setup();
  try {
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions', payload: BODY,
      headers: { authorization: 'Bearer ' + plain + '-wrong' },
    });
    assert.equal(res.statusCode, 401);
    assert.equal(billing.calls.preauth.length, 0);
  } finally {
    await app.close();
  }
});

test('model 不在价格表中返回 404，且不调用 billing.preauth', async () => {
  const { app, billing, plain } = await setup({ priceRows: [] });
  try {
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions', payload: BODY,
      headers: { authorization: 'Bearer ' + plain },
    });
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().error.message, 'model not found');
    assert.equal(billing.calls.preauth.length, 0);
  } finally {
    await app.close();
  }
});

test('billing.preauth 抛 402 时返回 insufficient_balance', async () => {
  const err = new Error('insufficient_balance');
  err.statusCode = 402;
  const { app, plain } = await setup({ billingOpts: { preauthError: err } });
  try {
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions', payload: BODY,
      headers: { authorization: 'Bearer ' + plain },
    });
    assert.equal(res.statusCode, 402);
    assert.equal(res.json().error.code, 'insufficient_balance');
  } finally {
    await app.close();
  }
});

test('非流式成功：透传 choices、按上游 usage 结算并返回 x-request-id', async () => {
  const upstreamResult = {
    id: 'chatcmpl_1',
    object: 'chat.completion',
    model: 'deepseek/deepseek-chat-2026',
    usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    choices: [{ index: 0, message: { role: 'assistant', content: '你好呀' }, finish_reason: 'stop' }],
  };
  const { app, billing, upstream, plain } = await setup({
    billingOpts: { requestId: 'req_abc' },
    upstreamOpts: { result: upstreamResult },
  });
  try {
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions', payload: BODY,
      headers: { authorization: 'Bearer ' + plain },
    });
    assert.equal(res.statusCode, 200);
    const json = res.json();
    assert.deepEqual(json.choices, upstreamResult.choices);
    assert.equal(json.usage.prompt_tokens, 11);
    assert.equal(json.usage.completion_tokens, 7);
    assert.equal(res.headers['x-request-id'], 'req_abc');

    assert.equal(upstream.calls.chat.length, 1);
    assert.equal(billing.calls.settle.length, 1);
    assert.equal(billing.calls.settle[0].requestId, 'req_abc');
    assert.equal(billing.calls.settle[0].promptTokens, 11);
    assert.equal(billing.calls.settle[0].completionTokens, 7);
    assert.equal(billing.calls.settle[0].resolvedModel, 'deepseek/deepseek-chat-2026');
    assert.equal(billing.calls.release.length, 0);
  } finally {
    await app.close();
  }
});

test('Agent 参数透传：tools / tool_choice / top_p 传给上游，并计入预授权 token 估算', async () => {
  const upstreamResult = {
    model: 'deepseek/deepseek-chat',
    choices: [{ message: { role: 'assistant', content: 'ok' } }],
    usage: { prompt_tokens: 30, completion_tokens: 3 },
  };
  const { app, billing, upstream, plain } = await setup({ upstreamOpts: { result: upstreamResult } });
  try {
    const tools = [{
      type: 'function',
      function: {
        name: 'read_file',
        description: '读取本地文件内容'.repeat(20),
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
      },
    }];
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: { ...BODY, tools, tool_choice: 'auto', top_p: 0.9 },
      headers: { authorization: 'Bearer ' + plain },
    });
    assert.equal(res.statusCode, 200);
    const sent = upstream.calls.chat[0];
    assert.deepEqual(sent.tools, tools);
    assert.equal(sent.tool_choice, 'auto');
    assert.equal(sent.top_p, 0.9);
    // tools 定义的字符数要计入 prompt 估算，避免预授权偏低。
    assert.ok(billing.calls.preauth[0].promptTokens > 11);
  } finally {
    await app.close();
  }
});

test('上游 chatCompletions 抛 statusCode=500 时透传 5xx 并释放冻结', async () => {
  const err = new Error('upstream_error');
  err.statusCode = 500;
  const { app, billing, plain } = await setup({
    billingOpts: { requestId: 'req_fail' },
    upstreamOpts: { chatError: err },
  });
  try {
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions', payload: BODY,
      headers: { authorization: 'Bearer ' + plain },
    });
    assert.equal(res.statusCode, 500);
    assert.equal(res.json().error.message, 'upstream error');
    assert.equal(billing.calls.settle.length, 0);
    assert.equal(billing.calls.release.length, 1);
    assert.equal(billing.calls.release[0].requestId, 'req_fail');
  } finally {
    await app.close();
  }
});

test('流式上游在响应头下发前失败：返回 5xx JSON 并释放冻结', async () => {
  const err = new Error('upstream_error');
  err.statusCode = 429;
  const { app, billing, plain } = await setup({
    billingOpts: { requestId: 'req_stream_fail' },
    upstreamOpts: { streamError: err },
  });
  try {
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      payload: { ...BODY, stream: true },
      headers: { authorization: 'Bearer ' + plain },
    });
    assert.equal(res.statusCode, 429);
    assert.equal(res.json().error.message, 'upstream error');
    assert.equal(billing.calls.settle.length, 0);
    assert.equal(billing.calls.release.length, 1);
    assert.equal(billing.calls.release[0].requestId, 'req_stream_fail');
  } finally {
    await app.close();
  }
});

test('流式成功：返回 SSE 文本并以 estimated=true 结算', async () => {
  const chunks = [
    { id: 'chatcmpl_s1', choices: [{ index: 0, delta: { role: 'assistant', content: '你好' } }] },
    { id: 'chatcmpl_s1', choices: [{ index: 0, delta: { content: '呀' } }] },
  ];
  const { app, billing, upstream, plain } = await setup({
    billingOpts: { requestId: 'req_stream' },
    upstreamOpts: { chunks },
  });
  try {
    const res = await app.inject({
      method: 'POST', url: '/v1/chat/completions',
      payload: { ...BODY, stream: true },
      headers: { authorization: 'Bearer ' + plain },
    });
    assert.equal(res.statusCode, 200);
    assert.match(String(res.headers['content-type']), /text\/event-stream/);
    assert.ok(res.body.includes('data: {'));
    assert.ok(res.body.includes('"content":"你好"'));
    assert.ok(res.body.includes('"content":"呀"'));
    assert.ok(res.body.includes('data: [DONE]'));

    assert.equal(upstream.calls.stream.length, 1);
    assert.equal(billing.calls.settle.length, 1);
    assert.equal(billing.calls.settle[0].requestId, 'req_stream');
    assert.equal(billing.calls.settle[0].estimated, true);
    assert.equal(billing.calls.release.length, 0);
  } finally {
    await app.close();
  }
});
