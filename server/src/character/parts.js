'use strict';

const { createRng } = require('./rng');

// 固定层序：背景 → 身体 → 下装 → 上装 → 外套 → 鞋 → 头发 → 配饰 → 表情。
const SLOT_ORDER = [
  'background', 'body', 'bottom', 'outfit', 'outer', 'shoes', 'hair', 'accessory', 'expression',
];

// 只有这些 slot 参与稀有度计算（鞋与表情不影响稀有度）。
const RARITY_SLOTS = new Set(['background', 'body', 'bottom', 'outfit', 'outer', 'hair', 'accessory']);
const RARITY_POINTS = { common: 1, rare: 3, epic: 6, legendary: 10 };

// 配件全部由几何 + 颜色参数绘制，不使用 emoji 或位图素材。
const CATALOG = {
  background: [
    { id: 'bg_aurora', name: '极光', weight: 30, rarity: 'common', draw: { kind: 'bg', from: '#0b1e3a', to: '#1f4d7a', pattern: 'rays' } },
    { id: 'bg_sunset', name: '暮色', weight: 28, rarity: 'common', draw: { kind: 'bg', from: '#2a1036', to: '#7a2b4d', pattern: 'orbs' } },
    { id: 'bg_mint', name: '薄荷', weight: 20, rarity: 'rare', draw: { kind: 'bg', from: '#0d3b34', to: '#2f8f78', pattern: 'grid' } },
    { id: 'bg_starfield', name: '星野', weight: 14, rarity: 'rare', draw: { kind: 'bg', from: '#060b22', to: '#1b2a5a', pattern: 'stars' } },
    { id: 'bg_ember', name: '余烬', weight: 5, rarity: 'epic', draw: { kind: 'bg', from: '#1a0b06', to: '#a83a1c', pattern: 'rays' } },
    { id: 'bg_void', name: '虚空', weight: 2, rarity: 'legendary', draw: { kind: 'bg', from: '#050509', to: '#241f45', pattern: 'stars' } },
  ],
  body: [
    { id: 'body_light', name: '浅肤', weight: 40, rarity: 'common', draw: { kind: 'body', skin: '#f3c8a0', shade: '#d99f78', build: 'slim' } },
    { id: 'body_medium', name: '小麦', weight: 32, rarity: 'common', draw: { kind: 'body', skin: '#e2ae82', shade: '#bd845c', build: 'normal' } },
    { id: 'body_deep', name: '深棕', weight: 18, rarity: 'rare', draw: { kind: 'body', skin: '#8d5a3b', shade: '#6b4029', build: 'broad' } },
    { id: 'body_olive', name: '橄榄', weight: 8, rarity: 'rare', draw: { kind: 'body', skin: '#c9a36f', shade: '#a47f51', build: 'normal' } },
    { id: 'body_metal', name: '合金', weight: 2, rarity: 'epic', draw: { kind: 'body', skin: '#a9bacb', shade: '#74879b', build: 'broad' } },
  ],
  bottom: [
    { id: 'btm_denim', name: '牛仔长裤', weight: 34, rarity: 'common', draw: { kind: 'bottom', color: '#2f4a72', type: 'pants' } },
    { id: 'btm_cargo', name: '工装裤', weight: 26, rarity: 'common', draw: { kind: 'bottom', color: '#4a4432', type: 'pants' } },
    { id: 'btm_skirt', name: '褶皱裙', weight: 20, rarity: 'rare', draw: { kind: 'bottom', color: '#6a2e4a', type: 'skirt' } },
    { id: 'btm_shorts', name: '短裤', weight: 14, rarity: 'common', draw: { kind: 'bottom', color: '#333a44', type: 'shorts' } },
    { id: 'btm_leather', name: '皮裤', weight: 4, rarity: 'epic', draw: { kind: 'bottom', color: '#1c1a1e', type: 'pants' } },
  ],
  outfit: [
    { id: 'out_tee', name: '素色 T 恤', weight: 32, rarity: 'common', draw: { kind: 'outfit', colors: ['#e8e2d2', '#c9bfa4'], emblem: 'circle' } },
    { id: 'out_hoodie', name: '连帽衫', weight: 26, rarity: 'common', draw: { kind: 'outfit', colors: ['#3a4a5c', '#222c38'], emblem: 'stripe' } },
    { id: 'out_shirt', name: '衬衫', weight: 22, rarity: 'common', draw: { kind: 'outfit', colors: ['#cdd7e2', '#8b9bb0'], emblem: 'bolt' } },
    { id: 'out_suit', name: '西装', weight: 12, rarity: 'rare', draw: { kind: 'outfit', colors: ['#2a2f3a', '#171a20'], emblem: 'dot' } },
    { id: 'out_jersey', name: '球衣', weight: 5, rarity: 'epic', draw: { kind: 'outfit', colors: ['#b23a2e', '#7a1f18'], emblem: 'number' } },
    { id: 'out_armor', name: '护甲', weight: 2, rarity: 'legendary', draw: { kind: 'outfit', colors: ['#6b7686', '#3e4753'], emblem: 'crest' } },
  ],
  outer: [
    { id: 'outer_none', name: '无外套', weight: 30, rarity: 'common', draw: { kind: 'outer', type: 'none' } },
    { id: 'outer_jacket', name: '短夹克', weight: 28, rarity: 'common', draw: { kind: 'outer', type: 'jacket', color: '#3b2f2a' } },
    { id: 'outer_coat', name: '长风衣', weight: 18, rarity: 'rare', draw: { kind: 'outer', type: 'coat', color: '#22262e' } },
    { id: 'outer_poncho', name: '披肩', weight: 8, rarity: 'rare', draw: { kind: 'outer', type: 'cape', color: '#7a5a2a' } },
    { id: 'outer_cape', name: '斗篷', weight: 3, rarity: 'epic', draw: { kind: 'outer', type: 'cape', color: '#5a1f35' } },
  ],
  shoes: [
    { id: 'shoes_sneaker', name: '球鞋', weight: 34, rarity: 'common', draw: { kind: 'shoes', color: '#e2e2e2', height: 'low' } },
    { id: 'shoes_boot', name: '短靴', weight: 26, rarity: 'common', draw: { kind: 'shoes', color: '#1e1c20', height: 'high' } },
    { id: 'shoes_loafer', name: '皮鞋', weight: 20, rarity: 'rare', draw: { kind: 'shoes', color: '#4a2c22', height: 'low' } },
    { id: 'shoes_glow', name: '光履', weight: 4, rarity: 'epic', draw: { kind: 'shoes', color: '#3aa6c9', height: 'high', glow: true } },
  ],
  hair: [
    { id: 'hair_short', name: '短发', weight: 32, rarity: 'common', draw: { kind: 'hair', color: '#2b1d15', shade: '#1a1109', style: 'short' } },
    { id: 'hair_bob', name: '波波头', weight: 24, rarity: 'common', draw: { kind: 'hair', color: '#4a2a1a', shade: '#2f180d', style: 'bob' } },
    { id: 'hair_long', name: '长发', weight: 20, rarity: 'rare', draw: { kind: 'hair', color: '#7a4a24', shade: '#4d2b12', style: 'long' } },
    { id: 'hair_bun', name: '丸子头', weight: 12, rarity: 'rare', draw: { kind: 'hair', color: '#3a2a22', shade: '#241710', style: 'bun' } },
    { id: 'hair_spiky', name: '刺猬头', weight: 5, rarity: 'epic', draw: { kind: 'hair', color: '#c9a227', shade: '#8f7015', style: 'spiky' } },
    { id: 'hair_neon', name: '霓虹长发', weight: 2, rarity: 'legendary', draw: { kind: 'hair', color: '#39c7b0', shade: '#1c6e63', style: 'long' } },
  ],
  accessory: [
    { id: 'acc_none', name: '无配饰', weight: 26, rarity: 'common', draw: { kind: 'accessory', type: 'none' } },
    { id: 'acc_glasses', name: '方框眼镜', weight: 22, rarity: 'common', draw: { kind: 'accessory', type: 'glasses', color: '#1d1a18' } },
    { id: 'acc_scarf', name: '围巾', weight: 18, rarity: 'common', draw: { kind: 'accessory', type: 'scarf', color: '#8c2f39' } },
    { id: 'acc_headphones', name: '耳机', weight: 14, rarity: 'rare', draw: { kind: 'accessory', type: 'headphones', color: '#2c3440' } },
    { id: 'acc_visor', name: '护目镜', weight: 6, rarity: 'epic', draw: { kind: 'accessory', type: 'visor', color: '#4fd1c5' } },
    { id: 'acc_halo', name: '光环', weight: 2, rarity: 'legendary', draw: { kind: 'accessory', type: 'halo', color: '#f5d76e' } },
  ],
  expression: [
    { id: 'exp_calm', name: '平静', weight: 34, rarity: 'common', draw: { kind: 'expression', type: 'calm', ink: '#1b1410' } },
    { id: 'exp_smile', name: '微笑', weight: 28, rarity: 'common', draw: { kind: 'expression', type: 'smile', ink: '#1b1410' } },
    { id: 'exp_stern', name: '严肃', weight: 18, rarity: 'common', draw: { kind: 'expression', type: 'stern', ink: '#1b1410' } },
    { id: 'exp_wink', name: '眨眼', weight: 12, rarity: 'rare', draw: { kind: 'expression', type: 'wink', ink: '#1b1410' } },
    { id: 'exp_surprised', name: '惊讶', weight: 8, rarity: 'rare', draw: { kind: 'expression', type: 'surprised', ink: '#1b1410' } },
  ],
};

