const http = require('node:http');
const { AuthError, JsonFileStore, createAuthService } = require('./auth_service');
const { parseProducts, createAppleIapService, createAppleVerifier } = require('./apple_iap_service');

function bearerToken(req) {
  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(req.headers.authorization ?? '');
  return match?.[1] ?? null;
}

function clientIp(req) {
  const socketIp = req.socket.remoteAddress ?? '';
  if (socketIp === '127.0.0.1' || socketIp === '::1' || socketIp === '::ffff:127.0.0.1') {
    return req.headers['x-real-ip'] || socketIp;
  }
  return socketIp;
}

async function readJson(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) {
    throw new AuthError(415, '请求格式应为 JSON');
  }
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1024) throw new AuthError(413, '请求内容过大');
  }
  try {
    const body = JSON.parse(raw);
    if (body && typeof body === 'object' && !Array.isArray(body)) return body;
  } catch (_) {
    // Invalid JSON is handled below.
  }
  throw new AuthError(400, '无效的 JSON 请求');
}

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

function createServer(auth, appleIap = null) {
  return http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && pathname === '/health') {
        return json(res, 200, { status: 'ok' });
      }
      if (req.method === 'POST' && pathname === '/api/v1/auth/send-code') {
        const body = await readJson(req);
        return json(res, 200, await auth.sendCode(body.phone, clientIp(req)));
      }
      if (req.method === 'POST' && pathname === '/api/v1/auth/login-by-code') {
        const body = await readJson(req);
        return json(res, 200, auth.loginWithCode(body.phone, body.code));
      }
      if (req.method === 'GET' && pathname === '/api/v1/auth/me') {
        return json(res, 200, auth.currentUser(bearerToken(req)));
      }
      if (req.method === 'POST' && pathname === '/api/v1/auth/logout') {
        return json(res, 200, auth.logout(bearerToken(req)));
      }
      if (appleIap && pathname.startsWith('/api/v1/ios/')) {
        const user = auth.currentUser(bearerToken(req)).user;
        if (req.method === 'GET' && pathname === '/api/v1/ios/products') {
          return json(res, 200, { products: appleIap.listProducts() });
        }
        if (req.method === 'GET' && pathname === '/api/v1/ios/wallet') {
          return json(res, 200, { wallet: appleIap.wallet(user.phone) });
        }
        if (req.method === 'POST' && pathname === '/api/v1/ios/verify') {
          const body = await readJson(req);
          return json(res, 200, await appleIap.verify(user.phone, body.productId, body.transactionId));
        }
      }
      return json(res, 404, { message: '接口不存在' });
    } catch (error) {
      if (error instanceof AuthError) {
        return json(res, error.status, { message: error.message });
      }
      console.error('Auth request failed:', error?.message ?? error);
      return json(res, 503, { message: '服务暂时不可用' });
    }
  });
}

function aliyunSender(env) {
  const required = [
    'ALIBABA_CLOUD_ACCESS_KEY_ID',
    'ALIBABA_CLOUD_ACCESS_KEY_SECRET',
    'ALIYUN_SMS_SIGN_NAME',
    'ALIYUN_SMS_TEMPLATE_CODE',
  ];
  for (const name of required) {
    if (!env[name]) throw new Error(`Missing environment variable: ${name}`);
  }
  const Dysmsapi = require('@alicloud/dysmsapi20170525');
  const OpenApi = require('@alicloud/openapi-client');
  const client = new Dysmsapi.default(new OpenApi.Config({
    accessKeyId: env.ALIBABA_CLOUD_ACCESS_KEY_ID,
    accessKeySecret: env.ALIBABA_CLOUD_ACCESS_KEY_SECRET,
    endpoint: 'dysmsapi.aliyuncs.com',
  }));
  return async (phone, code) => {
    const request = new Dysmsapi.SendSmsRequest({
      phoneNumbers: phone,
      signName: env.ALIYUN_SMS_SIGN_NAME,
      templateCode: env.ALIYUN_SMS_TEMPLATE_CODE,
      templateParam: JSON.stringify({ code }),
    });
    const response = await client.sendSms(request);
    if (response.body?.code !== 'OK') {
      throw new Error(`Aliyun SMS returned ${response.body?.code ?? 'unknown error'}`);
    }
  };
}

if (require.main === module) {
  main().catch((error) => {
    console.error('OpenElf authentication could not start:', error?.message ?? error);
    process.exitCode = 1;
  });
}

async function main() {
  const env = process.env;
  const store = new JsonFileStore(env.AUTH_DATA_FILE || '/var/lib/openelf-auth/state.json');
  const auth = createAuthService({
    store,
    sendSms: aliyunSender(env),
    secret: env.AUTH_HMAC_SECRET,
  });
  const port = Number(env.AUTH_PORT || 8787);
  const host = env.AUTH_HOST || '127.0.0.1';
  const products = parseProducts(env.APPLE_IAP_PRODUCTS_JSON);
  // Do not sell diamonds while marketplace spending still trusts local device state.
  const enabled = env.APPLE_IAP_ENABLED === 'true'
    && env.APPLE_WALLET_AUTHORITY_READY === 'true'
    && Object.keys(products).length > 0;
  const verifyTransaction = enabled ? await createAppleVerifier(env) : null;
  const appleIap = createAppleIapService({ store, products, verifyTransaction, enabled });
  createServer(auth, appleIap).listen(port, host, () => {
    console.log(`OpenElf authentication listening on ${host}:${port}`);
  });
}

module.exports = { createServer, aliyunSender };
