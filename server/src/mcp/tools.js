'use strict';

const render = require('../character/render');
const parts = require('../character/parts');
const partsStore = require('../character/parts_store');
const { createCharacterStore } = require('../character/store');
const { createBatch } = require('../character/batch');
const { refineCharacter, buildRefinePrompt } = require('../character/refine');

// 对外单次批量上限：运营后台允许 200，MCP 连接器只开放 10，防止一次调用过重。
const MAX_BATCH_COUNT = 10;
const MAX_NAME = 64;

// 参数不合法统一抛 -32602；业务失败交给上层包成 isError 的业务错误。
function paramError(message) {
  const error = new Error(message);
  error.mcpCode = -32602;
  return error;
}

function readString(value, field, { required = false, max = 4000 } = {}) {
  if (value === undefined || value === null) {
    if (required) throw paramError(`缺少参数 ${field}`);
    return undefined;
  }
  if (typeof value !== 'string') throw paramError(`${field} 必须是字符串`);
  const text = value.trim();
  if (required && !text) throw paramError(`缺少参数 ${field}`);
  return text.slice(0, max);
}

function readStyle(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !value.trim()) throw paramError('style 必须是非空字符串');
  return value.trim().slice(0, 24);
}

function readSeed(value) {
  if (value === undefined || value === null) return undefined;
  const seed = Number(value);
  if (!Number.isSafeInteger(seed) || seed < 0) throw paramError('seed 必须是非负整数');
  return seed;
}

// traits 只允许 {slot: partId}，逐个按配件目录校验，未知 slot 忽略。
function readTraits(input) {
  if (input === undefined || input === null) return undefined;
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw paramError('traits 必须是 {slot: partId} 对象');
  }
  const result = {};
  for (const slot of parts.SLOT_ORDER) {
    if (input[slot] === undefined) continue;
    const id = String(input[slot]);
    if (!parts.getTrait(slot, id)) throw paramError(`配件 ${id} 不属于 ${slot}`);
    result[slot] = id;
  }
  return result;
}

function readId(value, field) {
  const id = readString(value, field, { required: true, max: 64 });
  return id;
}

// 与 character/routes.js 一致的图片访问地址。
function assetUrl(key) {
  return key ? `/api/v1/character-assets/${key}` : null;
}

// 局部覆盖时保留卡上已有配件，避免只改一个 slot 把其余选择重掷掉。
function mergeTraits(base, patch) {
  if (patch === undefined) return base && typeof base === 'object' ? base : {};
  return { ...(base && typeof base === 'object' ? base : {}), ...patch };
}

function publicCardWithUrls(card) {
  return {
    ...card,
    imageUrl: assetUrl(card.image_key),
    thumbUrl: assetUrl(card.thumb_key),
  };
}

