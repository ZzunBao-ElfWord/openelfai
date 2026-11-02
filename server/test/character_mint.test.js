'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { prepareAndMint } = require('../src/character/mint');
const { createLinkspriteClient } = require('../src/character/linksprite');
const { CREATE_ELF_COST } = require('../src/commerce');

const USER = { id: 'u_test_mint', nickname: '铸造测试' };
const IP_OWNER = '0x' + 'c'.repeat(40);
const HUMAN_ADDRESS = '0x' + 'd'.repeat(40);

// 授权登记依赖 IP 方地址；默认注入，单个用例可自行清空以验证 503。
let savedIpOwner;
let savedTreasury;
test.beforeEach(() => {
  savedIpOwner = process.env.PLATFORM_IP_OWNER_ADDRESS;
  savedTreasury = process.env.PLATFORM_TREASURY_ADDRESS;
  process.env.PLATFORM_IP_OWNER_ADDRESS = IP_OWNER;
  delete process.env.PLATFORM_TREASURY_ADDRESS;
});
test.afterEach(() => {
  if (savedIpOwner === undefined) delete process.env.PLATFORM_IP_OWNER_ADDRESS;
  else process.env.PLATFORM_IP_OWNER_ADDRESS = savedIpOwner;
  if (savedTreasury === undefined) delete process.env.PLATFORM_TREASURY_ADDRESS;
  else process.env.PLATFORM_TREASURY_ADDRESS = savedTreasury;
});

