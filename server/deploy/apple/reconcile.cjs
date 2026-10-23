'use strict';
// Operator-only reconciliation. Load credentials using node --env-file, not CLI arguments.
const config = require('../../src/config');
const { createPool } = require('../../src/db');
const { createAppleIapService, createAppleVerifier } = require('../../src/apple_iap');
async function main() {
  const [userId, transactionId] = process.argv.slice(2);
  if (!/^u_[a-f0-9]{32}$/.test(userId || '') || !/^\d{5,30}$/.test(transactionId || '')) {
    throw new Error('用法：node --env-file=/etc/openelf-api.env deploy/apple/reconcile.cjs 用户ID Apple交易ID');
  }
  if (!config.appleIap.enabled) throw new Error('内购未开启，未进行对账');
  const db = await createPool(config);
  try {
    const verifyTransaction = await createAppleVerifier(config.appleIap);
    const service = createAppleIapService({ db, settings: config.appleIap, verifyTransaction });
    const result = await service.reconcile(userId, transactionId);
    console.log(JSON.stringify({ mode: result.mode, status: result.orderStatus,
      alreadyProcessed: result.alreadyProcessed, diamonds: result.wallet.diamonds, refundDebt: result.wallet.refundDebt }));
  } finally { await db.end(); }
}
main().catch(() => { console.error('对账未完成，请核对用户、交易编号、Apple 网络与配置；未输出密钥。'); process.exitCode = 1; });
