'use strict';

const fs = require('node:fs');
const { createPaymentStore, fail } = require('./payment_store');
const { createOrderService } = require('./apple_orders');

function parseProducts(raw) {
  let value;
  try { value = JSON.parse(raw || '{}'); } catch (_) { throw new Error('APPLE_IAP_PRODUCTS_JSON 必须是 JSON 对象'); }
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('APPLE_IAP_PRODUCTS_JSON 必须是 JSON 对象');
  for (const [id, amount] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(id) || !/^[A-Za-z0-9._-]{1,100}$/.test(id) || !Number.isSafeInteger(amount) || amount <= 0 || amount > 1000000) throw new Error('商品 ID 或钻石数量无效');
  }
  return Object.freeze({ ...value });
}

function validateTransaction(transaction, expected) {
  if (!transaction || String(transaction.transactionId) !== expected.transactionId ||
      transaction.productId !== expected.productId || transaction.bundleId !== expected.bundleId ||
      transaction.type !== 'Consumable' || Number(transaction.quantity) !== 1 ||
      !expected.allowRevoked && transaction.revocationDate != null ||
      !['Production', 'Sandbox'].includes(transaction.environment)) {
    throw fail(400, 'INVALID_APPLE_TRANSACTION', 'Apple 交易信息与商品不匹配');
  }
  if (typeof transaction.appAccountToken !== 'string' || transaction.appAccountToken.toLowerCase() !== expected.appAccountToken) {
    throw fail(409, 'APPLE_ACCOUNT_MISMATCH', '该交易不属于当前 OpenElf 账号');
  }
  return transaction;
}

function userToken(userId) {
  const hex = /^u_([0-9a-f]{32})$/i.exec(userId)?.[1]?.toLowerCase();
  if (!hex) throw fail(400, 'INVALID_USER', '用户编号无效');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

function createAppleIapService({ db, settings, verifyTransaction, paymentStore, verifyNotification }) {
  const products = parseProducts(settings.productsJson);
  if (settings.enabled && (!settings.bundleId || !Object.keys(products).length || settings.sandboxOnly && !settings.allowSandbox)) throw new Error('内购商品、Bundle ID 或环境配置不完整');
  const store = paymentStore || createPaymentStore(db);
  const orders = createOrderService({ store, settings, products, validate: validateTransaction,
    accountToken: userToken, verifyTransaction,
    verifyNotification: verifyNotification || verifyTransaction?.verifyNotification });
  return { ...orders, mode: settings.sandboxOnly ? 'sandbox' : 'production', accountToken: userToken,
    listProducts: () => settings.enabled ? Object.entries(products).map(([id, diamonds]) => ({ id, diamonds })) : [],
    wallet: (userId, environment = settings.sandboxOnly ? 'Sandbox' : 'Production') =>
      store.transaction(environment, (tx) => tx.lockWallet(userId)),
  };
}

async function createAppleVerifier(settings) {
  const paths = (settings.rootCertPaths || '').split(',').map((path) => path.trim()).filter(Boolean);
  if (!settings.privateKeyPath || !settings.keyId || !settings.issuerId || !settings.bundleId ||
      !Number.isSafeInteger(Number(settings.appId)) || Number(settings.appId) <= 0 || !paths.length) throw new Error('Apple 密钥、App ID 或根证书未配置');
  const { AppStoreServerAPIClient, Environment, SignedDataVerifier } = await import('@apple/app-store-server-library');
  const key = fs.readFileSync(settings.privateKeyPath, 'utf8');
  const certificates = paths.map((path) => fs.readFileSync(path));
  const environments = settings.sandboxOnly ? [Environment.SANDBOX] :
    [Environment.PRODUCTION, ...(settings.allowSandbox ? [Environment.SANDBOX] : [])];
  const clients = environments.map((environment) => ({ environment,
    client: new AppStoreServerAPIClient(key, settings.keyId, settings.issuerId, settings.bundleId, environment),
    verifier: new SignedDataVerifier(certificates, true, environment, settings.bundleId,
      environment === Environment.PRODUCTION ? Number(settings.appId) : undefined),
  }));
  const verify = async (transactionId) => {
    let lastError;
    for (const { client, verifier } of clients) {
      let response;
      try { response = await client.getTransactionInfo(transactionId); }
      catch (error) {
        lastError = error;
        // Only an explicit not-found may fall back to the App Review sandbox.
        if (error.httpStatusCode !== 404) throw error;
        continue;
      }
      return verifier.verifyAndDecodeTransaction(response.signedTransactionInfo);
    }
    throw lastError;
  };
  verify.verifyNotification = async (signedPayload) => {
    let lastError;
    for (const { environment, verifier } of clients) {
      try {
        const payload = await verifier.verifyAndDecodeNotification(signedPayload);
        if (payload.data?.bundleId !== settings.bundleId || payload.data?.environment !== environment) throw new Error('Notification metadata mismatch');
        const transaction = payload.data?.signedTransactionInfo
          ? await verifier.verifyAndDecodeTransaction(payload.data.signedTransactionInfo) : null;
        if (transaction && (transaction.environment !== environment || transaction.bundleId !== settings.bundleId)) throw new Error('Transaction metadata mismatch');
        return { payload, transaction, environment };
      } catch (error) { lastError = error; }
    }
    throw lastError;
  };
  return verify;
}

module.exports = { createAppleIapService, createAppleVerifier, parseProducts, validateTransaction, userToken };
