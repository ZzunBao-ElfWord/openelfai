'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fssync = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { memoryStore } = require('./helpers/payment_memory');
const { createCommerceService, CREATE_ELF_COST } = require('../src/commerce');
const { PNG_SIGNATURE } = require('../src/character/png');
const { prepareAndMint } = require('../src/character/mint');
const { cleanupBatchCandidates } = require('../src/character/batch_cleanup');

const A = { id: 'u_1234567890abcdef1234567890abcdef', nickname: 'A', phone: '13800000001' };
// 小尺寸渲染参数：测试只验证管线路由与落盘，不需要全尺寸出图。
const TINY = { width: 64, height: 96, scale: 1, thumbWidth: 32, thumbHeight: 48, thumbScale: 1 };

function tmpdir() {
  return fssync.mkdtempSync(path.join(os.tmpdir(), 'elf-avatar-'));
}

function makeService(store, assetsDir) {
  return createCommerceService({
    store,
    settings: { enabled: true, sandboxOnly: false, allowSandbox: true },
    avatarAssetsDir: assetsDir,
    avatarRenderOptions: TINY,
  });
}

function fixture({ diamonds = 5000 } = {}) {
  const store = memoryStore();
  store.addUser(A);
  // 预存钻石余额（与 apple_iap 测试同一内存模式）。
  store.seedLegacy('Production', { transaction_id: 't1', user_id: A.id, product_id: 'sku', diamonds }, diamonds);
  const assetsDir = tmpdir();
  const commerce = makeService(store, assetsDir);
  let seq = 0;
  const action = (type, payload = {}) => commerce.action(A, {
    requestId: 'request_' + String(++seq).padStart(12, '0'), environment: 'Production', type, ...payload });
  return { store, commerce, assetsDir, action };
}

test('create_elf 同步渲染头像：主图+缩略图落盘，URL 写入精灵记录与快照载荷', async () => {
  const f = fixture();
  await f.action('create_elf', { name: '小岚', prompt: '安静的少女', style: '通用' });
  const snap = await f.commerce.snapshot(A, 'Production');
  const elf = snap.commerce.elves.find((item) => item.id.startsWith('ugc_'));
  assert.ok(elf, '应创建出 UGC 精灵');
  assert.match(elf.imageUrl, /^\/api\/v1\/world-assets\/elf_[a-f0-9]{64}\.png$/);
  assert.match(elf.imageThumbUrl, /^\/api\/v1\/world-assets\/elf_[a-f0-9]{64}_thumb\.png$/);
  assert.equal(snap.wallet.diamonds, 5000 - CREATE_ELF_COST);
  for (const url of [elf.imageUrl, elf.imageThumbUrl]) {
    const file = url.replace('/api/v1/world-assets/', '');
    const buf = await fs.readFile(path.join(f.assetsDir, file));
    assert.ok(buf.subarray(0, 8).equals(PNG_SIGNATURE), `${file} 应为 PNG`);
  }
});

test('create_elf 渲染失败不阻断创建：精灵照建，头像字段置 null', async () => {
  const f = fixture();
  // 落盘目录指向一个已存在的文件路径：mkdir/writeFile 必然失败。
  const blocker = path.join(f.assetsDir, 'blocker');
  await fs.writeFile(blocker, 'x');
  const commerce = makeService(f.store, blocker);
  await commerce.action(A, {
    requestId: 'request_render_fail_01', environment: 'Production',
    type: 'create_elf', name: '小柯', prompt: '安静的少年',
  });
  const snap = await commerce.snapshot(A, 'Production');
  const elf = snap.commerce.elves.find((item) => item.id.startsWith('ugc_'));
  assert.ok(elf, '渲染失败不应阻断创建');
  assert.equal(elf.imageUrl, null);
  assert.equal(elf.imageThumbUrl, null);
});