const TRAIT_INDEX = Object.fromEntries(SLOT_ORDER.map((slot) => [
  slot,
  new Map(CATALOG[slot].map((trait) => [trait.id, trait])),
]));

// 运营覆盖后的目录是普通对象，按引用缓存索引，避免每次抽卡都重建 Map。
const CATALOG_INDEX_CACHE = new WeakMap();

function indexFor(catalog) {
  if (catalog === CATALOG) return TRAIT_INDEX;
  let cached = CATALOG_INDEX_CACHE.get(catalog);
  if (!cached) {
    cached = Object.fromEntries(SLOT_ORDER.map((slot) => [
      slot,
      new Map((catalog[slot] || []).map((trait) => [trait.id, trait])),
    ]));
    CATALOG_INDEX_CACHE.set(catalog, cached);
  }
  return cached;
}

function listSlots() {
  return SLOT_ORDER.slice();
}

function getCatalog() {
  return CATALOG;
}

function getTrait(slot, id, catalog = CATALOG) {
  return indexFor(catalog)[slot]?.get(id) || null;
}

function normalizeOverrides(overrides, catalog = CATALOG) {
  if (!overrides || typeof overrides !== 'object') return {};
  const index = indexFor(catalog);
  const result = {};
  for (const slot of SLOT_ORDER) {
    const value = overrides[slot];
    if (value && index[slot].has(String(value))) result[slot] = String(value);
  }
  return result;
}

