'use strict';
// 全部使用内存 fake db，不连接 MySQL。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  ensureDefaultKey,
  getDefaultKeyPlain,
  revealDefaultKey,
  rotateDefaultKey,
} = require('../src/platform/user_keys');
const { encrypt, decrypt, keyHint } = require('../src/platform/secret');
const { hashKey, verifyKey } = require('../src/platform/api_key');

function makeDb(initialRows = []) {
  const state = {
    rows: initialRows.map((row) => ({ ...row })),
    calls: [],
  };

  async function execute(sql, params = []) {
    const normalized = String(sql).replace(/\s+/g, ' ').trim();
    state.calls.push({ sql: normalized, params });

    if (normalized.startsWith('SELECT') && normalized.includes('platform_api_keys')) {
      const [userId] = params;
      const found = state.rows
        .filter((row) => row.user_id === userId && Number(row.is_default) === 1)
        .sort((a, b) => Number(b.created_at) - Number(a.created_at));
      return [found.length ? [{ ...found[0] }] : [], []];
    }

    if (normalized.startsWith('INSERT INTO platform_api_keys')) {
      const [id, user_id, name, key_prefix, key_hash, key_cipher, is_default, qps_limit, created_at] = params;
      state.rows.push({
        id, user_id, name, key_prefix, key_hash, key_cipher,
        is_default, qps_limit, created_at, revoked_at: null,
      });
      return [{ affectedRows: 1 }, []];
    }

    if (normalized.startsWith('UPDATE platform_api_keys')) {
      const [revokedAt, userId] = params;
      let affectedRows = 0;
      for (const row of state.rows) {
        if (row.user_id === userId && Number(row.is_default) === 1 && !row.revoked_at) {
          row.revoked_at = revokedAt;
          affectedRows += 1;
        }
      }
      return [{ affectedRows }, []];
    }

    throw new Error('Unexpected SQL in user_keys test: ' + normalized);
  }

  const connection = {
    execute,
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
  };

  return {
    calls: state.calls,
    get rows() { return state.rows; },
    execute,
    getConnection: async () => connection,
  };
}

function makeKeyRow({ userId = 'u_1', id = 'key_old', plain = 'oe-sk-existing-abcdefghijklmnop', revokedAt = null } = {}) {
  return {
    id,
    user_id: userId,
    name: '默认密钥',
    key_prefix: plain.slice(0, 12),
    key_hash: hashKey(plain),
    key_cipher: encrypt(plain),
    is_default: 1,
    qps_limit: 5,
    created_at: 1000,
    revoked_at: revokedAt,
  };
}

test('ensureDefaultKey 在不存在时新建默认密钥', async () => {
  const db = makeDb();
  const result = await ensureDefaultKey(db, 'u_1');

  assert.equal(result.created, true);
  assert.ok(result.plain.startsWith('oe-sk-'));
  assert.equal(result.row.user_id, 'u_1');
  assert.equal(result.row.name, '默认密钥');
  assert.equal(Number(result.row.is_default), 1);
  assert.equal(Number(result.row.qps_limit), 5);
  assert.ok(result.row.key_cipher);
  assert.equal(decrypt(result.row.key_cipher), result.plain);
  assert.ok(verifyKey(result.plain, result.row.key_hash));
  assert.equal(db.calls.filter((call) => call.sql.startsWith('INSERT')).length, 1);
});

test('ensureDefaultKey 已存在时复用且不重复插入', async () => {
  const existing = makeKeyRow();
  const db = makeDb([existing]);
  const result = await ensureDefaultKey(db, 'u_1');

  assert.equal(result.created, false);
  assert.equal(result.row.id, 'key_old');
  assert.equal(result.plain, undefined);
  assert.equal(db.calls.filter((call) => call.sql.startsWith('INSERT')).length, 0);
});

test('ensureDefaultKey 对已吊销密钥不自动重建', async () => {
  const revoked = makeKeyRow({ revokedAt: 2000 });
  const db = makeDb([revoked]);
  const result = await ensureDefaultKey(db, 'u_1');

  assert.equal(result.created, false);
  assert.equal(result.row.revoked_at, 2000);
  assert.equal(db.calls.filter((call) => call.sql.startsWith('INSERT')).length, 0);
});