test('购买官方精灵复制种子头像；种子缺失时置 null 不阻断购买', async () => {
  const f = fixture();
  await f.store.transaction('Production', (tx) => tx.put('elf_avatar_seed', 'pm_001', {
    templateId: 'pm_001',
    imageUrl: '/api/v1/world-assets/elf_seed1.png',
    imageThumbUrl: '/api/v1/world-assets/elf_seed1_thumb.png',
    imageKey: 'elf_seed1.png',
    thumbKey: 'elf_seed1_thumb.png',
  }, { state: 'active' }));

  await f.action('buy', { listingId: 'pm_001' }); // 有种子
  await f.action('buy', { listingId: 'pm_002' }); // 无种子
  const snap = await f.commerce.snapshot(A, 'Production');
  const dust = snap.commerce.elves.find((item) => item.templateId === 'pm_001');
  assert.ok(dust);
  assert.equal(dust.imageUrl, '/api/v1/world-assets/elf_seed1.png');
  assert.equal(dust.imageThumbUrl, '/api/v1/world-assets/elf_seed1_thumb.png');
  const mocha = snap.commerce.elves.find((item) => item.templateId === 'pm_002');
  assert.ok(mocha, '种子缺失不应阻断购买');
  assert.equal(mocha.imageUrl, null);
  assert.equal(mocha.imageThumbUrl, null);
  // 市场货架同样带头像字段。
  assert.equal(snap.commerce.primary.find((item) => item.id === 'pm_001').imageUrl,
    '/api/v1/world-assets/elf_seed1.png');
  assert.equal(snap.commerce.primary.find((item) => item.id === 'pm_003').imageUrl, null);
});

test('精灵载荷统一带 imageUrl / imageThumbUrl 字段（无图时为 null）', async () => {
  const f = fixture();
  const snap = await f.commerce.snapshot(A, 'Production');
  assert.ok(snap.commerce.elves.length > 0);
  for (const elf of snap.commerce.elves) {
    assert.ok('imageUrl' in elf, '快照精灵缺 imageUrl 字段');
    assert.ok('imageThumbUrl' in elf, '快照精灵缺 imageThumbUrl 字段');
  }
  // 起始精灵（未出图）字段存在且为 null。
  const starter = snap.commerce.elves.find((item) => item.name === '青梧');
  assert.ok(starter);
  assert.equal(starter.imageUrl, null);
  const feed = await f.commerce.listFeed(A, { environment: 'Production', channel: 'world', sort: 'latest' });
  for (const elf of feed.elves) {
    assert.ok('imageUrl' in elf && 'imageThumbUrl' in elf, '信息流精灵缺头像字段');
  }
});

// —— 铸造后清理中间候选图 ——

const MINT_USER = { id: 'u_avatar_mint', nickname: '头像铸造' };
const ELECTED = 'char_' + 'a'.repeat(64) + '.png';
const ELECTED_THUMB = 'char_' + 'a'.repeat(64) + '_thumb.png';
const OTHER1 = 'char_' + 'b'.repeat(64) + '.png';
const OTHER1_THUMB = 'char_' + 'b'.repeat(64) + '_thumb.png';
const OTHER2 = 'char_' + 'c'.repeat(64) + '.png';
const OTHER2_THUMB = 'char_' + 'c'.repeat(64) + '_thumb.png';
const SHEET = 'batch_' + 'f'.repeat(32) + '_sheet.png';
const FOREIGN = 'char_' + 'd'.repeat(64) + '.png';
const FOREIGN_THUMB = 'char_' + 'd'.repeat(64) + '_thumb.png';
const FOREIGN_SHEET = 'batch_' + 'e'.repeat(32) + '_sheet.png';

let savedIpOwner;
test.beforeEach(() => {
  savedIpOwner = process.env.PLATFORM_IP_OWNER_ADDRESS;
  process.env.PLATFORM_IP_OWNER_ADDRESS = '0x' + 'c'.repeat(40);
});
test.afterEach(() => {
  if (savedIpOwner === undefined) delete process.env.PLATFORM_IP_OWNER_ADDRESS;
  else process.env.PLATFORM_IP_OWNER_ADDRESS = savedIpOwner;
});