// 内存版 DB：只实现角色卡与 character_mints 用到的 SQL，返回格式对齐 mysql2 的 [rows]。
function makeDb() {
  const state = { cards: [], mints: [], tokenAlloc: null };

  function query(sql) {
    return String(sql).replace(/\s+/g, ' ').trim();
  }

  function setSegment(sql) {
    return sql.slice(sql.indexOf(' SET ') + 5, sql.indexOf(' WHERE '));
  }

  async function execute(rawSql, params = []) {
    const sql = query(rawSql);

    if (sql.startsWith('SELECT * FROM character_cards WHERE id = ?')) {
      return [state.cards.filter((row) => row.id === params[0]), []];
    }

    if (sql.startsWith("UPDATE character_cards SET status = 'minted'")) {
      const row = state.cards.find((item) => item.id === params[1] && item.user_id === params[2]);
      if (row) {
        row.status = 'minted';
        row.updated_at = params[0];
      }
      return [{ affectedRows: row ? 1 : 0 }, []];
    }

    if (sql.startsWith('SELECT * FROM character_mints WHERE card_id = ?')) {
      return [state.mints.filter((row) => row.card_id === params[0]), []];
    }

    if (sql.startsWith('SELECT MAX(token_id) AS max_token FROM character_mints')) {
      const max = state.mints.reduce((value, row) => Math.max(value, Number(row.token_id) || 0), 0);
      return [[{ max_token: max || null }], []];
    }

    if (sql.startsWith('SELECT MAX(token_id) AS max_token FROM character_series_items')) {
      return [[{ max_token: null }], []];
    }

    if (sql.startsWith('SELECT next_id FROM character_token_alloc WHERE id = 1 FOR UPDATE')) {
      return [state.tokenAlloc === null ? [] : [{ next_id: state.tokenAlloc }], []];
    }

    if (sql.startsWith('INSERT INTO character_token_alloc (id, next_id)')) {
      state.tokenAlloc = Number(params[0]);
      return [{ affectedRows: 1 }, []];
    }

    if (sql.startsWith('UPDATE character_token_alloc SET next_id = ? WHERE id = 1')) {
      state.tokenAlloc = Number(params[0]);
      return [{ affectedRows: 1 }, []];
    }

    if (sql.startsWith('INSERT INTO character_mints')) {
      const [id, cardId, userId, tokenId, workHash, createdAt, updatedAt] = params;
      if (state.mints.some((row) => row.card_id === cardId)) {
        const error = new Error('duplicate card mint');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      if (state.mints.some((row) => Number(row.token_id) === Number(tokenId))) {
        const error = new Error('duplicate token');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      state.mints.push({
        id, card_id: cardId, user_id: userId, token_id: tokenId, work_hash: workHash,
        dci_id: null, ant_tx_hash: null, status: 'pending', error: null,
        created_at: createdAt, updated_at: updatedAt,
      });
      return [{ affectedRows: 1 }, []];
    }

    if (sql.startsWith('UPDATE character_mints')) {
      const fields = [...setSegment(sql).matchAll(/(\w+) = \?/g)].map((match) => match[1]);
      const id = params[params.length - 1];
      const row = state.mints.find((item) => item.id === id);
      if (row) fields.forEach((field, index) => { row[field] = params[index]; });
      return [{ affectedRows: row ? 1 : 0 }, []];
    }

    throw new Error(`unexpected sql: ${sql}`);
  }

  return {
    execute,
    addCard(overrides = {}) {
      const row = {
        id: 'card_mint_1',
        user_id: USER.id,
        name: '铸造角色',
        source: 'text',
        style: 'general',
        prompt: '测试形象',
        persona: '安静',
        fear: '黑暗',
        habit: '发呆',
        traits: JSON.stringify({ background: 'bg_aurora' }),
        seed: 42,
        status: 'generated',
        image_key: 'char_' + 'a'.repeat(64) + '.png',
        thumb_key: 'char_' + 'a'.repeat(64) + '_thumb.png',
        composition_hash: 'a'.repeat(64),
        rarity_tier: 'rare',
        rarity_score: 72,
        generated_at: 1,
        created_at: 1,
        updated_at: 1,
        ...overrides,
      };
      state.cards.push(row);
      return row;
    },
    inspect() {
      return state;
    },
  };
}

// 假商务服务：扣费、建 AI、退款都记录在内存，行为对齐真实 commerce 的幂等语义。
function makeCommerce({ diamonds = 1000, failElf = false, humanAddress = HUMAN_ADDRESS } = {}) {
  const state = { diamonds, elves: [], refunds: 0, elfFailures: failElf, humanAddress };

  return {
    state,
    async characterAddress() {
      return state.humanAddress;
    },
    async characterBalance() {
      return { diamonds: state.diamonds, refundDebt: 0 };
    },
    async createElfFromCharacter(user, { card, chain }) {
      const existing = state.elves.find((item) => item.characterCardId === card.id);
      if (existing) return { elf: existing, created: false };
      state.diamonds -= CREATE_ELF_COST;
      if (state.elfFailures) {
        state.elfFailures = false;
        const error = new Error('创建 AI 失败');
        error.charged = true;
        throw error;
      }
      const elf = {
        id: 'ugc_' + state.elves.length + 1,
        name: card.name,
        characterCardId: card.id,
        tokenId: chain.tokenId,
        imageUrl: chain.imageUrl,
        thumbUrl: chain.thumbUrl,
        workHash: chain.workHash,
        dciId: chain.dciId,
        dciTxHash: chain.antTxHash,
      };
      state.elves.push(elf);
      return { elf, created: true };
    },
    async refundCharacterMint() {
      // 与真实实现一致：同一张卡只退一次。
      state.refunds += 1;
      state.diamonds += CREATE_ELF_COST;
      return { diamonds: state.diamonds };
    },
  };
}

// 假链客户端：enabled=false 模拟未开通；failMint 模拟 B2B 铸造失败；authValid=false 模拟授权失效。
function makeClient({ enabled = true, failMint = false, authValid = true, authId = 7 } = {}) {
  const state = {
    registerCalls: 0, mintCalls: 0, validCalls: [], lastRegister: null, lastMint: null, authId,
  };
  return {
    enabled,
    state,
    async registerAuth(payload) {
      state.registerCalls += 1;
      state.lastRegister = payload;
      return { txHash: '0x' + 'a'.repeat(64), status: 0, blockNumber: 1 };
    },
    async findAuthId({ contractNo, workHash }) {
      return { authId: state.authId, record: { contractNo, workHash } };
    },
    async isAuthValid(id) {
      state.validCalls.push(Number(id));
      return authValid;
    },
    async mintB2B(args) {
      state.mintCalls += 1;
      state.lastMint = args;
      if (failMint) {
        const error = new Error('B2B 铸造失败：授权额度不足');
        error.statusCode = 502;
        error.code = 'CHAIN_MINT_FAILED';
        throw error;
      }
      return { txHash: '0x' + 'b'.repeat(64), status: 0 };
    },
  };
}

function makeAssets() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'character-mint-test-'));
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]);
  fs.writeFileSync(path.join(dir, 'char_' + 'a'.repeat(64) + '.png'), png);
  fs.writeFileSync(path.join(dir, 'char_' + 'a'.repeat(64) + '_thumb.png'), Buffer.from([1, 2, 3]));
  return dir;
}

