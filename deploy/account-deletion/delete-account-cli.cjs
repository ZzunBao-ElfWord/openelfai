'use strict';
const readline = require('node:readline/promises');
const config = require('/opt/openelf-api/src/config');
const { createPool } = require('/opt/openelf-api/src/db');
const { cleanupDeletedAccount, deleteAccount } = require('/opt/openelf-api/src/account_deletion');

function maskPhone(phone) {
  return phone.length >= 7 ? phone.slice(0, 3) + '****' + phone.slice(-4) : '***';
}

(async () => {
  if (process.getuid() !== 0) throw new Error('请使用 root 执行');
  const io = readline.createInterface({ input: process.stdin, output: process.stdout });
  const db = await createPool(config);
  try {
    const selector = (await io.question('请输入要注销的完整手机号；若V1已注销但实名残留，请输入准确用户ID：')).trim();
    if (!/^1[3-9]\d{9}$/.test(selector) && !/^u_[a-f0-9]{32}$/.test(selector)) {
      throw new Error('手机号或用户ID格式不正确，未执行');
    }
    const [rows] = await db.execute(
      `SELECT u.id, u.status,
        EXISTS(SELECT 1 FROM identity_verifications i WHERE i.user_id=u.id) AS identity_exists,
        COALESCE(w.diamonds,0) AS diamonds,
        COALESCE(p.balance_micro,0) AS platform_balance_micro,
        COALESCE(p.frozen_micro,0) AS platform_frozen_micro
       FROM users u
       LEFT JOIN user_wallets w ON w.user_id=u.id
       LEFT JOIN platform_wallets p ON p.user_id=u.id
       WHERE ${selector.startsWith('u_') ? 'u.id' : 'u.phone'}=? LIMIT 1`, [selector]);
    const account = rows[0];
    if (!account) throw new Error('没有找到该手机号对应的有效账号，未执行');
    console.log(JSON.stringify({
      userId: account.id, phone: selector.startsWith('u_') ? 'V1已注销账号' : maskPhone(selector), status: account.status,
      identityExists: Boolean(account.identity_exists), diamonds: Number(account.diamonds || 0),
      platformBalanceMicro: Number(account.platform_balance_micro || 0),
      platformFrozenMicro: Number(account.platform_frozen_micro || 0),
    }, null, 2));
    const action = account.status === 'deleted' ? 'CLEANUP_DELETED' : 'DELETE_ACCOUNT';
    const confirmation = (await io.question(`请输入 ${action}:${account.id} 确认永久操作：`)).trim();
    if (confirmation !== `${action}:${account.id}`) throw new Error('确认内容不匹配，未执行');
    if (account.status === 'deleted') await cleanupDeletedAccount(db, account.id);
    else await deleteAccount(db, account.id);
    const [[after]] = await db.execute(
      `SELECT u.status,
        EXISTS(SELECT 1 FROM identity_verifications i WHERE i.user_id=u.id) AS identity_exists,
        EXISTS(SELECT 1 FROM refresh_sessions s WHERE s.user_id=u.id AND s.revoked_at IS NULL) AS active_session,
        EXISTS(SELECT 1 FROM platform_api_keys k WHERE k.user_id=u.id AND k.revoked_at IS NULL) AS active_key
       FROM users u WHERE u.id=?`, [account.id]);
    if (!after || after.status !== 'deleted' || Number(after.identity_exists)
        || Number(after.active_session) || Number(after.active_key)) {
      throw new Error('注销后的强制校验未通过，请立即检查备份和数据库');
    }
    console.log('账号已注销：实名资料已清除，所有会话和 API Key 已撤销。交易账务记录按对账要求保留。');
  } finally {
    io.close();
    await db.end();
  }
})().catch((error) => {
  console.error('未完成注销：' + (error.code === 'ACCOUNT_UNSETTLED' ? error.message : String(error.message || error)));
  process.exitCode = 1;
});
