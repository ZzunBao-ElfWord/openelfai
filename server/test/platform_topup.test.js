'use strict';
// 全部使用内存 fake db / fake gateway，不连接 MySQL、不访问支付宝。
const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.ALIPAY_ENABLED = 'true';
for (const name of ['DB_PASSWORD', 'JWT_SECRET', 'SMS_CODE_PEPPER', 'REFRESH_TOKEN_PEPPER']) {
  process.env[name] = 'isolated-test-secret-not-for-deployment';
}

const { createTopupService } = require('../src/platform/topup');
const buildApp = require('../src/app');
const { memoryStore } = require('./helpers/payment_memory');

const USER = { id: 'u_topup_test' };
const SETTINGS = {
  enabled: true,
  sandbox: false,
  appId: '2026000000000001',
  sellerId: '2088000000000001',
};
const NOTIFY_URL = 'https://api.openelfai.com/api/v1/platform/alipay/notify';
const RETURN_URL = 'https://openelfai.com/console/?view=topup';
const REQUEST_ID = 'request_id_1234567890';

function makeDb() {
  const state = { orders: [], wallets: new Map(), ledger: [], calls: [] };

  function execute(sql, params = []) {
    const query = String(sql).replace(/\s+/g, ' ').trim();
    state.calls.push({ sql: query, params });

    if (query.includes('FROM platform_topup_orders')) {
      if (query.includes('WHERE user_id = ? AND request_id = ?')) {
        return [state.orders.filter((row) => row.user_id === params[0] && row.request_id === params[1]), []];
      }
      if (query.includes("WHERE user_id = ? AND status = 'pending' AND expires_at > ?")) {
        return [state.orders.filter((row) => row.user_id === params[0] && row.status === 'pending' &&
          Number(row.expires_at) > Number(params[1])), []];
      }
      if (query.includes('WHERE id = ?')) {
        return [state.orders.filter((row) => row.id === params[0]), []];
      }
      throw new Error('Unexpected topup order SQL: ' + query);
    }

    if (query.startsWith('INSERT INTO platform_topup_orders')) {
      const [id, user_id, tier_id, amount_fen, status, app_id, seller_id, trade_no, request_id,
        created_at, paid_at, expires_at] = params;
      state.orders.push({
        id, user_id, tier_id, amount_fen, status, app_id, seller_id, trade_no, request_id,
        created_at, paid_at, expires_at,
      });
      return [{ affectedRows: 1 }, []];
    }

    if (query.startsWith("UPDATE platform_topup_orders SET status = 'paid'")) {
      const [trade_no, paid_at, id] = params;
      const row = state.orders.find((item) => item.id === id);
      if (row && row.status !== 'paid') {
        row.status = 'paid';
        row.trade_no = trade_no;
        row.paid_at = paid_at;
      }
      return [{ affectedRows: row ? 1 : 0 }, []];
    }

    if (query.startsWith("UPDATE platform_topup_orders SET status = 'closed'")) {
      const row = state.orders.find((item) => item.id === params[0]);
      if (row && row.status === 'pending') row.status = 'closed';
      return [{ affectedRows: row ? 1 : 0 }, []];
    }

    if (query.startsWith('INSERT INTO platform_wallets')) {
      const [user_id, , , , balanceDelta, topupDelta, updatedAt] = params;
      const wallet = state.wallets.get(user_id) || { balance_micro: 0, frozen_micro: 0, total_topup_micro: 0 };
      wallet.balance_micro += balanceDelta;
      wallet.total_topup_micro += topupDelta;
      wallet.updated_at = updatedAt;
      state.wallets.set(user_id, wallet);
      return [{ affectedRows: 1 }, []];
    }

    if (query.includes('FROM platform_wallets WHERE user_id = ?')) {
      const wallet = state.wallets.get(params[0]);
      return [[wallet || { balance_micro: 0, frozen_micro: 0, total_topup_micro: 0 }], []];
    }

    if (query.startsWith('INSERT INTO platform_ledger')) {
      const [user_id, request_id, delta_micro, balance_after, note, created_at] = params;
      state.ledger.push({
        id: state.ledger.length + 1,
        user_id,
        request_id,
        type: 'topup',
        delta_micro,
        balance_after,
        note,
        created_at,
      });
      return [{ insertId: state.ledger.length }, []];
    }

    throw new Error('Unexpected SQL in topup test: ' + query);
  }

  const connection = {
    execute,
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
  };

  return {
    state,
    calls: state.calls,
    execute,
    async getConnection() { return connection; },
  };
}

