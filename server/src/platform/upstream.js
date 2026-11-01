'use strict';

/// trace 为可选的遥测上下文：{ name, userId, sessionId, tags, metadata }，
/// 会被解构拦截、不会转发给上游。telemetry 缺省时为零开销。
function createUpstream({ baseUrl, masterKey, timeoutMs = 60000, telemetry }) {
  function startGen(trace, model, messages, extra) {
    return telemetry?.startGeneration({
      name: trace?.name || 'chat-completions',
      model,
      input: messages,
      modelParameters: extra,
      userId: trace?.userId,
      sessionId: trace?.sessionId,
      tags: trace?.tags,
      metadata: trace?.metadata,
    });
  }

  async function chatCompletions({ model, messages, stream = false, temperature, max_tokens, trace, ...rest }) {
    const body = { model, messages, stream, ...(temperature != null && { temperature }), ...(max_tokens != null && { max_tokens }), ...rest };
    if (stream) body.stream_options = { include_usage: true };

    const gen = startGen(trace, model, messages, { temperature, max_tokens, stream: !!stream });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${masterKey}`,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const err = new Error('upstream_error');
        err.statusCode = res.status;
        err.upstreamBody = await res.text();
        throw err;
      }
      const result = await res.json();
      gen?.end({
        output: result.choices?.[0]?.message ?? result.choices ?? null,
        usage: result.usage,
      });
      return result;
    } catch (err) {
      gen?.end({ statusMessage: err.upstreamBody ? `upstream ${err.statusCode}` : String(err.message || err) });
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async function chatCompletionsStream({ model, messages, trace, ...rest }, onChunk, onReady) {
    const body = { model, messages, stream: true, stream_options: { include_usage: true }, ...rest };
    const gen = startGen(trace, model, messages, { stream: true });
    try {
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'authorization': `Bearer ${masterKey}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = new Error('upstream_error');
        err.statusCode = res.status;
        err.upstreamBody = await res.text();
        throw err;
      }
      // 上游已确认可用后再让网关下发 SSE 响应头，避免错误状态下已发 200。
      onReady?.();
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let usage = null;
      let outputText = '';
      let completionStartTime = null;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') continue;
          try {
            const obj = JSON.parse(data);
            if (obj.usage) usage = obj.usage;
            // 记录首 token 时间（TTFT）并累计全文用于遥测回放。
            const delta = obj.choices?.[0]?.delta?.content;
            if (delta) {
              if (!completionStartTime) completionStartTime = new Date();
              outputText += delta;
            }
            onChunk?.(obj);
          } catch { /* ignore */ }
        }
      }
      gen?.end({ output: outputText, usage, completionStartTime });
      return { usage };
    } catch (err) {
      gen?.end({ statusMessage: err.upstreamBody ? `upstream ${err.statusCode}` : String(err.message || err) });
      throw err;
    }
  }

  return { chatCompletions, chatCompletionsStream };
}

module.exports = { createUpstream };