function createCharacterTools({ db }) {
  const assetsDir = process.env.CHARACTER_ASSETS_DIR || undefined;
  const store = createCharacterStore({ db, assetsDir });

  // 运行记录写失败不影响主体结果，与 character/routes.js 的处理保持一致。
  const safeInsertRun = async (payload) => {
    try {
      await store.insertRun(payload);
    } catch (_) {
      // 运行记录是旁路数据，失败时静默忽略。
    }
  };

  const definitions = [
    {
      name: 'fetch_layers',
      description: '读取形象部件目录：返回各层的可选部件，以及组合空间大小，用于规划角色外观。',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: async () => partsStore.listParts(db),
    },
    {
      name: 'generate_preview',
      description: '免费预览角色外观：按风格、随机种子与配件组合生成缩略图，不保存到账号、不消耗额度。',
      inputSchema: {
        type: 'object',
        properties: {
          style: { type: 'string', description: '形象风格，例如 general、anime，缺省为 general' },
          seed: { type: 'integer', minimum: 0, description: '随机种子，相同种子与风格生成同一外观' },
          traits: {
            type: 'object',
            description: '指定层配件，形如 {hair: "hair_short"}；未指定的层由种子决定',
            additionalProperties: { type: 'string' },
          },
        },
        additionalProperties: false,
      },
      handler: async (args = {}) => {
        const style = readStyle(args.style);
        const seed = readSeed(args.seed);
        const traits = readTraits(args.traits);
        const preview = render.renderPreview({ style, seed, traits: traits || {} });
        return {
          compositionHash: preview.compositionHash,
          rarityScore: preview.rarity.score,
          rarityTier: preview.rarity.tier,
          thumbDataUrl: `data:image/png;base64,${preview.png.toString('base64')}`,
          planted: false,
        };
      },
    },
    {
      name: 'generate_batch',
      description: '批量生成形象缩略图并输出联系表，单次最多 10 个，返回批次摘要与图片地址。',
      inputSchema: {
        type: 'object',
        properties: {
          count: { type: 'integer', minimum: 1, maximum: MAX_BATCH_COUNT, description: '生成数量，1-10' },
          style: { type: 'string', description: '形象风格，缺省为 anime' },
          name: { type: 'string', maxLength: MAX_NAME, description: '批次名称，缺省按风格自动命名' },
        },
        required: ['count'],
        additionalProperties: false,
      },
      handler: async (args = {}, { userId }) => {
        const rawCount = Number(args.count);
        if (!Number.isInteger(rawCount) || rawCount < 1) throw paramError('count 必须是 1-10 的整数');
        if (rawCount > MAX_BATCH_COUNT) throw paramError(`count 超过上限 ${MAX_BATCH_COUNT}`);
        const style = readStyle(args.style);
        const name = readString(args.name, 'name', { max: MAX_NAME });
        const batch = await createBatch(db, {
          count: rawCount,
          style,
          name,
          createdBy: `mcp:${userId}`.slice(0, 40),
        }, { assetsDir });
        return {
          batchId: batch.id,
          name: batch.name,
          count: batch.count,
          items: (batch.items || []).filter((item) => item.compositionHash).map((item) => ({
            index: item.index,
            compositionHash: item.compositionHash,
            rarityTier: item.rarityTier,
            imageUrl: assetUrl(item.imageKey),
            thumbUrl: assetUrl(item.thumbKey),
          })),
          sheetUrl: assetUrl(batch.sheetKey),
        };
      },
    },
    {
      name: 'create_character',
      description: '创建角色卡草稿，填写名字、风格与性格设定，返回角色卡；source 仅支持 text 文本描述。',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', maxLength: MAX_NAME, description: '角色名，1-64 字' },
          source: { type: 'string', enum: ['text'], description: '形象来源，当前仅支持 text' },
          style: { type: 'string', description: '形象风格，缺省为 general' },
          prompt: { type: 'string', maxLength: 4000, description: '角色外观描述' },
          persona: { type: 'string', maxLength: 1000, description: '人格设定' },
          fear: { type: 'string', maxLength: 1000, description: '害怕的事物' },
          habit: { type: 'string', maxLength: 1000, description: '日常习惯' },
        },
        required: ['name'],
        additionalProperties: false,
      },
      handler: async (args = {}, { userId }) => {
        if (args.source !== undefined && args.source !== 'text') {
          throw paramError('source 仅支持 text');
        }
        const name = readString(args.name, 'name', { required: true, max: MAX_NAME });
        const card = await store.createCard(userId, {
          name,
          source: 'text',
          style: readStyle(args.style),
          prompt: readString(args.prompt, 'prompt', { max: 4000 }),
          persona: readString(args.persona, 'persona', { max: 1000 }),
          fear: readString(args.fear, 'fear', { max: 1000 }),
          habit: readString(args.habit, 'habit', { max: 1000 }),
        });
        return publicCardWithUrls(card);
      },
    },
    {
      name: 'generate_character',
      description: '为角色卡生成正式形象与缩略图；refine 可选，使用你自己的 API Key 与钱包额度做精修。',
      inputSchema: {
        type: 'object',
        properties: {
          characterId: { type: 'string', description: '角色卡 ID' },
          traits: {
            type: 'object',
            description: '覆盖指定层配件，未指定的层保留卡片原值',
            additionalProperties: { type: 'string' },
          },
          seed: { type: 'integer', minimum: 0, description: '随机种子，缺省沿用角色卡种子' },
          refine: { type: 'boolean', description: '是否做可选精修，默认关闭' },
        },
        required: ['characterId'],
        additionalProperties: false,
      },
      handler: async (args = {}, { userId }) => {
        const characterId = readId(args.characterId, 'characterId');
        if (args.refine !== undefined && typeof args.refine !== 'boolean') {
          throw paramError('refine 必须是布尔值');
        }
        const traits = readTraits(args.traits);
        const seed = readSeed(args.seed);
        const startedAt = Date.now();
        let result;
        try {
          // 以卡片已有配件为底，只覆盖调用方显式指定的层。
          const existing = await store.getCard(userId, characterId);
          result = await store.saveGenerated(userId, characterId, {
            traits: mergeTraits(existing.traits, traits),
            seed,
          });
        } catch (error) {
          await safeInsertRun({
            userId, cardId: characterId, action: 'generate', status: 'failed',
            durationMs: Date.now() - startedAt, error: error.message,
          });
          throw error;
        }

        let refine = { skipped: true, reason: 'not_requested' };
        if (args.refine === true) {
          const refineStarted = Date.now();
          refine = await refineCharacter({
            db,
            userId,
            png: result.render.png,
            prompt: buildRefinePrompt(result.card, result.render.traits),
          });
          await safeInsertRun({
            userId, cardId: result.card.id, action: 'refine',
            status: refine.skipped ? 'skipped' : 'success',
            costMicro: refine.costMicro || 0,
            durationMs: Date.now() - refineStarted,
            error: refine.skipped ? refine.reason : null,
          });
        }

        await safeInsertRun({
          userId, cardId: result.card.id, action: 'generate', status: 'success',
          costMicro: 0, durationMs: Date.now() - startedAt,
        });

        return {
          card: result.card,
          imageUrl: assetUrl(result.card.image_key),
          thumbUrl: assetUrl(result.card.thumb_key),
          refine,
        };
      },
    },
    {
      name: 'get_character',
      description: '按角色卡 ID 查询角色详情与形象图片地址。',
      inputSchema: {
        type: 'object',
        properties: { characterId: { type: 'string', description: '角色卡 ID' } },
        required: ['characterId'],
        additionalProperties: false,
      },
      handler: async (args = {}, { userId }) => {
        const card = await store.getCard(userId, readId(args.characterId, 'characterId'));
        return publicCardWithUrls(card);
      },
    },
    {
      name: 'list_my_characters',
      description: '列出当前 API Key 所属账号下的全部角色卡。',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: async (_args, { userId }) => {
        const cards = await store.listCards(userId);
        return { characters: cards.map(publicCardWithUrls) };
      },
    },
  ];

  function list() {
    return definitions.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
  }

  function get(name) {
    return definitions.find((tool) => tool.name === name) || null;
  }

  return { list, get, MAX_BATCH_COUNT };
}

module.exports = { createCharacterTools, paramError, MAX_BATCH_COUNT };
