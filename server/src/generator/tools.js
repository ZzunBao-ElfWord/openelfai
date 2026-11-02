'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const { createRng } = require('../character/rng');
const { GENERATOR_LAYERS, findLayer, findTrait, mergedCatalog } = require('./catalog');
const { renderPng, weightedPick, calcRarity } = require('./draw');
const { buildZip } = require('./zip');
const store = require('./store');

/// 千人千面生成器连接器：图层目录、权重调整、预览与批量生成、打包下载、作品收单。
/// 渲染走自研 PNG 画布（character/png.js），无任何外部依赖。

const MAX_BATCH_COUNT = 100;
const MAX_DOWNLOAD_IDS = 100;
const MAX_PAYLOAD_BYTES = 16 * 1024;
const PREVIEW_SIZE = 350;
const IMAGE_SIZE = 512;
const THUMB_SIZE = 128;

function paramError(message) {
  const error = new Error(message);
  error.mcpCode = -32602;
  return error;
}

function businessError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function readString(value, field, { required = false, max = 400 } = {}) {
  if (value === undefined || value === null) {
    if (required) throw paramError(`缺少参数 ${field}`);
    return undefined;
  }
  if (typeof value !== 'string') throw paramError(`${field} 必须是字符串`);
  const text = value.trim();
  if (required && !text) throw paramError(`缺少参数 ${field}`);
  return text.slice(0, max);
}

function readInt(value, field, { required = false, min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null) {
    if (required) throw paramError(`缺少参数 ${field}`);
    return undefined;
  }
  const num = Number(value);
  if (!Number.isSafeInteger(num) || num < min || num > max) {
    throw paramError(`${field} 必须是 ${min}-${max} 的整数`);
  }
  return num;
}

function assetUrl(file) {
  return `/api/v1/world-assets/${file}`;
}

// 基础权重 ⊕ 用户覆盖后的完整图层（保留绘制参数，供渲染使用）。
function effectiveLayers(overrides) {
  return GENERATOR_LAYERS.map((layer) => ({
    ...layer,
    traits: layer.traits.map((trait) => {
      const key = `${layer.id}:${trait.id}`;
      return overrides.has(key) ? { ...trait, weight: overrides.get(key) } : trait;
    }),
  }));
}

function pickCombination(layers, rng) {
  return layers.map((layer) => {
    const trait = weightedPick(layer.traits, rng.next());
    return { layerId: layer.id, layer, traitId: trait.id, trait };
  });
}

// 组合的可序列化摘要：落库与回传给客户端都用这份。
function comboSummary(selection) {
  return selection.map((part) => ({
    layerId: part.layerId,
    layer: part.layer.name,
    traitId: part.traitId,
    trait: part.trait.name,
    color: part.trait.color,
    weight: part.trait.weight,
  }));
}

function itemPayload(item) {
  return {
    id: item.id,
    batchId: item.batchId,
    idx: item.idx,
    seed: item.seed,
    traits: item.traits,
    rarity: item.rarity,
    imageUrl: item.imageKey ? assetUrl(item.imageKey) : null,
    thumbUrl: item.thumbKey ? assetUrl(item.thumbKey) : null,
  };
}

