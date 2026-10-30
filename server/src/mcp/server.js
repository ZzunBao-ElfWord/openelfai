'use strict';

const { resolveApiKey } = require('./auth');
const { createCharacterTools } = require('./tools');

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'openelf-character', version: '0.1.0' };

// JSON-RPC 2.0 错误码；未授权额外使用 -32001（HTTP 401）。
function rpcError(code, message) {
  return { jsonrpc: '2.0', id: null, error: { code, message } };
}

function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function textContent(value) {
  return [{ type: 'text', text: JSON.stringify(value) }];
}

// 工具返回统一包成 content + structuredContent；业务失败只标 isError，HTTP 仍是 200。
function toolResult(payload, isError = false) {
  const result = { content: textContent(payload), structuredContent: payload };
  if (isError) result.isError = true;
  return result;
}

function registerMcpRoutes(app, { db } = {}) {
  const tools = createCharacterTools({ db });

  app.get('/mcp', async (request, reply) => {
    reply.header('allow', 'POST');
    return reply.code(405).send({ error: { code: 'METHOD_NOT_ALLOWED', message: 'MCP 端点仅支持 POST' } });
  });

  app.post('/mcp', { bodyLimit: 1024 * 1024 }, async (request, reply) => {
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const id = body.id === undefined ? null : body.id;

    // 先验 Key：MCP 连接器只代表用户本人操作，匿名请求一律 401。
    let auth;
    try {
      auth = await resolveApiKey(db, request.headers.authorization);
    } catch (error) {
      return reply.code(401).send({
        jsonrpc: '2.0',
        id,
        error: { code: -32001, message: error.message || '未授权：缺少或无效的 API Key' },
      });
    }

    if (body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
      return reply.code(200).send({ jsonrpc: '2.0', id, error: { code: -32600, message: '无效的 JSON-RPC 请求' } });
    }

    const method = body.method;
    const params = body.params && typeof body.params === 'object' ? body.params : {};

    if (method === 'notifications/initialized') {
      return reply.code(202).send();
    }

    if (method === 'initialize') {
      return jsonRpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { ...SERVER_INFO },
      });
    }

    if (method === 'ping') {
      return jsonRpcResult(id, {});
    }

    if (method === 'tools/list') {
      return jsonRpcResult(id, { tools: tools.list() });
    }

    if (method === 'tools/call') {
      const name = params.name;
      if (typeof name !== 'string' || !name) {
        return reply.code(200).send({ jsonrpc: '2.0', id, error: { code: -32602, message: '缺少工具名 name' } });
      }
      const tool = tools.get(name);
      if (!tool) {
        return reply.code(200).send({
          jsonrpc: '2.0', id, error: { code: -32601, message: `未知工具：${name}` },
        });
      }
      const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
      try {
        const payload = await tool.handler(args, { userId: auth.userId, keyId: auth.keyId });
        return jsonRpcResult(id, toolResult(payload));
      } catch (error) {
        if (error && error.mcpCode === -32602) {
          return reply.code(200).send({
            jsonrpc: '2.0', id, error: { code: -32602, message: error.message },
          });
        }
        request.log?.warn?.({ err: error, tool: name }, 'mcp tool failed');
        return jsonRpcResult(id, toolResult({
          error: { code: error?.code || 'TOOL_FAILED', message: error?.message || '工具执行失败' },
        }, true));
      }
    }

    return reply.code(200).send({
      jsonrpc: '2.0', id, error: { code: -32601, message: `未知方法：${method}` },
    });
  });
}

module.exports = { registerMcpRoutes, PROTOCOL_VERSION, SERVER_INFO };
