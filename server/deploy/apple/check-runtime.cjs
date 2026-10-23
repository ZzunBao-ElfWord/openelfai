'use strict';
const config = require('../../src/config');
const { createPool } = require('../../src/db');
const { createAppleVerifier, parseProducts } = require('../../src/apple_iap');
async function main() {
  if (config.appleIap.bundleId !== 'com.ai.openelf' || String(config.appleIap.appId) !== '6761752635') throw new Error('应用标识不符');
  const expected = { gems7: 7, gems42: 42, gems210: 210, gems476: 476, gems896: 896, gems2086: 2086 };
  const products = parseProducts(config.appleIap.productsJson);
  if (Object.keys(products).length !== 6 || Object.entries(expected).some(([id, n]) => products['com.ai.openelf.' + id] !== n)) throw new Error('商品映射不符');
  await createAppleVerifier(config.appleIap);
  const db = await createPool(config);
  try {
    // Read-only checks after additive CREATE TABLE IF NOT EXISTS initialization.
    for (const table of ['payment_wallet_meta', 'payment_objects', 'payment_ledger', 'user_wallets', 'apple_iap_sandbox_wallets']) {
      await db.query(`SELECT 1 FROM ${table} LIMIT 0`);
    }
    console.log('Apple SDK、私钥、证书、6档商品、数据库新表加载通过（未核实真实交易）。');
    console.log(config.appleIap.sandboxOnly ? '当前仍为沙盒专用模式。' : '当前允许正式环境；沙盒账本仍独立。');
  } finally { await db.end(); }
}
main().catch(() => { console.error('运行环境检查失败，请核对数据库权限、配置、SDK和证书；未输出凭据。'); process.exitCode = 1; });
