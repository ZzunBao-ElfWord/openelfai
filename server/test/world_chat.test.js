'use strict';

const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
if (!/^openelf_[a-z0-9_]*test$/.test(process.env.DB_NAME || '')) {
  throw new Error('世界对话集成测试会清空测试数据，必须显式指定独立 DB_NAME=openelf_*test，禁止使用生产数据库');
}

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-0123456789abcdef';
process.env.SMS_CODE_PEPPER = 'test-sms-pepper-0123456789abcdef';
process.env.REFRESH_TOKEN_PEPPER = 'test-refresh-pepper-0123456789abcdef';
process.env.SMS_PROVIDER = 'mock';
process.env.AUTH_DEBUG_CODES = '1';

const buildApp = require('../src/app');
const { ensureDefaultKey } = require('../src/platform/user_keys');

const deviceId = 'test-device-worldchat';
let app;
let upstream;
let savedSelfUrl;
let savedVisitorLimit;

// —— 测试夹具：两名持有人（ownerA 有 Key + 余额，ownerB 无 Key）、若干访客 ——
const PHONES = {
  ownerA: '13800000001',
  ownerB: '13800000002',
  visitorA: '13800000003',
  visitorB: '13800000004',
  visitorC: '13800000005',
};
const ELF_A = 'wc_elf_a'; // ownerA 的 AI，走开关接口打开
const ELF_B = 'wc_elf_b'; // ownerA 的 AI，直接落库 worldChatOpen=true，测访客上限
const ELF_C = 'wc_elf_c'; // ownerB 的 AI，测无 Key 开启被拒
const users = {};

before(async () => {
  // 模型上游打桩：不打真实外网，固定返回一条回复与 usage。
  upstream = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { content: '这是世界对话的测试回复' } }],
        usage: { total_tokens: 100 },
      }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  savedSelfUrl = process.env.PLATFORM_SELF_URL;
  process.env.PLATFORM_SELF_URL = `http://127.0.0.1:${upstream.address().port}`;

  app = await buildApp({ logger: false });
  await app.ready();

  for (const [name, phone] of Object.entries(PHONES)) {
    const sent = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/send-code',
      payload: { phone },
    });
    assert.equal(sent.statusCode, 200, `${name} 发送验证码失败`);
    const signedIn = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login-by-code',
      payload: { phone, code: sent.json().debugCode, deviceId },
    });
    assert.equal(signedIn.statusCode, 200, `${name} 登录失败`);
    users[name] = signedIn.json();
  }

  const now = new Date().toISOString();
  const seedElf = async (id, ownerId, worldChatOpen) => {
    const payload = {
      id, serial: '#' + id.slice(-4), name: '世界对话测试', initial: '测',
      ownerId, ownerLabel: '测试持有人', generation: 1, edition: '初版',
      persona: '安静', fear: '黑暗', habit: '喝茶', status: 'owned',
      energy: 160, maxEnergy: 320, followers: 0, echo: 0, works: 0, attention: 0,
      baseCapacity: 3, learnedSkills: [], today: [], relations: [],
      worldChatOpen,
    };
    await app.db.query(
      `INSERT INTO payment_objects (environment, kind, object_id, owner_id, ref_id, state, payload, updated_at)
       VALUES ('Production', 'elf', ?, ?, NULL, '', ?, ?)`,
      [id, ownerId, JSON.stringify(payload), now],
    );
  };
  await seedElf(ELF_A, users.ownerA.user.id, false);
  await seedElf(ELF_B, users.ownerA.user.id, true);
  await seedElf(ELF_C, users.ownerB.user.id, false);

  // ownerA：配置 API Key + 平台余额 5 元；ownerB 保持无 Key。
  await ensureDefaultKey(app.db, users.ownerA.user.id);
  await app.db.query(
    `INSERT INTO platform_wallets (user_id, balance_micro, frozen_micro, total_topup_micro, updated_at)
     VALUES (?, 5000000, 0, 5000000, ?)
     ON DUPLICATE KEY UPDATE balance_micro = 5000000, updated_at = ?`,
    [users.ownerA.user.id, Date.now(), Date.now()],
  );
});

after(async () => {
  const ids = Object.values(users).map((session) => session.user.id);
  const marks = ids.map(() => '?').join(',');
  if (ids.length) {
    await app.db.query(`DELETE FROM payment_objects WHERE owner_id IN (${marks}) OR object_id IN ('${ELF_A}','${ELF_B}','${ELF_C}')`, ids);
    await app.db.query(`DELETE FROM platform_api_keys WHERE user_id IN (${marks})`, ids);
    await app.db.query(`DELETE FROM platform_wallets WHERE user_id IN (${marks})`, ids);
    await app.db.query(`DELETE FROM refresh_sessions WHERE user_id IN (${marks})`, ids);
    await app.db.query(`DELETE FROM users WHERE id IN (${marks})`, ids);
  }
  await app.close();
  await new Promise((resolve) => upstream.close(resolve));
  if (savedSelfUrl === undefined) delete process.env.PLATFORM_SELF_URL;
  else process.env.PLATFORM_SELF_URL = savedSelfUrl;
  if (savedVisitorLimit === undefined) delete process.env.WORLD_CHAT_VISITOR_DAILY_LIMIT;
  else process.env.WORLD_CHAT_VISITOR_DAILY_LIMIT = savedVisitorLimit;
});

function authHeaders(name) {
  return { authorization: `Bearer ${users[name].accessToken}` };
}

function chat(name, elfId, text = '你好呀') {
  return app.inject({
    method: 'POST',
    url: '/api/v1/elf-chat',
    headers: authHeaders(name),
    payload: { elfId, name: '世界对话测试', persona: '安静', text, history: [] },
  });
}

function setWorldChat(name, elfId, open) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/elf/world-chat',
    headers: authHeaders(name),
    payload: { elfId, open },
  });
}

test('默认关闭：访客调用返回固定话术 world_chat_closed', async () => {
  const response = await chat('visitorA', ELF_A);
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.mode, 'fixed');
  assert.equal(body.reason, 'world_chat_closed');
});

test('持有人开启后访客可聊（费用由持有人承担）', async () => {
  const opened = await setWorldChat('ownerA', ELF_A, true);
  assert.equal(opened.statusCode, 200);
  assert.equal(opened.json().elf.worldChatOpen, true);

  const response = await chat('visitorA', ELF_A);
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.mode, 'ai');
  assert.equal(body.reply, '这是世界对话的测试回复');
});

test('非持有人调用开关接口被拒', async () => {
  const response = await setWorldChat('visitorB', ELF_A, true);
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error.code, 'ELF_NOT_OWNED');
});

test('无 API Key 的持有人开启时被 WORLD_CHAT_PRECONDITION 拒绝', async () => {
  const response = await setWorldChat('ownerB', ELF_C, true);
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, 'WORLD_CHAT_PRECONDITION');
});

test('访客达每日上限后返回 world_chat_visitor_limit', async () => {
  savedVisitorLimit = process.env.WORLD_CHAT_VISITOR_DAILY_LIMIT;
  process.env.WORLD_CHAT_VISITOR_DAILY_LIMIT = '2';

  const first = await chat('visitorC', ELF_B);
  assert.equal(first.json().mode, 'ai');
  const second = await chat('visitorC', ELF_B);
  assert.equal(second.json().mode, 'ai');

  const third = await chat('visitorC', ELF_B);
  assert.equal(third.statusCode, 200);
  const body = third.json();
  assert.equal(body.mode, 'fixed');
  assert.equal(body.reason, 'world_chat_visitor_limit');
});