test('getDefaultKeyPlain 在吊销或无密文时返回 null', async () => {
  const revokedDb = makeDb([makeKeyRow({ revokedAt: 2000 })]);
  assert.equal(await getDefaultKeyPlain(revokedDb, 'u_1'), null);

  const noCipher = { ...makeKeyRow(), key_cipher: null };
  const noCipherDb = makeDb([noCipher]);
  assert.equal(await getDefaultKeyPlain(noCipherDb, 'u_1'), null);

  const emptyDb = makeDb();
  assert.equal(await getDefaultKeyPlain(emptyDb, 'u_1'), null);
});

test('getDefaultKeyPlain 正常返回解密明文', async () => {
  const plain = 'oe-sk-existing-abcdefghijklmnop';
  const db = makeDb([makeKeyRow({ plain })]);
  assert.equal(await getDefaultKeyPlain(db, 'u_1'), plain);
});

test('revealDefaultKey 新建时直接返回新明文，吊销时抛 409', async () => {
  const freshDb = makeDb();
  const revealed = await revealDefaultKey(freshDb, 'u_1');
  assert.ok(revealed.startsWith('oe-sk-'));
  assert.equal(decrypt(freshDb.rows[0].key_cipher), revealed);

  const revokedDb = makeDb([makeKeyRow({ revokedAt: 2000 })]);
  await assert.rejects(revealDefaultKey(revokedDb, 'u_1'), (error) => {
    assert.equal(error.statusCode, 409);
    assert.equal(error.code, 'key_revoked');
    return true;
  });
});

test('rotateDefaultKey 先吊销旧行再插入新行', async () => {
  const oldRow = makeKeyRow({ plain: 'oe-sk-oldoldold-abcdefghijkl' });
  const otherRow = { ...makeKeyRow({ id: 'key_other', plain: 'oe-sk-otherother-abcdefghij' }), is_default: 0 };
  const db = makeDb([oldRow, otherRow]);

  const result = await rotateDefaultKey(db, 'u_1');

  assert.ok(result.plain.startsWith('oe-sk-'));
  assert.equal(result.prefix, result.plain.slice(0, 12));
  assert.ok(result.createdAt);

  const oldAfter = db.rows.find((row) => row.id === 'key_old');
  assert.equal(oldAfter.revoked_at, result.createdAt);
  assert.equal(db.rows.find((row) => row.id === 'key_other').revoked_at, null);

  const fresh = db.rows.filter((row) => row.user_id === 'u_1' && Number(row.is_default) === 1 && !row.revoked_at);
  assert.equal(fresh.length, 1);
  assert.equal(decrypt(fresh[0].key_cipher), result.plain);
  assert.ok(verifyKey(result.plain, fresh[0].key_hash));

  const updateIndex = db.calls.findIndex((call) => call.sql.startsWith('UPDATE'));
  const insertIndex = db.calls.findIndex((call) => call.sql.startsWith('INSERT'));
  assert.ok(updateIndex >= 0 && insertIndex > updateIndex);
});

test('secret.encrypt/decrypt 往返一致且每次密文不同', () => {
  const plain = 'oe-sk-roundtrip-0123456789';
  const first = encrypt(plain);
  const second = encrypt(plain);

  assert.notEqual(first, second);
  assert.equal(decrypt(first), plain);
  assert.equal(decrypt(second), plain);
  assert.ok(Buffer.from(first, 'base64').length > 12 + 16);
});

test('secret.decrypt 拒绝被篡改或格式错误的密文', () => {
  const stored = encrypt('oe-sk-tamper-check');
  const raw = Buffer.from(stored, 'base64');
  raw[raw.length - 1] ^= 0xff;

  assert.throws(() => decrypt(raw.toString('base64')));
  assert.throws(() => decrypt('not-a-valid-cipher'));
  assert.throws(() => decrypt(''));
});

test('secret.keyHint 掩码规则', () => {
  assert.equal(keyHint('oe-sk-abcdef123456'), 'oe-sk-abcdef…3456');
  assert.equal(keyHint('123456789012'), '1234****9012');
  assert.equal(keyHint('short'), '****');
  assert.equal(keyHint(null), '****');
});