function createGeneratorTools({ db, mediaDir, logger } = {}) {
  if (!db || !mediaDir) throw new Error('生成器工具缺少 db / mediaDir');

  async function ensureDirs() {
    await fs.mkdir(mediaDir, { recursive: true });
  }

  const definitions = [
    {
      name: 'fetch_layers',
      description: '获取图层与配件目录（含当前账号生效的稀有度权重），生成前先读取。',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: async (_args, { userId }) => {
        const overrides = await store.listWeightOverrides(db, userId);
        return { layers: mergedCatalog(overrides) };
      },
    },
    {
      name: 'update_weight',
      description: '调整某图层某配件的稀有度权重（0-100，仅影响当前账号后续生成）。',
      inputSchema: {
        type: 'object',
        properties: {
          layerId: { type: 'string', description: '图层 ID，如 background / body / eyes / mouth / accessory' },
          traitId: { type: 'string', description: '配件 ID，通过 fetch_layers 获取' },
          weight: { type: 'integer', minimum: 0, maximum: 100, description: '权重，0 表示不再出现' },
        },
        required: ['layerId', 'traitId', 'weight'],
        additionalProperties: false,
      },
      handler: async (args = {}, { userId }) => {
        const layerId = readString(args.layerId, 'layerId', { required: true, max: 24 });
        const traitId = readString(args.traitId, 'traitId', { required: true, max: 24 });
        const weight = readInt(args.weight, 'weight', { required: true, min: 0, max: 100 });
        const layer = findLayer(layerId);
        if (!layer) throw paramError(`未知图层：${layerId}`);
        if (!findTrait(layer, traitId)) throw paramError(`图层 ${layerId} 下没有配件 ${traitId}`);
        await store.upsertWeight(db, userId, layerId, traitId, weight);
        return { ok: true, layerId, traitId, weight };
      },
    },
    {
      name: 'generate_preview',
      description: '按当前权重随机生成一张预览图（data URL），可传 seed 复现同一组合。',
      inputSchema: {
        type: 'object',
        properties: {
          seed: { type: 'string', description: '可选随机种子；传入相同 seed 得到相同组合' },
        },
        additionalProperties: false,
      },
      handler: async (args = {}, { userId }) => {
        const seed = readString(args.seed, 'seed', { max: 128 })
          || crypto.randomBytes(8).toString('hex');
        const overrides = await store.listWeightOverrides(db, userId);
        const selection = pickCombination(effectiveLayers(overrides), createRng(seed));
        const png = renderPng(selection, PREVIEW_SIZE, 2);
        return {
          seed,
          combo: comboSummary(selection),
          rarity: calcRarity(selection),
          imageDataUrl: `data:image/png;base64,${png.toString('base64')}`,
        };
      },
    },
    {
      name: 'generate_batch',
      description: '批量生成一组形象作品（单次最多 100 个），返回每件的图片地址与稀有度。',
      inputSchema: {
        type: 'object',
        properties: {
          count: { type: 'integer', minimum: 1, maximum: MAX_BATCH_COUNT, description: '生成数量，1-100' },
        },
        required: ['count'],
        additionalProperties: false,
      },
      handler: async (args = {}, { userId }) => {
        const count = readInt(args.count, 'count', { required: true, min: 1, max: MAX_BATCH_COUNT });
        await ensureDirs();
        const overrides = await store.listWeightOverrides(db, userId);
        const layers = effectiveLayers(overrides);
        const batchId = crypto.randomUUID();
        const batchHex = batchId.replaceAll('-', '');
        const items = [];
        for (let idx = 0; idx < count; idx += 1) {
          const seed = `${batchId}:${idx}`;
          const selection = pickCombination(layers, createRng(seed));
          const rarity = calcRarity(selection);
          const imageKey = `gen-${batchHex}-${idx}.png`;
          const thumbKey = `gen-${batchHex}-${idx}-t.png`;
          await fs.writeFile(path.join(mediaDir, imageKey), renderPng(selection, IMAGE_SIZE, 2));
          await fs.writeFile(path.join(mediaDir, thumbKey), renderPng(selection, THUMB_SIZE, 1));
          const record = {
            id: crypto.randomUUID(),
            userId,
            batchId,
            idx,
            seed,
            traits: comboSummary(selection),
            rarityScore: rarity.score,
            rarityTier: rarity.tier,
            imageKey,
            thumbKey,
            createdAt: Date.now(),
          };
          await store.insertItem(db, record);
          items.push(itemPayload({ ...record, rarity: { score: record.rarityScore, tier: record.rarityTier } }));
        }
        return { batchId, count: items.length, items };
      },
    },
    {
      name: 'download_item',
      description: '获取单个已生成作品的图片与元数据下载地址。',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '作品 ID，来自 generate_batch 返回结果' },
        },
        required: ['id'],
        additionalProperties: false,
      },
      handler: async (args = {}, { userId }) => {
        const id = readString(args.id, 'id', { required: true, max: 40 });
        const item = await store.getItem(db, userId, id);
        if (!item) throw businessError('ITEM_NOT_FOUND', '作品不存在或不属于当前账号');
        return itemPayload(item);
      },
    },
    {
      name: 'download_batch',
      description: '把多个已生成作品打成 zip 包（含图片与元数据），返回下载地址。',
      inputSchema: {
        type: 'object',
        properties: {
          ids: {
            type: 'array',
            items: { type: 'string' },
            description: `作品 ID 列表，单次最多 ${MAX_DOWNLOAD_IDS} 个`,
          },
        },
        required: ['ids'],
        additionalProperties: false,
      },
      handler: async (args = {}, { userId }) => {
        if (!Array.isArray(args.ids) || args.ids.length === 0) {
          throw paramError('ids 必须是非空数组');
        }
        if (args.ids.length > MAX_DOWNLOAD_IDS) throw paramError(`ids 超过上限 ${MAX_DOWNLOAD_IDS}`);
        const ids = args.ids.map((id) => readString(id, 'ids', { required: true, max: 40 }));
        const items = await store.listItems(db, userId, ids);
        if (items.length !== ids.length) {
          throw businessError('ITEM_NOT_FOUND', '部分作品不存在或不属于当前账号');
        }
        await ensureDirs();
        const entries = [];
        for (const item of items) {
          const base = `gen-${String(item.idx).padStart(3, '0')}-${item.id.slice(0, 8)}`;
          const image = await fs.readFile(path.join(mediaDir, item.imageKey));
          entries.push({ name: `${base}.png`, data: image });
          entries.push({
            name: `${base}.json`,
            data: Buffer.from(JSON.stringify({
              id: item.id,
              batchId: item.batchId,
              idx: item.idx,
              seed: item.seed,
              traits: item.traits,
              rarity: item.rarity,
              createdAt: new Date(item.createdAt).toISOString(),
            }, null, 2)),
          });
        }
        const zipName = `gen-${crypto.randomUUID().replaceAll('-', '')}.zip`;
        await fs.writeFile(path.join(mediaDir, zipName), buildZip(entries));
        return { count: items.length, zipUrl: assetUrl(zipName) };
      },
    },
    {
      name: 'submit_work_submission',
      description: '提交作品信息收单到平台后台（统一标准 schema），返回收单编号。',
      inputSchema: {
        type: 'object',
        properties: {
          payload: { type: 'object', description: '作品信息收单载荷（统一标准 schema）' },
        },
        required: ['payload'],
        additionalProperties: false,
      },
      handler: async (args = {}, { userId }) => {
        const payload = args.payload;
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
          throw paramError('payload 必须是对象');
        }
        const text = JSON.stringify(payload);
        if (Buffer.byteLength(text, 'utf8') > MAX_PAYLOAD_BYTES) {
          throw paramError(`payload 超过 ${MAX_PAYLOAD_BYTES / 1024}KB 上限`);
        }
        const record = {
          id: crypto.randomUUID(),
          userId,
          payload,
          createdAt: Date.now(),
        };
        await store.insertSubmission(db, record);
        logger?.info?.({ submissionId: record.id, userId }, 'generator submission received');
        return {
          submissionId: record.id,
          received: true,
          createdAt: new Date(record.createdAt).toISOString(),
        };
      },
    },
  ];

  function list() {
    return definitions.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
  }

  function get(name) {
    return definitions.find((tool) => tool.name === name) || null;
  }

  return { list, get, MAX_BATCH_COUNT, MAX_DOWNLOAD_IDS };
}

module.exports = { createGeneratorTools };