function makeGateway(settings) {
  let status = 'WAIT_BUYER_PAY';
  let queryError = null;
  let notFound = false;
  const signCalls = [];
  const pageCalls = [];

  const gateway = {
    signOrder(order, options = {}) {
      signCalls.push({ order, options });
      return `signed:${order.id}`;
    },
    pagePay(order, options = {}) {
      pageCalls.push({ order, options });
      return `https://openapi.alipay.com/gateway.do?out_trade_no=${order.id}`;
    },
    verifyNotify(body) {
      return Boolean(body) && body.sign === 'trusted';
    },
    async query(id) {
      if (queryError) throw queryError;
      if (notFound) return { notFound: true };
      return {
        app_id: settings.appId,
        seller_id: settings.sellerId,
        out_trade_no: id,
        total_amount: '10.00',
        trade_no: '20260000000000000001',
        trade_status: status,
      };
    },
  };

  return {
    gateway,
    signCalls,
    pageCalls,
    set(values) {
      if (values.status !== undefined) status = values.status;
      if (values.queryError !== undefined) queryError = values.queryError;
      if (values.notFound !== undefined) notFound = values.notFound;
    },
  };
}

function fixture(overrides = {}) {
  const db = makeDb();
  const settings = { ...SETTINGS, ...overrides };
  let clock = 1_700_000_000_000;
  const fake = makeGateway(settings);
  const service = createTopupService({
    db,
    settings,
    gateway: fake.gateway,
    notifyUrl: NOTIFY_URL,
    returnUrl: RETURN_URL,
    now: () => clock,
  });
  return {
    db,
    service,
    fake,
    settings,
    advance(ms) { clock += ms; },
  };
}

function notifyBody(orderId, overrides = {}) {
  return {
    app_id: SETTINGS.appId,
    seller_id: SETTINGS.sellerId,
    out_trade_no: orderId,
    total_amount: '10.00',
    trade_no: '20260000000000000001',
    trade_status: 'TRADE_SUCCESS',
    sign: 'trusted',
    ...overrides,
  };
}

function createOrder(f, requestId = REQUEST_ID, tierId = 'topup10') {
  return f.service.create(USER, { requestId, tierId });
}

test('products 返回 6 个档位，并按支付开关给出 enabled 与 mode', async () => {
  const f = fixture();
  const result = f.service.products();

  assert.equal(result.enabled, true);
  assert.equal(result.mode, 'production');
  assert.deepEqual(result.custom, { min_fen: 100, max_fen: 500000 });
  assert.deepEqual(result.products, [
    { id: 'topup10', yuan: 10, price_fen: 1000 },
    { id: 'topup20', yuan: 20, price_fen: 2000 },
    { id: 'topup50', yuan: 50, price_fen: 5000 },
    { id: 'topup100', yuan: 100, price_fen: 10000 },
    { id: 'topup300', yuan: 300, price_fen: 30000 },
    { id: 'topup500', yuan: 500, price_fen: 50000 },
  ]);

  const closed = fixture({ enabled: false });
  const closedResult = closed.service.products();
  assert.equal(closedResult.enabled, false);
  assert.equal(closedResult.products.length, 6);
  await assert.rejects(() => createOrder(closed), { code: 'ALIPAY_DISABLED' });
});

test('同一 requestId 幂等返回同一订单，换档位返回 409', async () => {
  const f = fixture();
  const first = await createOrder(f);
  const second = await createOrder(f);

  assert.match(first.id, /^OT[a-f0-9]{32}$/);
  assert.equal(first.id, second.id);
  assert.equal(first.amount_fen, 1000);
  assert.equal(first.status, 'pending');
  assert.equal(first.orderString, `signed:${first.id}`);
  assert.equal(f.db.state.orders.length, 1);
  assert.equal(f.fake.signCalls[0].options.notifyUrl, NOTIFY_URL);
  assert.equal(f.fake.signCalls[0].order.priceFen, 1000);

  await assert.rejects(
    () => f.service.create(USER, { requestId: REQUEST_ID, tierId: 'topup20' }),
    { code: 'REQUEST_REUSED' },
  );
});

test('同一用户已有未过期 pending 订单时返回 409 并附订单号', async () => {
  const f = fixture();
  const first = await createOrder(f);

  await assert.rejects(
    () => f.service.create(USER, { requestId: 'another_request_123456', tierId: 'topup10' }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, 'TOPUP_PENDING_ORDER');
      assert.equal(error.orderId, first.id);
      return true;
    },
  );
});

