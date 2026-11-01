'use strict';

/// MCP 客户端（入向）：把用户自己的外部 MCP Server 接进精灵对话。
/// 只支持 HTTP JSON-RPC（streamable http），兼容 SSE 响应；不引官方 SDK，
/// 避免为一个 MVP 能力引入依赖树。所有外部请求都在这里做 SSRF 与体积防护。
const PROTOCOL_VERSION = '2024-11-05';
const CLIENT_INFO = { name: 'openelf-mcp-client', version: '1.0.0' };
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 256 * 1024;
// initialize 结果缓存：外部 Server 多半有会话状态，但 MVP 不维护长连接，
// 10 分钟内复用同一次握手即可，避免每轮对话都多打一次请求。
const SESSION_TTL_MS = 10 * 60 * 1000;

/// IPv4 私网 / 保留网段：外部地址只允许公网，避免被用来扫描内网。
function ipv4Octets(host) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every((n) => n >= 0 && n <= 255) ? parts : null;
}

function isBlockedHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1' || host === '0.0.0.0') return true;

  const parts = ipv4Octets(host);
  if (parts) {
    const [a, b] = parts;
    if (a === 0 || a === 127 || a === 10) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // 运营商级 NAT
    return false;
  }
  // IPv6 私网/本地段（含 ULA 与 link-local）
  if (/^f[cd]/i.test(host) || /^fe[89ab]/i.test(host)) return true;
  return false;
}

function assertSafeUrl(raw, { allowPrivateHosts = false } = {}) {
  let url;
  try {
    url = new URL(String(raw || '').trim());
  } catch (_) {
    throw new Error('外部 MCP 地址格式无效');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('外部 MCP 地址只支持 http/https');
  }
  if (!allowPrivateHosts && isBlockedHost(url.hostname)) {
    throw new Error('外部 MCP 地址不允许指向内网或本机');
  }
  return url;
}

/// 解析 SSE 响应体：只取 data: 行里的 JSON 帧，忽略注释与心跳。
function parseSseFrames(text) {
  const frames = [];
  for (const line of String(text || '').split('\n')) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      frames.push(JSON.parse(data));
    } catch { /* 非 JSON 帧直接跳过 */ }
  }
  return frames;
}

function createMcpClient({ timeoutMs = DEFAULT_TIMEOUT_MS, allowPrivateHosts = false, fetchImpl = fetch, logger } = {}) {
  const sessions = new Map();

  async function post(connection, payload) {
    const { id, url: rawUrl, headers: extraHeaders = {} } = connection || {};
    const url = assertSafeUrl(rawUrl, { allowPrivateHosts });
    const session = sessions.get(id);

    const headers = {
      'content-type': 'application/json',
      // MCP streamable http 要求客户端同时声明两种 Accept。
      accept: 'application/json, text/event-stream',
      ...extraHeaders,
    };
    if (session?.sessionId) headers['mcp-session-id'] = session.sessionId;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url.toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: ctrl.signal,
        // 手动处理重定向：307/308 可能把请求带到内网地址。
        redirect: 'manual',
      });
      if (res.status >= 300 && res.status < 400) throw new Error('外部 MCP 不允许重定向');

      const sessionId = res.headers?.get?.('mcp-session-id');
      if (sessionId) sessions.set(id, { sessionId, at: Date.now() });

      if (!res.ok) throw new Error(`外部 MCP 返回 ${res.status}`);

      const contentType = String(res.headers?.get?.('content-type') || '');
      const text = await res.text();
      if (text.length > MAX_BODY_BYTES) throw new Error('外部 MCP 响应体过大');
      // notifications/initialized 等通知类请求常返回 202 空响应。
      if (!text.trim()) return {};

      const frames = contentType.includes('text/event-stream') ? parseSseFrames(text) : [JSON.parse(text)];
      const matched = frames.find((frame) => frame && frame.id === payload.id) || frames[frames.length - 1];
      if (!matched) throw new Error('外部 MCP 响应为空');
      if (matched.error) throw new Error(matched.error.message || '外部 MCP 返回错误');
      return matched.result ?? {};
    } finally {
      clearTimeout(timer);
    }
  }

  /// 握手：先 initialize，再空响应通知（通知失败不影响后续调用）。
  async function ensureSession(connection) {
    const cached = sessions.get(connection?.id);
    if (cached?.initializedAt && Date.now() - cached.initializedAt < SESSION_TTL_MS) return cached;
    const result = await post(connection, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
    });
    try {
      await post(connection, { jsonrpc: '2.0', method: 'notifications/initialized' });
    } catch (err) {
      logger?.debug?.({ err }, '外部 MCP notifications/initialized 失败');
    }
    const next = { ...(sessions.get(connection?.id) || {}), initializedAt: Date.now() };
    sessions.set(connection.id, next);
    return next;
  }

  async function listTools(connection) {
    await ensureSession(connection);
    const result = await post(connection, {
      jsonrpc: '2.0', id: 2, method: 'tools/list', params: {},
    });
    const tools = result?.tools;
    if (!Array.isArray(tools)) return [];
    return tools
      .filter((tool) => tool && typeof tool.name === 'string' && tool.name)
      .map((tool) => ({
        name: tool.name,
        description: typeof tool.description === 'string' ? tool.description : '',
        inputSchema: tool.inputSchema && typeof tool.inputSchema === 'object'
          ? tool.inputSchema : { type: 'object', properties: {} },
      }));
  }

  async function callTool(connection, name, args = {}) {
    await ensureSession(connection);
    const result = await post(connection, {
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name, arguments: args || {} },
    });
    // 兼容两种返回：content 数组或 structuredContent。
    const parts = Array.isArray(result?.content) ? result.content : [];
    const text = parts
      .filter((item) => item && item.type === 'text' && typeof item.text === 'string')
      .map((item) => item.text)
      .join('\n');
    return {
      isError: !!result?.isError,
      text: text || JSON.stringify(result?.structuredContent ?? result ?? {}),
      structured: result?.structuredContent ?? null,
    };
  }

  function reset() {
    sessions.clear();
  }

  return { listTools, callTool, post, reset };
}

module.exports = {
  createMcpClient,
  assertSafeUrl,
  isBlockedHost,
  parseSseFrames,
  PROTOCOL_VERSION,
  DEFAULT_TIMEOUT_MS,
};
