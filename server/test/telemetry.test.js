'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createTelemetry } = require('../src/platform/telemetry');
const { createUpstream } = require('../src/platform/upstream');

// 打桩 fetch：mock 一个全局 fetch，返回预设响应并记录请求体。
function stubFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : null });
    return handler(url, init);
  };
  return {
    calls,
    restore() { globalThis.fetch = original; },
  };
}

function makeTelemetrySpy() {
  const started = [];
  const ended = [];
  return {
    enabled: true,
    startGeneration(ctx) {
      started.push(ctx);
      return {
        end(payload) { ended.push(payload); },
      };
    },
    started,
    ended,
  };
}

test('telemetry 未配置密钥时为无操作实现', async () => {
  const t = createTelemetry({ enabled: true, publicKey: '', secretKey: '' });
  assert.equal(t.enabled, false);
  const gen = t.startGeneration({ name: 'x' });
  assert.doesNotThrow(() => gen.end({ output: 'ok' }));
  await t.flush();
  await t.shutdown();
});

test('upstream 非流式：成功时上报输出与 usage，且 trace 不转发上游', async () => {
  const telemetry = makeTelemetrySpy();
  const stub = stubFetch(async () => new Response(JSON.stringify({
    model: 'deepseek-chat',
    choices: [{ message: { role: 'assistant', content: '你好' } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }), { status: 200 }));

  const upstream = createUpstream({ baseUrl: 'http://litellm', masterKey: 'k', telemetry });
  try {
    const result = await upstream.chatCompletions({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'hi' }],
      trace: { name: 'test/call', userId: 'u1', sessionId: 's1', tags: ['t'], metadata: { a: 1 } },
    });
    assert.equal(result.choices[0].message.content, '你好');

    // trace 字段不得出现在发往上游的请求体里
    assert.equal('trace' in stub.calls[0].body, false);
    assert.equal(stub.calls[0].body.model, 'deepseek-chat');

    assert.equal(telemetry.started.length, 1);
    assert.equal(telemetry.started[0].name, 'test/call');
    assert.equal(telemetry.started[0].userId, 'u1');
    assert.equal(telemetry.started[0].sessionId, 's1');
    assert.equal(telemetry.ended.length, 1);
    assert.deepEqual(telemetry.ended[0].usage, { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
    assert.equal(telemetry.ended[0].output.content, '你好');
    assert.equal(telemetry.ended[0].statusMessage, undefined);
  } finally {
    stub.restore();
  }
});

test('upstream 非流式：上游报错时按 ERROR 结束 generation', async () => {
  const telemetry = makeTelemetrySpy();
  const stub = stubFetch(async () => new Response('boom', { status: 500 }));

  const upstream = createUpstream({ baseUrl: 'http://litellm', masterKey: 'k', telemetry });
  try {
    await assert.rejects(
      upstream.chatCompletions({
        model: 'm',
        messages: [{ role: 'user', content: 'hi' }],
        trace: { name: 'test/err' },
      }),
      (err) => err.message === 'upstream_error' && err.statusCode === 500,
    );
    assert.equal(telemetry.ended.length, 1);
    assert.ok(telemetry.ended[0].statusMessage.includes('500'));
  } finally {
    stub.restore();
  }
});

test('upstream 流式：累计全文、记录 TTFT 与 usage', async () => {
  const telemetry = makeTelemetrySpy();
  const sse = [
    'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
    'data: {"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n',
    'data: [DONE]\n\n',
  ].join('');
  const stub = stubFetch(async () => new Response(sse, { status: 200 }));

  const upstream = createUpstream({ baseUrl: 'http://litellm', masterKey: 'k', telemetry });
  try {
    let ready = false;
    const chunks = [];
    const { usage } = await upstream.chatCompletionsStream(
      {
        model: 'm',
        messages: [{ role: 'user', content: 'hi' }],
        trace: { name: 'test/stream' },
      },
      (obj) => chunks.push(obj),
      () => { ready = true; },
    );
    assert.equal(ready, true);
    assert.equal(usage.total_tokens, 5);
    // trace 不得转发
    assert.equal('trace' in stub.calls[0].body, false);

    assert.equal(telemetry.ended.length, 1);
    assert.equal(telemetry.ended[0].output, '你好');
    assert.deepEqual(telemetry.ended[0].usage, { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 });
    assert.ok(telemetry.ended[0].completionStartTime instanceof Date);
  } finally {
    stub.restore();
  }
});

test('upstream 无 telemetry 时行为不变（零依赖回归）', async () => {
  const stub = stubFetch(async () => new Response(JSON.stringify({
    choices: [{ message: { role: 'assistant', content: 'ok' } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }), { status: 200 }));

  const upstream = createUpstream({ baseUrl: 'http://litellm', masterKey: 'k' });
  try {
    const result = await upstream.chatCompletions({ model: 'm', messages: [] });
    assert.equal(result.choices[0].message.content, 'ok');
  } finally {
    stub.restore();
  }
});
