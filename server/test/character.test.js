'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const parts = require('../src/character/parts');
const render = require('../src/character/render');
const { createCharacterStore } = require('../src/character/store');
const { refineCharacter } = require('../src/character/refine');

// 内存版 DB：只实现 character 模块用到的 SQL，行为对齐 MySQL2 的 [rows] 返回。
function makeDb() {
  const state = {
    cards: [],
    compositions: new Map(),
    runs: [],
    compositionAttempts: 0,
  };

  function query(sql) {
    return String(sql).replace(/\s+/g, ' ').trim();
  }

  async function execute(rawSql, params = []) {
    const sql = query(rawSql);

    if (sql.startsWith('INSERT INTO character_cards')) {
      const [
        id, user_id, name, source, style, prompt, persona, fear, habit, traits, seed, status,
        image_key, thumb_key, composition_hash, rarity_tier, rarity_score, generated_at,
        created_at, updated_at,
      ] = params;
      state.cards.push({
        id, user_id, name, source, style, prompt, persona, fear, habit, traits, seed, status,
        image_key, thumb_key, composition_hash, rarity_tier, rarity_score, generated_at,
        created_at, updated_at,
      });
      return [{ affectedRows: 1 }, []];
    }

    if (sql.startsWith('SELECT * FROM character_cards WHERE id = ?')) {
      return [state.cards.filter((row) => row.id === params[0]), []];
    }

    if (sql.startsWith('SELECT * FROM character_cards WHERE user_id = ?')) {
      const [userId, limit] = params;
      const rows = state.cards
        .filter((row) => row.user_id === userId)
        .sort((left, right) => Number(right.updated_at) - Number(left.updated_at))
        .slice(0, Number(limit) || 50);
      return [rows, []];
    }

    if (sql.startsWith('UPDATE character_cards SET ')) {
      const setPart = sql.slice('UPDATE character_cards SET '.length, sql.indexOf(' WHERE '));
      const assignments = [...setPart.matchAll(/(\w+) = (\?|'[^']*')/g)];
      const id = params[params.length - 2];
      const userId = params[params.length - 1];
      const row = state.cards.find((item) => item.id === id && item.user_id === userId);
      if (row) {
        let index = 0;
        for (const [, field, expression] of assignments) {
          row[field] = expression === '?' ? params[index] : expression.slice(1, -1);
          if (expression === '?') index += 1;
        }
      }
      return [{ affectedRows: row ? 1 : 0 }, []];
    }

    if (sql.startsWith('INSERT INTO character_compositions')) {
      const [hash, cardId, createdAt] = params;
      state.compositionAttempts += 1;
      if (state.compositions.has(hash)) {
        const error = new Error('duplicate composition');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      state.compositions.set(hash, { card_id: cardId, created_at: createdAt });
      return [{ affectedRows: 1 }, []];
    }

    if (sql.startsWith('INSERT INTO character_runs')) {
      state.runs.push(params);
      return [{ affectedRows: 1 }, []];
    }

    if (sql.startsWith('SELECT balance_micro')) {
      return [[], []];
    }

    throw new Error(`unexpected sql: ${sql}`);
  }

  return {
    execute,
    seedComposition(hash, cardId = 'other') {
      state.compositions.set(hash, { card_id: cardId, created_at: 0 });
    },
    inspect() {
      return state;
    },
  };
}

function tempAssetsDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'character-test-'));
}

const SMALL_RENDER = { width: 512, height: 768, scale: 1, thumbWidth: 128, thumbHeight: 192 };

test('同 traits + seed 两次渲染：compositionHash 与 PNG 字节完全一致', () => {
  const traits = parts.pickTraits(12345, 'general');
  const card = { name: '测试角色', style: 'general', traits, seed: 12345 };
  const first = render.renderCard(card, SMALL_RENDER);
  const second = render.renderCard(card, SMALL_RENDER);

  assert.match(first.compositionHash, /^[a-f0-9]{64}$/);
  assert.equal(first.compositionHash, second.compositionHash);
  assert.equal(first.png.length, second.png.length);
  assert.deepEqual(first.png, second.png);
  assert.equal(first.thumbPng.length, second.thumbPng.length);
  assert.deepEqual(first.thumbPng, second.thumbPng);
});

test('不同 seed 得到不同 compositionHash', () => {
  const traits = parts.pickTraits(9001, 'general');
  const left = render.renderCard({ style: 'general', traits, seed: 9001 }, SMALL_RENDER);
  const right = render.renderCard({ style: 'general', traits, seed: 9002 }, SMALL_RENDER);
  assert.notEqual(left.compositionHash, right.compositionHash);
});

test('组合唯一性冲突时自动换 seed 重试', async () => {
  const db = makeDb();
  const assetsDir = tempAssetsDir();
  const store = createCharacterStore({
    db,
    assetsDir,
    renderOptions: { width: 256, height: 384, scale: 1, thumbWidth: 64, thumbHeight: 96 },
  });
  const card = await store.createCard('u1', { name: '唯一性测试', style: 'general', source: 'text' });
  const seed = 777;
  const traits = parts.pickTraits(seed, 'general');
  const conflictHash = render.compositionHash({ style: 'general', traits, seed });
  db.seedComposition(conflictHash);

  const saved = await store.saveGenerated('u1', card.id, { traits, seed });

  assert.notEqual(saved.card.seed, seed);
  assert.notEqual(saved.card.composition_hash, conflictHash);
  assert.ok(saved.card.seed > seed);
  assert.equal(db.inspect().compositionAttempts, 2);
  assert.equal(db.inspect().compositions.has(saved.card.composition_hash), true);
  assert.equal(saved.card.status, 'generated');
  assert.ok(fs.existsSync(path.join(assetsDir, saved.card.image_key)));
  assert.ok(fs.existsSync(path.join(assetsDir, saved.card.thumb_key)));

  const detail = await store.getCard('u1', card.id);
  assert.equal(detail.composition_hash, saved.card.composition_hash);
  assert.notEqual(detail.traits, null);
});

test('refine 未配置时返回 skipped 且不抛错', async () => {
  const previousUrl = process.env.CHARACTER_REFINE_URL;
  const previousModel = process.env.CHARACTER_REFINE_MODEL;
  delete process.env.CHARACTER_REFINE_URL;
  delete process.env.CHARACTER_REFINE_MODEL;
  try {
    const result = await refineCharacter({
      db: { execute: () => { throw new Error('不应访问数据库'); } },
      userId: 'u1',
      png: Buffer.from([1, 2, 3]),
      prompt: '精修提示词',
    });
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'not_configured');
  } finally {
    if (previousUrl !== undefined) process.env.CHARACTER_REFINE_URL = previousUrl;
    if (previousModel !== undefined) process.env.CHARACTER_REFINE_MODEL = previousModel;
  }
});

test('生成的 PNG 有正确签名且宽高符合预期', () => {
  const traits = parts.pickTraits(42, 'general');
  const png = render.renderPng({ traits, seed: 42, style: 'general', scale: 1 });
  const magic = [...png.subarray(0, 8)];
  assert.deepEqual(magic, [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), render.DEFAULT_WIDTH);
  assert.equal(png.readUInt32BE(20), render.DEFAULT_HEIGHT);
});
