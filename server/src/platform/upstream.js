'use strict';

function createUpstream({ baseUrl, masterKey, timeoutMs = 60000 }) {
  async function chatCompletions({ model, messages, stream = false, temperature, max_tokens, ...rest }) {
    const body = { model, messages, stream, ...(temperature != null && { temperature }), ...(max_tokens != null && { max_tokens }), ...rest };
    if (stream) body.stream_options = { include_usage: true };

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
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function chatCompletionsStream({ model, messages, ...rest }, onChunk, onReady) {
    const body = { model, messages, stream: true, stream_options: { include_usage: true }, ...rest };
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
          onChunk?.(obj);
        } catch { /* ignore */ }
      }
    }
    return { usage };
  }

  return { chatCompletions, chatCompletionsStream };
}

module.exports = { createUpstream };