test('回调验签失败返回 failure 且不入账', async () => {
  const f = fixture();
  const order = await createOrder(f);

  await assert.rejects(
    () => f.service.notify(notifyBody(order.id, { sign: 'forged' })),
    { code: 'INVALID_NOTIFY_SIGNATURE' },
  );
  assert.equal(f.db.state.wallets.size, 0);
  assert.equal(f.db.state.ledger.length, 0);
});

test('回调金额、APPID、PID 或订单号不匹配都不入账', async () => {
  for (const overrides of [
    { total_amount: '0.01' },
    { app_id: '2026000000000002' },
    { seller_id: '2088000000000002' },
  ]) {
    const f = fixture();
    const order = await createOrder(f);
    await assert.rejects(
      () => f.service.notify(notifyBody(order.id, overrides)),
      { code: 'ALIPAY_ORDER_MISMATCH' },
    );
    assert.equal(f.db.state.wallets.size, 0);
    assert.equal(f.db.state.ledger.length, 0);
  }

  const f = fixture();
  const order = await createOrder(f);
  await assert.rejects(
    () => f.service.notify(notifyBody(order.id, { out_trade_no: 'OTaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' })),
    { code: 'UNKNOWN_ORDER' },
  );
});

test('回调成功只入账一次：余额、累计充值、账本与订单状态', async () => {
  const f = fixture();
  const order = await createOrder(f);

  await f.service.notify(notifyBody(order.id));

  const wallet = f.db.state.wallets.get(USER.id);
  assert.equal(wallet.balance_micro, 10_000_000);
  assert.equal(wallet.total_topup_micro, 10_000_000);

  assert.equal(f.db.state.ledger.length, 1);
  assert.deepEqual(
    {
      type: f.db.state.ledger[0].type,
      delta_micro: f.db.state.ledger[0].delta_micro,
      balance_after: f.db.state.ledger[0].balance_after,
      request_id: f.db.state.ledger[0].request_id,
    },
    { type: 'topup', delta_micro: 10_000_000, balance_after: 10_000_000, request_id: order.id },
  );

  const saved = f.db.state.orders[0];
  assert.equal(saved.status, 'paid');
  assert.equal(saved.trade_no, '20260000000000000001');
  assert.equal(typeof saved.paid_at, 'number');
});

test('重复回调直接成功且不二次入账', async () => {
  const f = fixture();
  const order = await createOrder(f);

  await f.service.notify(notifyBody(order.id));
  await f.service.notify(notifyBody(order.id));

  const wallet = f.db.state.wallets.get(USER.id);
  assert.equal(wallet.balance_micro, 10_000_000);
  assert.equal(wallet.total_topup_micro, 10_000_000);
  assert.equal(f.db.state.ledger.length, 1);
});

test('TRADE_CLOSED 将 pending 订单置为 closed 且不入账', async () => {
  const f = fixture();
  const order = await createOrder(f);

  await f.service.notify(notifyBody(order.id, { trade_status: 'TRADE_CLOSED' }));

  assert.equal(f.db.state.orders[0].status, 'closed');
  assert.equal(f.db.state.wallets.size, 0);
  assert.equal(f.db.state.ledger.length, 0);
});

test('查单：已支付入账、WAIT_BUYER_PAY 保持 pending、查询异常返回 503', async () => {
  const paid = fixture();
  const paidOrder = await createOrder(paid);
  paid.fake.set({ status: 'TRADE_SUCCESS' });
  const paidResult = await paid.service.refresh(USER.id, paidOrder.id);

  assert.equal(paidResult.id, paidOrder.id);
  assert.equal(paidResult.status, 'paid');
  assert.equal(paidResult.amount_fen, 1000);
  assert.equal(typeof paidResult.paid_at, 'number');
  assert.equal(paidResult.balance_micro, 10_000_000);
  assert.equal(paid.db.state.ledger.length, 1);

  const waiting = fixture();
  const waitingOrder = await createOrder(waiting);
  const waitingResult = await waiting.service.refresh(USER.id, waitingOrder.id);
  assert.equal(waitingResult.status, 'pending');
  assert.equal(waitingResult.paid_at, null);
  assert.equal(waitingResult.balance_micro, 0);
  assert.equal(waiting.db.state.ledger.length, 0);

  const failing = fixture();
  const failingOrder = await createOrder(failing);
  failing.fake.set({ queryError: new Error('gateway down') });
  await assert.rejects(
    () => failing.service.refresh(USER.id, failingOrder.id),
    { statusCode: 503, code: 'ALIPAY_QUERY_UNAVAILABLE' },
  );
});

