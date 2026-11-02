'use strict';

function plan(args) {
  const [command = 'list', id, ...rest] = args;
  const flags = new Map();
  // list accepts flags without an ID; all other commands take an ID first.
  const options = command === 'list' ? args.slice(1) : rest;
  for (let i = 0; i < options.length; i++) {
    const flag = options[i];
    if (!['--confirm', '--payee-verified', '--reason', '--event', '--fingerprint', '--status'].includes(flag)) throw new Error('未知参数');
    if (['--confirm', '--payee-verified'].includes(flag)) flags.set(flag, true);
    else { if (!options[i + 1] || options[i + 1].startsWith('--')) throw new Error('缺少参数值'); flags.set(flag, options[++i]); }
  }
  if (command === 'list') {
    const status = flags.get('--status') || 'pending_review';
    if (!['pending_review', 'paying', 'pending_reconciliation', 'paid', 'failed', 'rejected'].includes(status)) throw new Error('提现状态无效');
    return { method: 'GET', path: '/internal/withdrawals?environment=production&status=' + status };
  }
  if (['risk', 'resolve-refund', 'clear-legacy'].includes(command)) {
    if (!/^u_[a-f0-9]{32}$/.test(id || '')) throw new Error('用户编号无效');
    const path = '/internal/earnings-risk/' + id;
    if (command === 'risk') return { method: 'GET', path };
    if (flags.get('--confirm') !== true) throw new Error('核对操作需要 --confirm；不得未经核对直接解除风险');
    const reason = flags.get('--reason') || '';
    if (reason.length < 10 || reason.length > 500) throw new Error('请提供10至500字核对依据');
    const body = { confirmed: true, reason, action: command === 'resolve-refund' ? 'resolve_refund' : 'clear_legacy' };
    if (command === 'resolve-refund') {
      body.expectedEventId = flags.get('--event');
      if (!body.expectedEventId) throw new Error('缺少已核对的退款事件 --event');
    } else {
      body.fingerprint = flags.get('--fingerprint');
      if (!/^[a-f0-9]{64}$/.test(body.fingerprint || '')) throw new Error('缺少已核对历史记录的 --fingerprint');
    }
    return { method: 'POST', path: path + '/review', body };
  }
  if (!['approve', 'reject', 'reconcile'].includes(command) || !/^wd_[a-f0-9]{32}$/.test(id || '')) throw new Error('命令或提现编号无效');
  if (flags.get('--confirm') !== true) throw new Error('操作需要 --confirm；approve 会发起真实付款');
  if (command === 'reconcile') return { method: 'POST', path: '/internal/withdrawals/' + id + '/reconcile', body: { environment: 'production' } };
  if (command === 'approve' && flags.get('--payee-verified') !== true) throw new Error('批准出款前必须人工核对收款人为实名本人');
  const reason = flags.get('--reason') || '';
  if (reason.length < 10 || reason.length > 500) throw new Error('请提供10至500字审核依据');
  return { method: 'POST', path: '/internal/withdrawals/' + id + '/review',
    body: { environment: 'production', action: command, payeeVerified: flags.get('--payee-verified') === true, reason } };
}

async function main(args) {
  if (args.includes('--help')) {
    console.log('默认只读：list [--status 状态] / risk 用户ID。\n人工操作：reconcile 提现ID --confirm；approve/reject 提现ID --confirm --reason 核对依据（approve 还需 --payee-verified，会真实付款）。\n风险核对：resolve-refund 用户ID --event 事件ID --reason 核对依据 --confirm；clear-legacy 用户ID --fingerprint 指纹 --reason 核对依据 --confirm。\n仅连接本机127.0.0.1:8787，令牌来自 WITHDRAW_REVIEW_TOKEN 环境变量，不打印。');
    return;
  }
  const request = plan(args);
  const token = process.env.WITHDRAW_REVIEW_TOKEN;
  if (!token) throw new Error('未配置 WITHDRAW_REVIEW_TOKEN；未发起请求');
  const response = await fetch('http://127.0.0.1:8787' + request.path, {
    method: request.method, redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: { 'x-review-token': token, 'content-type': 'application/json' },
    body: request.body ? JSON.stringify(request.body) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || '请求失败；请查单，勿重复出款');
  console.log(JSON.stringify(result, (key, value) => key === 'account' ? '（收款账号已隐藏）' : value, 2));
}
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { plan };
