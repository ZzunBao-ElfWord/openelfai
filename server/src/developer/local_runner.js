'use strict';

// 本地沙箱子进程：只用 vm 执行单文件技能源码，宿主能力通过 IPC 请求父进程。
// 这是开发/测试用的受限执行环境，生产环境应切换到函数计算 runner。

const vm = require('node:vm');

const pending = new Map();
let seq = 0;
let llmCalls = 0;
let llmLimit = 0;

function send(message) {
  if (process.send) process.send(message);
}

function safeOutput(value) {
  try {
    return JSON.parse(JSON.stringify(value === undefined ? null : value));
  } catch (_) {
    throw new Error('技能返回值必须是可 JSON 序列化的数据');
  }
}

async function run(payload) {
  const { source, input, limits } = payload;
  llmLimit = Number(limits?.max_llm_calls ?? 0);
  const inputLimit = Number(limits?.max_input_chars ?? 2000);
  const started = Date.now();

  const quiet = () => {};
  const sandboxConsole = { log: quiet, info: quiet, warn: quiet, error: quiet, debug: quiet };

  if (Buffer.byteLength(JSON.stringify(input ?? null), 'utf8') > inputLimit) {
    throw new Error(`输入内容超过 ${inputLimit} 字符上限`);
  }

  function chat(messages, options = {}) {
    if (!Array.isArray(messages) || !messages.length) {
      return Promise.reject(new Error('ctx.llm.chat 需要非空 messages 数组'));
    }
    if (llmCalls >= llmLimit) {
      return Promise.reject(new Error('大模型调用次数超出本次运行上限'));
    }
    llmCalls += 1;
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      send({
        type: 'llm',
        id,
        messages,
        model: typeof options.model === 'string' ? options.model : undefined,
        max_tokens: Number.isInteger(options.max_tokens) ? options.max_tokens : undefined,
      });
    });
  }

  function requireStub(name) {
    throw new Error(`沙箱内不允许加载模块：${name}`);
  }

  const context = vm.createContext({
    console: sandboxConsole,
    setTimeout,
    clearTimeout,
    setInterval: undefined,
    clearInterval: undefined,
  });

  const wrapped = new vm.Script(
    `(function (exports, require, module) {\n${source}\n})`,
    { filename: 'skill.js' },
  ).runInNewContext(context);

  const moduleObj = { exports: {} };
  wrapped(moduleObj.exports, requireStub, moduleObj);

  const handler = moduleObj.exports && moduleObj.exports.handler
    ? moduleObj.exports.handler
    : moduleObj.exports;
  if (typeof handler !== 'function') {
    throw new Error('技能必须通过 exports.handler 导出函数');
  }

  const event = Object.freeze({ input: input === undefined ? null : input });
  const ctx = Object.freeze({
    llm: Object.freeze({ chat }),
    log: sandboxConsole,
  });

  const output = await handler(event, ctx);
  send({ type: 'result', ok: true, output: safeOutput(output), duration_ms: Date.now() - started, llm_calls: llmCalls });
}

process.on('message', (message) => {
  if (!message || typeof message !== 'object') return;

  if (message.type === 'llm_reply') {
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(String(message.error)));
    else entry.resolve(message.result ?? null);
    return;
  }

  if (message.type !== 'run') return;

  run(message)
    .catch((error) => {
      send({
        type: 'result',
        ok: false,
        error: String(error && error.message ? error.message : error).slice(0, 255),
        duration_ms: 0,
        llm_calls: llmCalls,
      });
    })
    .finally(() => {
      // 结果已经回传，父进程收到后立即回收子进程。
      setTimeout(() => process.exit(0), 20);
    });
});

send({ type: 'ready' });