// 同 seed + style 必定挑出同一组配件；overrides 只覆盖指定 slot，不影响其他 slot 的随机序列。
// catalog 可传入运营覆盖后的目录，缺省仍使用内置 CATALOG。
function pickTraits(seed, style, overrides = {}, catalog = CATALOG) {
  const fixed = normalizeOverrides(overrides, catalog);
  const rng = createRng(`character-pick:${style || 'general'}:${String(seed)}`);
  const result = {};
  for (const slot of SLOT_ORDER) {
    const traits = catalog[slot] && catalog[slot].length ? catalog[slot] : CATALOG[slot];
    const totalWeight = traits.reduce((sum, trait) => sum + Math.max(1, trait.weight), 0);
    // 每个 slot 都消费一次随机数，保证覆盖某个 slot 时不改动其他 slot 的结果。
    const roll = rng.next() * totalWeight;
    let chosen = traits[traits.length - 1];
    let cursor = 0;
    for (const trait of traits) {
      cursor += Math.max(1, trait.weight);
      if (roll < cursor) {
        chosen = trait;
        break;
      }
    }
    result[slot] = fixed[slot] || chosen.id;
  }
  return result;
}

function computeRarity(traits, catalog = CATALOG) {
  const normalized = normalizeOverrides(traits, catalog);
  let score = 0;
  for (const slot of RARITY_SLOTS) {
    const trait = getTrait(slot, normalized[slot], catalog);
    if (!trait) continue;
    score += RARITY_POINTS[trait.rarity] || 1;
  }
  let tier = 'common';
  if (score >= 26) tier = 'legendary';
  else if (score >= 16) tier = 'epic';
  else if (score >= 9) tier = 'rare';
  return { score, tier };
}

// 组合空间按启用配件计算；默认目录等价于 P0 的内置空间。
function comboSpace(catalog = CATALOG) {
  return SLOT_ORDER.reduce((total, slot) => {
    const traits = catalog[slot] && catalog[slot].length ? catalog[slot] : CATALOG[slot];
    return total * traits.length;
  }, 1);
}

module.exports = {
  SLOT_ORDER,
  RARITY_SLOTS,
  RARITY_POINTS,
  listSlots,
  getCatalog,
  getTrait,
  pickTraits,
  computeRarity,
  comboSpace,
};
