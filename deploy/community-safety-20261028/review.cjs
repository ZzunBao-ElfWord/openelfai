'use strict';
// Server-only operator tool. No token in arguments or console output.
async function main() {
  const [command, env = 'Production', id, action, reason] = process.argv.slice(2);
  const token = process.env.COMMUNITY_REVIEW_TOKEN;
  if (!token || token.length < 32) throw new Error('使用 node --env-file=/etc/openelf-api.env 加载审核权限');
  if (!['Production', 'Sandbox'].includes(env)) throw new Error('环境必须是 Production 或 Sandbox');
  let route, payload;
  if (command === 'content' || command === 'reports') route = '/internal/community/queue?environment=' + env + '&kind=' + (command === 'reports' ? 'reports' : 'content');
  else if (command === 'review-content' || command === 'review-report') {
    if (!id || !action || !reason) throw new Error('审核需提供记录ID、动作和明确理由');
    route = '/internal/community/review';
    payload = { environment: env, kind: command === 'review-report' ? 'report' : 'content', id, action, reason };
  } else throw new Error('命令：content / reports / review-content / review-report，随后填写环境');
  const response = await fetch('http://127.0.0.1:8787' + route, { method: payload ? 'POST' : 'GET',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    ...(payload ? { body: JSON.stringify(payload) } : {}), signal: AbortSignal.timeout(30000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || '审核接口请求失败');
  console.log(JSON.stringify(data, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
