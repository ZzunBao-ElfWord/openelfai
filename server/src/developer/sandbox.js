'use strict';

const path = require('node:path');
const { fork } = require('node:child_process');

const LOCAL_RUNNER = path.join(__dirname, 'local_runner.js');

function fail(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

/**
 * 技能沙箱：两种实现共用一个 run 接口。
 * - local：fork 子进程 + vm 执行，宿主能力走 IPC 回到父进程（开发/测试）。
 * - fc：把源码投递给阿里云函数计算，由独立运行环境执行（生产）。
 * 未配置时统一 disabled，调试接口返回 503，不影响入驻与技能编辑。
 */
function createSandbox({ mode = 'disabled', endpoint = '', token = '', llmChat, logger = null } = {}) {
  const runner = mode === 'local' || mode === 'fc' ? mode : 'disabled';

  function status() {
    const enabled = runner === 'local' || (runner === 'fc' && Boolean(endpoint));
    return { mode: runner, enabled, production_ready: runner === 'fc' && Boolean(endpoint) };
  }

  function requireEnabled() {
    if (!status().enabled) {
      throw fail(503, 'SANDBOX_UNAVAILABLE', '沙箱尚未启用，暂时无法调试技能');
    }
  }

  function childEnv() {
    const env = { NODE_ENV: 'production', OPENELF_SANDBOX: '1' };
    for (const key of ['SystemRoot', 'SYSTEMROOT', 'windir', 'PATH', 'TEMP', 'TMP', 'HOME']) {
      if (process.env[key]) env[key] = process.env[key];
    }
    return env;
  }

  function runLocal({ source, input, limits, chatFn }) {
    return new Promise((resolve) => {
      const child = fork(LOCAL_RUNNER, [], {
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        env: childEnv(),
        execArgv: [],
        windowsHide: true,
      });

      let settled = false;
      let calls = 0;
      let stdout = '';
      let stderr = '';
      const started = Date.now();

      const timer = setTimeout(() => {
        finish({ ok: false, error: `执行超时（${limits.timeout_ms}ms）` });
      }, limits.timeout_ms + 500);

      function finish(result) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          child.kill('SIGKILL');
        } catch (_) {
          /* 子进程可能已经退出 */
        }
        resolve({
          ok: Boolean(result.ok),
          output: result.output ?? null,
          error: result.error || null,
          llm_calls: Number(result.llm_calls || calls),
          duration_ms: Number(result.duration_ms || Date.now() - started),
          stdout: stdout.slice(-2000),
          stderr: stderr.slice(-1000),
        });
      }

      child.stdout?.on('data', (chunk) => {
        stdout = (stdout + chunk.toString()).slice(-4000);
      });
      child.stderr?.on('data', (chunk) => {
        stderr = (stderr + chunk.toString()).slice(-2000);
      });

      child.on('message', async (message) => {
        if (!message || typeof message !== 'object') return;

        if (message.type === 'ready') {
          child.send({ type: 'run', source, input, limits });
          return;
        }

        if (message.type === 'llm') {
          calls += 1;
          if (typeof chatFn !== 'function') {
            child.connected && child.send({
              type: 'llm_reply',
              id: message.id,
              error: '沙箱缺少大模型通道',
            });
            return;
          }
          if (calls > limits.max_llm_calls) {
            child.connected && child.send({
              type: 'llm_reply',
              id: message.id,
              error: '大模型调用次数超出本次运行上限',
            });
            return;
          }
          try {
            const result = await chatFn({
              messages: message.messages,
              model: message.model,
              max_tokens: message.max_tokens,
            });
            if (child.connected) {
              child.send({ type: 'llm_reply', id: message.id, result });
            }
          } catch (error) {
            if (child.connected) {
              child.send({
                type: 'llm_reply',
                id: message.id,
                error: String(error && error.message ? error.message : '大模型调用失败').slice(0, 200),
              });
            }
          }
          return;
        }

        if (message.type === 'result') {
          finish({
            ok: message.ok,
            output: message.output,
            error: message.error,
            duration_ms: message.duration_ms,
            llm_calls: message.llm_calls,
          });
        }
      });

      child.on('error', (error) => finish({ ok: false, error: `沙箱启动失败：${error.message}` }));
      child.on('exit', (code) => finish({ ok: false, error: `执行进程异常退出（${code}）` }));
    });
  }

  async function runFc({ manifest, source, input, limits }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), limits.timeout_ms + 2000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          runtime: manifest.runtime,
          source,
          manifest,
          event: { input },
          limits,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw fail(502, 'SANDBOX_FAILED', `沙箱执行失败（${response.status}）`);
      }
      const data = await response.json().catch(() => null);
      if (!data || typeof data !== 'object') {
        throw fail(502, 'SANDBOX_FAILED', '沙箱返回格式异常');
      }
      return {
        ok: Boolean(data.ok),
        output: data.output ?? null,
        error: data.error ? String(data.error).slice(0, 255) : null,
        llm_calls: Number(data.llm_calls || 0),
        duration_ms: Number(data.duration_ms || 0),
        stdout: '',
        stderr: '',
      };
    } catch (error) {
      if (error.name === 'AbortError') {
        throw fail(504, 'SANDBOX_TIMEOUT', '沙箱执行超时');
      }
      if (error.statusCode) throw error;
      logger?.warn?.({ err: error }, 'sandbox fc call failed');
      throw fail(502, 'SANDBOX_FAILED', '沙箱服务暂时不可用');
    } finally {
      clearTimeout(timer);
    }
  }

  async function run({ manifest, source, input, limits, chat }) {
    requireEnabled();
    const chatFn = typeof chat === 'function' ? chat : llmChat;
    if (runner === 'fc') return { ...await runFc({ manifest, source, input, limits }), mode: runner };
    return { ...await runLocal({ source, input, limits, chatFn }), mode: runner };
  }

  return { status, run };
}

module.exports = { createSandbox };
