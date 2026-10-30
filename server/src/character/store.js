'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');

const render = require('./render');

const DEFAULT_ASSETS_DIR = path.join(__dirname, '..', '..', 'assets', 'characters');
const MAX_GENERATE_ATTEMPTS = 50;
const MAX_NAME = 64;
const SOURCES = new Set(['text', 'idCard']);

function characterError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function textOrNull(value, maxLength) {
  if (value === undefined || value === null) return null;
  const text = String(value);
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

// 预占组合哈希；冲突（ER_DUP_ENTRY）返回 false，由调用方换 seed 重试。
// 单卡生成与批量生成共用这一份预占逻辑，保证全平台唯一。
async function claimComposition(db, hash, ownerId, createdAt = Date.now()) {
  try {
    await db.execute(
      'INSERT INTO character_compositions (composition_hash, card_id, created_at) VALUES (?, ?, ?)',
      [hash, ownerId, createdAt],
    );
    return true;
  } catch (error) {
    if (error && error.code === 'ER_DUP_ENTRY') return false;
    throw error;
  }
}

// 把 traits JSON 字符串转成对象返回给前端；seed 统一为 Number。
function publicCard(row) {
  if (!row) return null;
  let traits = null;
  if (row.traits) {
    if (typeof row.traits === 'string') {
      try {
        traits = JSON.parse(row.traits);
      } catch (_) {
        traits = null;
      }
    } else {
      traits = row.traits;
    }
  }
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    source: row.source,
    style: row.style,
    prompt: row.prompt,
    persona: row.persona,
    fear: row.fear,
    habit: row.habit,
    traits,
    seed: Number(row.seed || 0),
    status: row.status,
    image_key: row.image_key,
    thumb_key: row.thumb_key,
    composition_hash: row.composition_hash,
    rarity_tier: row.rarity_tier,
    rarity_score: Number(row.rarity_score || 0),
    generated_at: row.generated_at === null || row.generated_at === undefined ? null : Number(row.generated_at),
    created_at: Number(row.created_at || 0),
    updated_at: Number(row.updated_at || 0),
  };
}