test('重新支付只对 pending 且未过期订单签单', async () => {
  const f = fixture();
  const order = await createOrder(f);

  const resumed = await f.service.resume(USER, order.id);
  assert.equal(resumed.orderString, `signed:${order.id}`);
  assert.equal(f.fake.signCalls.at(-1).options.notifyUrl, NOTIFY_URL);

  f.advance(16 * 60_000);
  await assert.rejects(() => f.service.resume(USER, order.id), { code: 'TOPUP_ORDER_NOT_PAYABLE' });
});

test('网页渠道返回收银台链接，并带上回跳订单号', async () => {
  const f = fixture();
  const order = await f.service.create(USER, { requestId: REQUEST_ID, tierId: 'topup100', channel: 'web' });

  assert.equal(order.tier_id, 'topup100');
  assert.equal(order.orderString, undefined);
  assert.equal(order.payUrl, `https://openapi.alipay.com/gateway.do?out_trade_no=${order.id}`);

  assert.equal(f.fake.pageCalls.length, 1);
  const call = f.fake.pageCalls[0];
  assert.equal(call.order.priceFen, 10000);
  assert.equal(call.options.notifyUrl, NOTIFY_URL);

  const returnUrl = new URL(call.options.returnUrl);
  assert.equal(returnUrl.origin + returnUrl.pathname, 'https://openelfai.com/console/');
  assert.equal(returnUrl.searchParams.get('view'), 'topup');
  assert.equal(returnUrl.searchParams.get('order'), order.id);
});

test('网页渠道重新支付返回 payUrl，已支付订单不再签单', async () => {
  const f = fixture();
  const order = await f.service.create(USER, { requestId: REQUEST_ID, tierId: 'topup20', channel: 'web' });

  const resumed = await f.service.resume(USER, order.id, { channel: 'web' });
  assert.equal(resumed.payUrl, `https://openapi.alipay.com/gateway.do?out_trade_no=${order.id}`);
  assert.equal(resumed.orderString, undefined);

  f.advance(16 * 60_000);
  await assert.rejects(
    () => f.service.resume(USER, order.id, { channel: 'web' }),
    { code: 'TOPUP_ORDER_NOT_PAYABLE' },
  );

  const paid = fixture();
  const paidOrder = await paid.service.create(USER, { requestId: REQUEST_ID, tierId: 'topup10', channel: 'web' });
  await paid.service.notify(notifyBody(paidOrder.id));
  const again = await paid.service.create(USER, { requestId: REQUEST_ID, tierId: 'topup10', channel: 'web' });
  assert.equal(again.status, 'paid');
  assert.equal(again.payUrl, null);
});

test('自定义金额按整数元下单并校验边界', async () => {
  const f = fixture();
  const order = await f.service.create(USER, {
    requestId: REQUEST_ID, tierId: 'custom', amountYuan: 88, channel: 'web',
  });
  assert.equal(order.tier_id, 'custom');
  assert.equal(order.amount_fen, 8800);

  for (const amountYuan of [0, 5001, 10.5, '', null]) {
    const bad = fixture();
    await assert.rejects(
      () => bad.service.create(USER, { requestId: REQUEST_ID, tierId: 'custom', amountYuan }),
      { code: 'INVALID_AMOUNT' },
    );
  }

  const reused = fixture();
  await reused.service.create(USER, { requestId: REQUEST_ID, tierId: 'custom', amountYuan: 10 });
  await assert.rejects(
    () => reused.service.create(USER, { requestId: REQUEST_ID, tierId: 'custom', amountYuan: 20 }),
    { code: 'REQUEST_REUSED' },
  );
});

test('回调路由验签失败返回纯文本 failure', async () => {
  const app = await buildApp({
    db: { async execute() { throw new Error('notify 验签失败不应访问数据库'); } },
    paymentStore: memoryStore(),
    sms: {},
    captcha: {},
    logger: false,
    alipayGateway: { verifyNotify: () => false },
  });

  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/platform/alipay/notify',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'out_trade_no=OTaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&total_amount=10.00&sign=forged&sign_type=RSA2',
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.body, 'failure');
  } finally {
    await app.close();
  }
});
