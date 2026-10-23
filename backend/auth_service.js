const { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PHONE = /^1\d{10}$/;
const CODE = /^\d{6}$/;
const CODE_TTL = 5 * 60 * 1000;
const RESEND_INTERVAL = 60 * 1000;
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;

class AuthError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

class JsonFileStore {
  constructor(filename) {
    this.filename = filename;
    fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    this.data = fs.existsSync(filename)
      ? JSON.parse(fs.readFileSync(filename, 'utf8'))
      : { phones: {}, users: {}, sessions: {}, wallets: {}, appleTransactions: {} };
    this.data.phones ??= {};
    this.data.users ??= {};
    this.data.sessions ??= {};
    this.data.wallets ??= {};
    this.data.appleTransactions ??= {};
  }

  save() {
    const tmp = `${this.filename}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
    fs.renameSync(tmp, this.filename);
    fs.chmodSync(this.filename, 0o600);
  }
}

function createAuthService({ store, sendSms, secret, now = Date.now, generateCode = () => String(randomInt(0, 1000000)).padStart(6, '0') }) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('AUTH_HMAC_SECRET must contain at least 32 characters');
  }
  const inFlight = new Set();
  const ipSends = new Map();
  const codeHash = (phone, code) => createHmac('sha256', secret).update(`${phone}:${code}`).digest('hex');
  const tokenHash = (token) => createHash('sha256').update(token).digest('hex');

  async function sendCode(phone, ip) {
    if (!PHONE.test(phone)) throw new AuthError(400, '请输入有效的 11 位手机号');
    const time = now();
    const today = new Date(time).toISOString().slice(0, 10);
    const record = store.data.phones[phone] ?? {};
    if (record.lastSentAt && time - record.lastSentAt < RESEND_INTERVAL) {
      throw new AuthError(429, '发送过于频繁，请稍后再试');
    }
    if (record.dailyDate === today && record.dailyCount >= 10) {
      throw new AuthError(429, '今日发送次数已达上限');
    }
    const ipKey = ip || 'unknown';
    const recent = (ipSends.get(ipKey) ?? []).filter((sentAt) => time - sentAt < 60 * 60 * 1000);
    if (recent.length >= 30 || inFlight.has(phone)) {
      throw new AuthError(429, '请求过于频繁，请稍后再试');
    }
    inFlight.add(phone);
    try {
      const code = generateCode();
      if (!CODE.test(code)) throw new Error('Invalid verification code generator');
      await sendSms(phone, code);
      store.data.phones[phone] = {
        codeHash: codeHash(phone, code),
        expiresAt: time + CODE_TTL,
        lastSentAt: time,
        dailyDate: today,
        dailyCount: (record.dailyDate === today ? record.dailyCount ?? 0 : 0) + 1,
        failures: 0,
      };
      store.save();
      recent.push(time);
      ipSends.set(ipKey, recent);
      return { message: '验证码已发送' };
    } finally {
      inFlight.delete(phone);
    }
  }

  function loginWithCode(phone, code) {
    if (!PHONE.test(phone) || !CODE.test(code)) {
      throw new AuthError(400, '手机号或验证码格式不正确');
    }
    const record = store.data.phones[phone];
    if (!record?.codeHash || record.expiresAt < now() || record.failures >= 5) {
      throw new AuthError(401, '验证码无效或已过期');
    }
    const actual = Buffer.from(codeHash(phone, code), 'hex');
    const expected = Buffer.from(record.codeHash, 'hex');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      record.failures += 1;
      if (record.failures >= 5) delete record.codeHash;
      store.save();
      throw new AuthError(401, '验证码无效或已过期');
    }
    delete record.codeHash;
    delete record.expiresAt;
    const user = store.data.users[phone] ?? {
      id: `u_${createHash('sha256').update(phone).digest('hex').slice(0, 16)}`,
      phone,
      nickname: `用户${phone.slice(-4)}`,
      avatarInitial: '用',
      createdAt: new Date(now()).toISOString(),
    };
    store.data.users[phone] = user;
    const token = randomBytes(32).toString('base64url');
    store.data.sessions[tokenHash(token)] = { phone, expiresAt: now() + SESSION_TTL };
    store.save();
    return { token, user };
  }

  function currentUser(token) {
    if (!token) throw new AuthError(401, '请先登录');
    const session = store.data.sessions[tokenHash(token)];
    if (!session || session.expiresAt < now()) {
      throw new AuthError(401, '登录已过期');
    }
    const user = store.data.users[session.phone];
    if (!user) throw new AuthError(401, '用户不存在');
    return { user };
  }

  function logout(token) {
    if (token) {
      delete store.data.sessions[tokenHash(token)];
      store.save();
    }
    return { message: '已退出登录' };
  }

  return { sendCode, loginWithCode, currentUser, logout };
}

module.exports = { AuthError, JsonFileStore, createAuthService };
