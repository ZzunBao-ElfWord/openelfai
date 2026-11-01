'use strict';

/// LLM 可观测：统一封装 Langfuse。未配置密钥或 SDK 不可用时降级为无操作实现，
/// 保证遥测永远不影响业务链路（SDK 内部对网络失败也只做日志，不向调用方抛错）。
/// 所有平台 LLM 调用经 upstream.js 汇入这里，业务侧只需通过 trace 参数传上下文。

function createNoopTelemetry() {
  return {
    enabled: false,
    startGeneration() {
      return { end() {} };
    },
    async flush() {},
    async shutdown() {},
  };
}

function createTelemetry({ enabled, publicKey, secretKey, baseUrl, environment, release, logger } = {}) {
  if (!enabled || !publicKey || !secretKey) return createNoopTelemetry();
  let Langfuse;
  try {
    ({ Langfuse } = require('langfuse'));
  } catch (err) {
    logger?.warn?.({ err }, 'langfuse 包不可用，LLM 遥测已禁用');
    return createNoopTelemetry();
  }

  const client = new Langfuse({
    publicKey,
    secretKey,
    baseUrl,
    environment: environment || undefined,
    release: release || undefined,
    // 批量上报，避免每次调用都阻塞在遥测网络上。
    flushAt: 15,
    flushInterval: 10000,
    requestTimeout: 5000,
  });

  /// 返回的 handle 只需调用一次 end()；重复调用安全（幂等）。
  function startGeneration({ name, model, input, modelParameters, metadata, userId, sessionId, tags } = {}) {
    try {
      const trace = client.trace({
        name: name || 'llm-call',
        userId: userId || undefined,
        sessionId: sessionId || undefined,
        tags: tags || undefined,
        metadata: metadata || undefined,
        input,
      });
      const generation = trace.generation({
        name: name || 'llm-call',
        model,
        modelParameters: modelParameters || undefined,
        input,
        metadata: metadata || undefined,
        startTime: new Date(),
      });
      let ended = false;
      return {
        /// usage 兼容 OpenAI 蛇形字段：{ prompt_tokens, completion_tokens, total_tokens }。
        end({ output, usage, level, statusMessage, completionStartTime } = {}) {
          if (ended) return;
          ended = true;
          try {
            generation.end({
              output,
              level: level || (statusMessage ? 'ERROR' : 'DEFAULT'),
              statusMessage: statusMessage || undefined,
              completionStartTime: completionStartTime || undefined,
              usage: usage
                ? {
                    promptTokens: usage.prompt_tokens ?? usage.promptTokens ?? undefined,
                    completionTokens: usage.completion_tokens ?? usage.completionTokens ?? undefined,
                    totalTokens: usage.total_tokens ?? usage.totalTokens ?? undefined,
                  }
                : undefined,
            });
            trace.update({ output });
          } catch (err) {
            logger?.debug?.({ err }, 'langfuse end 事件失败');
          }
        },
      };
    } catch (err) {
      logger?.warn?.({ err }, 'langfuse startGeneration 失败');
      return { end() {} };
    }
  }

  async function flush() {
    try {
      await client.flushAsync();
    } catch { /* 上报失败不影响进程 */ }
  }

  async function shutdown() {
    try {
      await client.shutdownAsync();
    } catch { /* 同上 */ }
  }

  return { enabled: true, startGeneration, flush, shutdown };
}

module.exports = { createTelemetry, createNoopTelemetry };
