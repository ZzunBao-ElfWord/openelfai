'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { deleteAccount, registerAccountDeletion, PERSONAL_KINDS } = require('../src/account_deletion');

function fixture({ balance = 0, meta = [], orders = [], pending = [], active = true, breakAt = '' } = {}) {
  const calls = [];
  const tx = {
    async beginTransaction() { calls.push(['begin']); },
    async commit() { calls.push(['commit']); },
    async rollback() { calls.push(['rollback']); },
    release() { calls.push(['release']); },
    async execute(sql, params) {
      calls.push([sql, params]);
      if (breakAt && sql.includes(breakAt)) throw new Error('db unavailable');
      if (sql.startsWith('SELECT * FROM users')) return [[{ id: 'old', phone: '13800000000', status: active ? 'active' : 'deleted' }]];
      if (sql.includes('SELECT balance_micro')) return [[{ balance_micro: balance, frozen_micro: 0 }]];
      if (sql.startsWith('SELECT * FROM payment_wallet_meta')) return [meta];
      if (sql.startsWith('SELECT id FROM platform_topup_orders')) return [orders];
      if (sql.startsWith('SELECT kind')) return [pending];
      return [{ affectedRows: 1 }];
    },
  };
  return { db: { async getConnection() { return tx; } }, calls };
}

test('注销事务清个人资料、所有会话和API密钥；保留交易、钱包及账本', async () => {
  const f = fixture();
  assert.deepEqual(await deleteAccount(f.db, 'old'), { deleted: true });
  const sql = f.calls.map(([s]) => s).join('\n');
  assert.match(sql, /UPDATE refresh_sessions.*WHERE user_id/);
  assert.match(sql, /UPDATE platform_api_keys.*key_cipher = NULL/);
  assert.match(sql, /DELETE FROM sms_codes/);
  assert.match(sql, /DELETE FROM payment_objects/);
  assert.ok(PERSONAL_KINDS.includes('identity') && PERSONAL_KINDS.includes('chat'));
  assert.ok(!PERSONAL_KINDS.includes('withdrawal') && !PERSONAL_KINDS.includes('alipay_order'));
  assert.doesNotMatch(sql, /DELETE FROM (users|platform_topup_orders|payment_ledger|user_wallets)/);
  const change = f.calls.find(([s]) => s.startsWith('UPDATE users'));
  assert.match(change[1][0], /^deleted_[a-f0-9]{12}$/);
  assert.equal(change[1][1], 'old');
  assert.ok(f.calls.some(([s]) => s === 'commit'));
});

test('未结算余额、收益、债务或不确定订单均拒绝注销且回滚', async () => {
  for (const options of [{ balance: 1 }, { meta: [{ available_cents: 1 }] },
    { meta: [{ refund_debt: 1 }] }, { orders: [{ id: 'pending' }] }, { pending: [{ kind: 'withdrawal' }] }]) {
    const f = fixture(options);
    await assert.rejects(deleteAccount(f.db, 'old'), { code: 'ACCOUNT_UNSETTLED' });
    assert.ok(f.calls.some(([s]) => s === 'rollback'));
    assert.ok(!f.calls.some(([s]) => s.startsWith('UPDATE users') || s === 'commit'));
  }
});

test('数据库失败不报告注销成功；已失效账号不可修改', async () => {
  for (const options of [{ breakAt: 'DELETE FROM sms_codes' }, { active: false }]) {
    const f = fixture(options);
    await assert.rejects(deleteAccount(f.db, 'old'));
    assert.ok(f.calls.some(([s]) => s === 'rollback'));
    assert.ok(!f.calls.some(([s]) => s === 'commit'));
  }
});

test('路由必须认证并明确确认，不能指定其他用户', async () => {
  let handler;
  const f = fixture();
  const app = { post(path, options, fn) { assert.equal(path, '/api/v1/auth/delete-account'); handler = fn; } };
  registerAccountDeletion(app, { db: f.db, authenticate: async () => { throw Object.assign(new Error(), { code: 'UNAUTHORIZED' }); } });
  await assert.rejects(handler({ body: {} }, {}), { code: 'UNAUTHORIZED' });
  registerAccountDeletion(app, { db: f.db, authenticate: async () => ({ user: { id: 'old' } }) });
  await assert.rejects(handler({ body: {} }, {}), { code: 'DELETE_CONFIRMATION_REQUIRED' });
  await handler({ body: { confirmation: 'DELETE_MY_ACCOUNT', userId: 'victim' } }, { header() {} });
  assert.equal(f.calls.find(([s]) => s.startsWith('SELECT * FROM users'))[1][0], 'old');
});