// 内存版 DB：覆盖 mint 链路与候选清理的引用检查 SQL，行为对齐 mysql2 的 [rows] 返回。
function makeMintDb() {
  const state = { cards: [], mints: [], tokenAlloc: null };

  async function execute(rawSql, params = []) {
    const sql = String(rawSql).replace(/\s+/g, ' ').trim();

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
    if (sql.startsWith('SELECT id FROM character_cards WHERE image_key = ?')) {
      return [state.cards
        .filter((row) => [row.image_key, row.thumb_key].includes(params[0])
          || [row.image_key, row.thumb_key].includes(params[1]))
        .slice(0, 1)
        .map((row) => ({ id: row.id })), []];
    }
    if (sql.startsWith('SELECT id FROM character_series_items WHERE image_key = ?')) {
      return [[], []];
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
      state.mints.push({
        id, card_id: cardId, user_id: userId, token_id: tokenId, work_hash: workHash,
        dci_id: null, ant_tx_hash: null, status: 'pending', error: null,
        created_at: createdAt, updated_at: updatedAt,
      });
      return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith('UPDATE character_mints')) {
      const segment = sql.slice(sql.indexOf(' SET ') + 5, sql.indexOf(' WHERE '));
      const fields = [...segment.matchAll(/(\w+) = \?/g)].map((match) => match[1]);
      const id = params[params.length - 1];
      const row = state.mints.find((item) => item.id === id);
      if (row) fields.forEach((field, index) => { row[field] = params[index]; });
      return [{ affectedRows: row ? 1 : 0 }, []];
    }
    throw new Error(`unexpected sql: ${sql}`);
  }

  return {
    execute,
    state,
    addCard(overrides = {}) {
      const row = {
        id: 'card_avatar_1',
        user_id: MINT_USER.id,
        name: '候选角色',
        source: 'text',
        style: 'anime',
        prompt: '测试形象',
        persona: '安静',
        fear: '黑暗',
        habit: '发呆',
        traits: '{}',
        seed: 1,
        status: 'generated',
        image_key: ELECTED,
        thumb_key: ELECTED_THUMB,
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
  };
}

// 假商务服务：只实现 mint 链路用到的四个方法。
function makeMintCommerce() {
  const state = { diamonds: 1000, elves: [] };
  return {
    state,
    async characterAddress() {
      return '0x' + 'd'.repeat(40);
    },
    async characterBalance() {
      return { diamonds: state.diamonds, refundDebt: 0 };
    },
    async createElfFromCharacter(user, { card, chain }) {
      const elf = { id: 'ugc_avatar_1', characterCardId: card.id, imageUrl: chain.imageUrl };
      state.elves.push(elf);
      return { elf, created: true };
    },
    async refundCharacterMint() {
      state.diamonds += CREATE_ELF_COST;
      return { diamonds: state.diamonds };
    },
  };
}

// 假链客户端：登记/反查/校验/B2B 全部成功。
function makeMintClient() {
  return {
    enabled: true,
    async registerAuth() {
      return { txHash: '0x' + 'a'.repeat(64), status: 0 };
    },
    async findAuthId() {
      return { authId: 7 };
    },
    async isAuthValid() {
      return true;
    },
    async mintB2B() {
      return { txHash: '0x' + 'b'.repeat(64), status: 0 };
    },
  };
}

// 构造两个批次的候选目录：b1 含当选图，b2 是完全无关的另一批次。
async function makeBatchAssets() {
  const dir = fssync.mkdtempSync(path.join(os.tmpdir(), 'elf-batch-clean-'));
  const png = Buffer.concat([PNG_SIGNATURE, Buffer.from([1, 2, 3])]);
  for (const key of [ELECTED, ELECTED_THUMB, OTHER1, OTHER1_THUMB, OTHER2, OTHER2_THUMB,
    SHEET, FOREIGN, FOREIGN_THUMB, FOREIGN_SHEET]) {
    await fs.writeFile(path.join(dir, key), png);
  }
  await fs.mkdir(path.join(dir, 'batches'), { recursive: true });
  await fs.writeFile(path.join(dir, 'batches', 'b1.json'), JSON.stringify({
    id: 'b1', name: '批次一', style: 'anime', count: 3, seedStart: 1, sheetKey: SHEET,
    createdBy: 'ops', createdAt: 1,
    items: [
      { index: 0, seed: 1, compositionHash: 'a'.repeat(64), imageKey: ELECTED, thumbKey: ELECTED_THUMB },
      { index: 1, seed: 2, compositionHash: 'b'.repeat(64), imageKey: OTHER1, thumbKey: OTHER1_THUMB },
      { index: 2, seed: 3, compositionHash: 'c'.repeat(64), imageKey: OTHER2, thumbKey: OTHER2_THUMB },
    ],
  }));
  await fs.writeFile(path.join(dir, 'batches', 'b2.json'), JSON.stringify({
    id: 'b2', name: '批次二', style: 'anime', count: 1, seedStart: 9, sheetKey: FOREIGN_SHEET,
    createdBy: 'ops', createdAt: 2,
    items: [
      { index: 0, seed: 9, compositionHash: 'd'.repeat(64), imageKey: FOREIGN, thumbKey: FOREIGN_THUMB },
    ],
  }));
  return dir;
}

test('mint 成功后清理同批次未当选候选与联系表；当选图/manifest/其他批次保留', async () => {
  const db = makeMintDb();
  const card = db.addCard();
  const dir = await makeBatchAssets();
  const commerce = makeMintCommerce();

  const result = await prepareAndMint(db, {
    userId: MINT_USER.id,
    user: MINT_USER,
    cardId: card.id,
    commerce,
    client: makeMintClient(),
    assetsDir: dir,
    publicAssetBase: 'https://assets.example.com',
  });
  assert.ok(result.elf, '铸造应成功');

  // 未当选候选（主图+缩略图）与联系表已删除。
  for (const key of [OTHER1, OTHER1_THUMB, OTHER2, OTHER2_THUMB, SHEET]) {
    await assert.rejects(fs.access(path.join(dir, key)), `${key} 应被清理`);
  }
  // 当选图、两个批次的 manifest、另一批次全部文件保留。
  for (const key of [ELECTED, ELECTED_THUMB, FOREIGN, FOREIGN_THUMB, FOREIGN_SHEET]) {
    await fs.access(path.join(dir, key));
  }
  await fs.access(path.join(dir, 'batches', 'b1.json'));
  await fs.access(path.join(dir, 'batches', 'b2.json'));
});

test('候选仍被其他角色卡引用时不删；无批次目录时直接跳过', async () => {
  const dir = await makeBatchAssets();
  // 引用检查 stub：character_cards 里有一行引用 OTHER1。
  const db = {
    async execute(rawSql) {
      const sql = String(rawSql).replace(/\s+/g, ' ').trim();
      if (sql.startsWith('SELECT id FROM character_cards WHERE image_key = ?')) {
        return [[{ id: 'card_holder' }], []];
      }
      return [[], []];
    },
  };
  const result = await cleanupBatchCandidates({
    db, assetsDir: dir, imageKey: ELECTED, thumbKey: ELECTED_THUMB,
  });
  assert.equal(result.matched, 'b1');
  assert.equal(result.removed, 0);
  assert.ok(result.kept > 0);
  for (const key of [OTHER1, OTHER1_THUMB, OTHER2, OTHER2_THUMB, SHEET]) {
    await fs.access(path.join(dir, key));
  }

  // 没有 batches 目录：不报错、不删任何东西。
  const empty = fssync.mkdtempSync(path.join(os.tmpdir(), 'elf-batch-empty-'));
  const skipped = await cleanupBatchCandidates({ db, assetsDir: empty, imageKey: ELECTED });
  assert.deepEqual(skipped, { matched: null, removed: 0, kept: 0 });
});