async function runMint({ commerce, client, cardId, assetsDir }) {
  return prepareAndMint(makeDbHolder.db, {
    userId: USER.id,
    user: USER,
    cardId,
    commerce,
    client,
    assetsDir,
    publicAssetBase: 'https://assets.example.com',
  });
}

// 让 runMint 与测试共用同一个 db 实例。
const makeDbHolder = {};

function seed(options = {}) {
  const db = makeDb();
  makeDbHolder.db = db;
  const card = db.addCard(options.card || {});
  const assetsDir = makeAssets();
  return { db, card, assetsDir };
}

test('链未配置 → 503 CHAIN_DISABLED 且钻石余额不变', async () => {
  const { db, card, assetsDir } = seed();
  const commerce = makeCommerce();
  const client = createLinkspriteClient({ baseUrl: '', apiKey: '' });
  await assert.rejects(
    () => runMint({ commerce, client, cardId: card.id, assetsDir }),
    (error) => {
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, 'CHAIN_DISABLED');
      return true;
    },
  );
  assert.equal(commerce.state.diamonds, 1000);
  assert.equal(db.inspect().mints.length, 0);
});

test('铸造成功 → 授权登记 + B2B 上链、钻石 -200、elf 含 imageUrl/tokenId、重复调用不重复扣费', async () => {
  const { db, card, assetsDir } = seed();
  const commerce = makeCommerce();
  const client = makeClient();

  const first = await runMint({ commerce, client, cardId: card.id, assetsDir });
  assert.equal(commerce.state.diamonds, 1000 - CREATE_ELF_COST);
  assert.ok(first.elf, '应返回 elf');
  assert.equal(first.elf.characterCardId, card.id);
  assert.equal(first.elf.tokenId, 1);
  assert.match(first.elf.imageUrl, /^https:\/\/assets\.example\.com\/api\/v1\/character-assets\/char_/);
  assert.equal(first.tokenId, 1);
  assert.equal(first.chain.authId, client.state.authId);
  assert.equal(first.chain.txHash, '0x' + 'b'.repeat(64));
  assert.match(first.chain.contractNo, new RegExp(`^OPENELF-UGC-${card.id.slice(0, 8)}-\\d+$`));
  assert.equal(first.chain.dciId, undefined);
  assert.equal(first.chain.antTxHash, undefined);

  // 授权参数与 B2B 参数都来自本次铸造，作品哈希随铸造上链。
  assert.equal(client.state.lastRegister.ipOwner, IP_OWNER);
  assert.equal(client.state.lastRegister.scope, 1);
  assert.equal(client.state.lastRegister.maxMint, 1);
  assert.equal(client.state.lastRegister.contractNo, first.chain.contractNo);
  assert.equal(client.state.lastRegister.endTime - client.state.lastRegister.startTime, 10 * 365 * 24 * 60 * 60 * 1000);
  assert.equal(client.state.lastMint.to, HUMAN_ADDRESS);

  const savedCard = db.inspect().cards.find((row) => row.id === card.id);
  assert.equal(savedCard.status, 'minted');
  const savedMint = db.inspect().mints[0];
  assert.equal(savedMint.status, 'minted');
  assert.equal(savedMint.auth_id, first.chain.authId);
  assert.equal(savedMint.tx_hash, first.chain.txHash);
  assert.equal(savedMint.contract_no, first.chain.contractNo);
  assert.equal(savedMint.dci_id, null);
  assert.equal(savedMint.ant_tx_hash, null);
  assert.ok(fs.existsSync(path.join(assetsDir, `meta_${savedMint.work_hash}.json`)));

  // 重复铸造：同一结果，且不再扣费、不再调用链。
  const second = await runMint({ commerce, client, cardId: card.id, assetsDir });
  assert.equal(second.tokenId, first.tokenId);
  assert.equal(second.elf.id, first.elf.id);
  assert.equal(second.chain.authId, first.chain.authId);
  assert.equal(second.chain.txHash, first.chain.txHash);
  assert.equal(second.chain.contractNo, first.chain.contractNo);
  assert.equal(commerce.state.diamonds, 1000 - CREATE_ELF_COST);
  assert.equal(client.state.mintCalls, 1);
  assert.equal(client.state.registerCalls, 1);
});

