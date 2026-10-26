'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

test('chatCompletions 非流式返回 usage', async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ id: 'x', usage: { prompt_tokens: 10, completion_tokens: 5 }, choices: [{ message: { content: 'hi' } }] }));
  });
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const { createUpstream } = require('../src/platform/upstream');
  const upstream = createUpstream({ baseUrl: `http://127.0.0.1:${port}`, masterKey: 'k' });
  const result = await upstream.chatCompletions({ model: 'm', messages: [] });
  assert.equal(result.usage.prompt_tokens, 10);
  server.close();
});

test('chatCompletions 上游返回错误时抛 statusCode', async () => {
  const server = http.createServer((req, res) => {
    res.statusCode = 429;
    res.end('rate limited');
  });
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const { createUpstream } = require('../src/platform/upstream');
  const upstream = createUpstream({ baseUrl: `http://127.0.0.1:${port}`, masterKey: 'k' });
  try {
    await upstream.chatCompletions({ model: 'm', messages: [] });
    assert.fail('should throw');
  } catch (e) {
    assert.equal(e.statusCode, 429);
  }
  server.close();
});
