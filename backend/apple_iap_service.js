const fs = require('node:fs');
const { AuthError } = require('./auth_service');

function parseProducts(raw) {
  if (!raw) return {};
  let values;
  try {
    values = JSON.parse(raw);
  } catch (_) {
    throw new Error('APPLE_IAP_PRODUCTS_JSON must be a JSON object');
  }
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw new Error('APPLE_IAP_PRODUCTS_JSON must be a JSON object');
  }
  for (const [id, diamonds] of Object.entries(values)) {
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(id) || !Number.isSafeInteger(diamonds) || diamonds <= 0) {
      throw new Error('Invalid Apple IAP product catalog entry');
    }
  }
  return values;
}

function createAppleIapService({ store, products, verifyTransaction, enabled = false }) {
  const catalog = Object.freeze({ ...products });
  const walletFor = (phone) => store.data.wallets[phone] ?? { diamonds: 0, totalRecharged: 0 };
  function wallet(phone) {
    return { ...walletFor(phone) };
  }
  function listProducts() {
    return enabled ? Object.entries(catalog).map(([id, diamonds]) => ({ id, diamonds })) : [];
  }
  async function verify(phone, productId, transactionId) {
    if (!enabled) throw new AuthError(503, '苹果内购尚未启用');
    if (!Object.hasOwn(catalog, productId) || !/^\d{5,30}$/.test(transactionId)) {
      throw new AuthError(400, '商品或交易编号无效');
    }
    const prior = store.data.appleTransactions[transactionId];
    if (prior) {
      if (prior.phone !== phone || prior.productId !== productId) {
        throw new AuthError(409, '该交易已绑定其他账号或商品');
      }
      return { alreadyProcessed: true, wallet: wallet(phone) };
    }
    const verified = await verifyTransaction(transactionId);
    if (String(verified.transactionId) !== transactionId || verified.productId !== productId || verified.revocationDate != null) {
      throw new AuthError(400, '苹果交易验证失败');
    }
    // Another request may have completed while the Apple API call was in flight.
    const concurrent = store.data.appleTransactions[transactionId];
    if (concurrent) {
      if (concurrent.phone !== phone || concurrent.productId !== productId) {
        throw new AuthError(409, '该交易已绑定其他账号或商品');
      }
      return { alreadyProcessed: true, wallet: wallet(phone) };
    }
    const current = walletFor(phone);
    const diamonds = catalog[productId];
    store.data.wallets[phone] = {
      diamonds: current.diamonds + diamonds,
      totalRecharged: current.totalRecharged + diamonds,
    };
    store.data.appleTransactions[transactionId] = { phone, productId, diamonds, grantedAt: new Date().toISOString() };
    store.save();
    return { alreadyProcessed: false, wallet: wallet(phone) };
  }
  return { listProducts, wallet, verify };
}

async function createAppleVerifier(env) {
  const required = ['APPLE_IAP_PRIVATE_KEY_PATH', 'APPLE_IAP_KEY_ID', 'APPLE_IAP_ISSUER_ID', 'APPLE_IAP_BUNDLE_ID', 'APPLE_IAP_APP_ID', 'APPLE_IAP_ROOT_CERT_PATHS'];
  for (const key of required) if (!env[key]) throw new Error(`Missing environment variable: ${key}`);
  const { AppStoreServerAPIClient, SignedDataVerifier, Environment } = await import('@apple/app-store-server-library');
  const privateKey = fs.readFileSync(env.APPLE_IAP_PRIVATE_KEY_PATH, 'utf8');
  const roots = env.APPLE_IAP_ROOT_CERT_PATHS.split(',').map((p) => fs.readFileSync(p.trim()));
  const appId = Number(env.APPLE_IAP_APP_ID);
  if (!Number.isSafeInteger(appId) || appId <= 0) throw new Error('Invalid APPLE_IAP_APP_ID');
  const environments = [Environment.PRODUCTION];
  if (env.APPLE_IAP_ALLOW_SANDBOX === 'true') environments.push(Environment.SANDBOX);
  const clients = environments.map((environment) => ({
    environment,
    client: new AppStoreServerAPIClient(privateKey, env.APPLE_IAP_KEY_ID, env.APPLE_IAP_ISSUER_ID, env.APPLE_IAP_BUNDLE_ID, environment),
    verifier: new SignedDataVerifier(roots, true, environment, env.APPLE_IAP_BUNDLE_ID, environment === Environment.PRODUCTION ? appId : undefined),
  }));
  return async (transactionId) => {
    for (const { client, verifier } of clients) {
      try {
        const response = await client.getTransactionInfo(transactionId);
        const transaction = await verifier.verifyAndDecodeTransaction(response.signedTransactionInfo);
        if (transaction.bundleId !== env.APPLE_IAP_BUNDLE_ID) throw new Error('Bundle ID mismatch');
        return transaction;
      } catch (error) {
        if (client === clients[clients.length - 1].client) throw error;
      }
    }
    throw new Error('Apple transaction could not be verified');
  };
}

module.exports = { parseProducts, createAppleIapService, createAppleVerifier };
