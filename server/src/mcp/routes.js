'use strict';

/// 外部 MCP 的 App 端管理接口（登录态）。对外只暴露注册信息与工具清单，
/// Token 永不回传；所有接口都按 user_id 隔离。
function registerMcpServerRoutes(app, { authenticate, mcpServers } = {}) {
  if (typeof authenticate !== 'function' || !mcpServers) {
    throw new Error('外部 MCP 路由缺少 authenticate / mcpServers');
  }

  app.get('/api/v1/mcp/servers', async (request) => {
    const { user } = await authenticate(request);
    const servers = await mcpServers.listServers(user.id);
    return { servers, max: mcpServers.MAX_SERVERS_PER_USER };
  });

  app.post('/api/v1/mcp/servers', { bodyLimit: 8 * 1024 }, async (request) => {
    const { user } = await authenticate(request);
    const server = await mcpServers.addServer(user.id, request.body || {});
    return { server };
  });

  app.delete('/api/v1/mcp/servers/:id', async (request) => {
    const { user } = await authenticate(request);
    return mcpServers.removeServer(user.id, request.params?.id);
  });

  // 探测工具清单：注册后先让用户看清这个 Server 到底能干什么。
  app.get('/api/v1/mcp/servers/:id/tools', async (request) => {
    const { user } = await authenticate(request);
    const tools = await mcpServers.listToolsFor(user.id, request.params?.id, { force: true });
    return {
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    };
  });
}

module.exports = { registerMcpServerRoutes };