function createCharacterStore({
  db,
  assetsDir = DEFAULT_ASSETS_DIR,
  now = () => Date.now(),
  renderOptions = {},
}) {
  const timestamp = () => Number(now());

  async function insertRow(row) {
    await db.execute(
      `INSERT INTO character_cards
        (id, user_id, name, source, style, prompt, persona, fear, habit, traits, seed, status,
         image_key, thumb_key, composition_hash, rarity_tier, rarity_score, generated_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id, row.user_id, row.name, row.source, row.style, row.prompt, row.persona,
        row.fear, row.habit, row.traits, row.seed, row.status, row.image_key, row.thumb_key,
        row.composition_hash, row.rarity_tier, row.rarity_score, row.generated_at,
        row.created_at, row.updated_at,
      ],
    );
  }

  async function findCardRow(id) {
    const [rows] = await db.execute('SELECT * FROM character_cards WHERE id = ?', [id]);
    return rows[0] || null;
  }

  async function createCard(userId, input = {}) {
    const name = String(input.name || '').trim();
    if (!name || name.length > MAX_NAME) {
      throw characterError(400, 'INVALID_NAME', '请输入 1-64 字的角色名');
    }
    const source = SOURCES.has(input.source) ? input.source : 'text';
    const style = String(input.style || 'general').slice(0, 24);
    const ts = timestamp();
    const seed = Number.isSafeInteger(Number(input.seed)) && Number(input.seed) >= 0
      ? Number(input.seed)
      : Math.floor(Math.random() * 0x7fffffff);
    const row = {
      id: crypto.randomUUID(),
      user_id: userId,
      name,
      source,
      style: style || 'general',
      prompt: textOrNull(input.prompt, 4000),
      persona: textOrNull(input.persona, 1000),
      fear: textOrNull(input.fear, 1000),
      habit: textOrNull(input.habit, 1000),
      traits: null,
      seed,
      status: 'draft',
      image_key: null,
      thumb_key: null,
      composition_hash: null,
      rarity_tier: null,
      rarity_score: 0,
      generated_at: null,
      created_at: ts,
      updated_at: ts,
    };
    await insertRow(row);
    return publicCard(await findCardRow(row.id));
  }

  async function getCard(userId, id) {
    const row = await findCardRow(id);
    if (!row || row.user_id !== userId) {
      throw characterError(404, 'CARD_NOT_FOUND', '角色卡不存在');
    }
    return publicCard(row);
  }

  const UPDATABLE = {
    name: (value) => {
      const name = String(value || '').trim();
      if (!name || name.length > MAX_NAME) throw characterError(400, 'INVALID_NAME', '请输入 1-64 字的角色名');
      return name;
    },
    source: (value) => {
      if (!SOURCES.has(value)) throw characterError(400, 'INVALID_SOURCE', '形象来源只能是 text 或 idCard');
      return value;
    },
    style: (value) => String(value || '').slice(0, 24) || 'general',
    prompt: (value) => textOrNull(value, 4000),
    persona: (value) => textOrNull(value, 1000),
    fear: (value) => textOrNull(value, 1000),
    habit: (value) => textOrNull(value, 1000),
    traits: (value) => JSON.stringify(value && typeof value === 'object' ? value : {}),
    seed: (value) => {
      const seed = Number(value);
      if (!Number.isSafeInteger(seed) || seed < 0) throw characterError(400, 'INVALID_SEED', 'seed 必须是非负整数');
      return seed;
    },
  };

  // 只有 draft 允许修改；生成后形象即视为锁定（铸造前仍可通过重新生成换组合）。
  async function updateCard(userId, id, patch = {}) {
    const existing = await findCardRow(id);
    if (!existing || existing.user_id !== userId) {
      throw characterError(404, 'CARD_NOT_FOUND', '角色卡不存在');
    }
    if (existing.status !== 'draft') {
      throw characterError(409, 'CARD_LOCKED', '形象草稿已生成，如需调整请重新生成');
    }
    const columns = [];
    const values = [];
    for (const [field, sanitize] of Object.entries(UPDATABLE)) {
      if (!Object.prototype.hasOwnProperty.call(patch, field) || patch[field] === undefined) continue;
      columns.push(`${field} = ?`);
      values.push(sanitize(patch[field]));
    }
    if (!columns.length) return publicCard(existing);
    columns.push('updated_at = ?');
    values.push(timestamp(), id, userId);
    await db.execute(
      `UPDATE character_cards SET ${columns.join(', ')} WHERE id = ? AND user_id = ?`,
      values,
    );
    return publicCard(await findCardRow(id));
  }

  async function listCards(userId, options = {}) {
    const limit = Math.max(1, Math.min(200, Number(options.limit) || 50));
    const [rows] = await db.execute(
      'SELECT * FROM character_cards WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?',
      [userId, limit],
    );
    return rows.map(publicCard);
  }

  // 渲染 + 落盘 + 预占组合；全平台唯一冲突时自动递增 seed，最多重试 50 次。
  async function saveGenerated(userId, cardId, { traits, seed } = {}) {
    const card = await getCard(userId, cardId);
    if (card.status === 'minted') {
      throw characterError(409, 'CARD_LOCKED', '已铸造形象不可重绘');
    }
    let currentSeed = render.normalizeSeed(seed === undefined || seed === null ? card.seed : seed);
    const fixedTraits = render.normalizeTraits(traits && Object.keys(traits).length ? traits : card.traits);
    let lastResult = null;
    for (let attempt = 0; attempt < MAX_GENERATE_ATTEMPTS; attempt += 1) {
      const result = render.renderCard(
        { ...card, style: card.style, traits: fixedTraits, seed: currentSeed },
        renderOptions,
      );
      lastResult = result;
      const claimed = await claimComposition(db, result.compositionHash, card.id, timestamp());
      if (!claimed) {
        currentSeed += 1;
        continue;
      }
      await fs.mkdir(assetsDir, { recursive: true });
      const imageKey = `char_${result.compositionHash}.png`;
      const thumbKey = `char_${result.compositionHash}_thumb.png`;
      await fs.writeFile(path.join(assetsDir, imageKey), result.png);
      await fs.writeFile(path.join(assetsDir, thumbKey), result.thumbPng);
      const ts = timestamp();
      await db.execute(
        `UPDATE character_cards SET traits = ?, seed = ?, status = 'generated', image_key = ?, thumb_key = ?,
           composition_hash = ?, rarity_tier = ?, rarity_score = ?, generated_at = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`,
        [
          JSON.stringify(result.traits), currentSeed, imageKey, thumbKey, result.compositionHash,
          result.rarityTier, result.rarityScore, ts, ts, card.id, userId,
        ],
      );
      return {
        card: publicCard(await findCardRow(card.id)),
        render: result,
        imageKey,
        thumbKey,
        seed: currentSeed,
      };
    }
    throw characterError(409, 'COMPOSITION_CONFLICT', '形象组合冲突过多，请更换配件后重试');
  }

  async function insertRun({
    userId, cardId = null, action, status, costMicro = 0, durationMs = 0, error = null,
  }) {
    await db.execute(
      `INSERT INTO character_runs (id, user_id, card_id, action, status, cost_micro, duration_ms, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(), userId, cardId, action, status,
        Math.max(0, Math.round(Number(costMicro) || 0)), Math.max(0, Math.round(Number(durationMs) || 0)),
        error ? String(error).slice(0, 255) : null, timestamp(),
      ],
    );
  }

  return {
    createCard,
    updateCard,
    getCard,
    listCards,
    saveGenerated,
    insertRun,
    assetsDir,
  };
}

module.exports = {
  createCharacterStore,
  characterError,
  publicCard,
  claimComposition,
  DEFAULT_ASSETS_DIR,
  MAX_GENERATE_ATTEMPTS,
};