test('mint 失败 → 不扣钻石、mint 记录 failed', async () => {
  const { db, card, assetsDir } = seed();
  const commerce = makeCommerce();
  const client = makeClient({ failMint: true });

  await assert.rejects(
    () => runMint({ commerce, client, cardId: card.id, assetsDir }),
    (error) => {
      assert.equal(error.statusCode, 502);
      assert.equal(error.code, 'CHAIN_UPSTREAM_ERROR');
      assert.match(error.message, /B2B 铸造失败/);
      return true;
    },
  );
  assert.equal(commerce.state.diamonds, 1000);
  assert.equal(commerce.state.elves.length, 0);
  const savedMint = db.inspect().mints[0];
  assert.equal(savedMint.status, 'failed');
  assert.match(savedMint.error, /B2B 铸造失败/);
  assert.equal(savedMint.dci_id, null);
  assert.equal(savedMint.ant_tx_hash, null);
});

test('授权校验失败 → 409 AUTH_INVALID 且不扣费、不上链铸造', async () => {
  const { db, card, assetsDir } = seed();
  const commerce = makeCommerce();
  const client = makeClient({ authValid: false });

  await assert.rejects(
    () => runMint({ commerce, client, cardId: card.id, assetsDir }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, 'AUTH_INVALID');
      return true;
    },
  );
  assert.equal(commerce.state.diamonds, 1000);
  assert.equal(commerce.state.elves.length, 0);
  assert.equal(client.state.mintCalls, 0);
  const savedMint = db.inspect().mints[0];
  assert.equal(savedMint.status, 'failed');
});

test('未配置 ipOwner → 503 IP_OWNER_NOT_CONFIGURED 且不占用 tokenId', async () => {
  const { db, card, assetsDir } = seed();
  const commerce = makeCommerce();
  const client = makeClient();
  delete process.env.PLATFORM_IP_OWNER_ADDRESS;
  delete process.env.PLATFORM_TREASURY_ADDRESS;

  await assert.rejects(
    () => runMint({ commerce, client, cardId: card.id, assetsDir }),
    (error) => {
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, 'IP_OWNER_NOT_CONFIGURED');
      return true;
    },
  );
  assert.equal(commerce.state.diamonds, 1000);
  assert.equal(db.inspect().mints.length, 0);
});

test('扣费后 elf 创建抛错 → 自动 +200 退款、记录 orphan', async () => {
  const { db, card, assetsDir } = seed();
  const commerce = makeCommerce({ failElf: true });
  const client = makeClient();

  await assert.rejects(
    () => runMint({ commerce, client, cardId: card.id, assetsDir }),
    (error) => {
      assert.equal(error.statusCode, 500);
      assert.equal(error.code, 'MINT_SETTLE_FAILED');
      return true;
    },
  );
  assert.equal(commerce.state.diamonds, 1000, '扣费后应自动退回 200 钻石');
  assert.equal(commerce.state.refunds, 1);
  const savedMint = db.inspect().mints[0];
  assert.equal(savedMint.status, 'orphan');
  assert.equal(savedMint.dci_id, null);
  assert.equal(savedMint.ant_tx_hash, null);
  assert.ok(savedMint.auth_id && savedMint.tx_hash, 'orphan 记录保留授权与交易哈希');
});

test('非本人或未生成的角色卡拒绝铸造', async () => {
  const { db, card, assetsDir } = seed({ card: { user_id: 'u_other' } });
  const commerce = makeCommerce();
  const client = makeClient();

  await assert.rejects(
    () => runMint({ commerce, client, cardId: card.id, assetsDir }),
    (error) => error.statusCode === 404 && error.code === 'CARD_NOT_FOUND',
  );

  const draft = db.addCard({ id: 'card_draft', status: 'draft' });
  await assert.rejects(
    () => runMint({ commerce, client, cardId: draft.id, assetsDir }),
    (error) => error.statusCode === 409 && error.code === 'CARD_NOT_GENERATED',
  );
  assert.equal(commerce.state.diamonds, 1000);
});
