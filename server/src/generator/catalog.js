'use strict';

// 千人千面生成器的图层目录：与 KOKO 原型 mock.js 的五层结构一致。
// weight 是基础权重（0-100，无需每层加和为 100），用户可通过 update_weight 覆盖。
// type/shape/to 等字段为绘制参数，draw.js 按图层 id 解释。
const GENERATOR_LAYERS = [
  {
    id: 'background', name: '背景', order: 0,
    traits: [
      { id: 'bg1', name: '深空蓝', weight: 30, color: '#1a1a3e', type: 'gradient', to: '#0d0d20' },
      { id: 'bg2', name: '暗金', weight: 20, color: '#3d2c0e', type: 'gradient', to: '#1a1606' },
      { id: 'bg3', name: '纯黑', weight: 15, color: '#0a0906', type: 'solid' },
      { id: 'bg4', name: '紫雾', weight: 35, color: '#2a1a3e', type: 'gradient', to: '#150d20' },
    ],
  },
  {
    id: 'body', name: '身体', order: 1,
    traits: [
      { id: 'bd1', name: '暖金', weight: 35, color: '#d4a96a' },
      { id: 'bd2', name: '古铜', weight: 25, color: '#8b6914' },
      { id: 'bd3', name: '冷白', weight: 20, color: '#e8dcc8' },
      { id: 'bd4', name: '蓝调', weight: 12, color: '#5a7a9e' },
      { id: 'bd5', name: '翡翠', weight: 8, color: '#4a9b7a' },
    ],
  },
  {
    id: 'eyes', name: '眼睛', order: 2,
    traits: [
      { id: 'ey1', name: '常规', weight: 40, color: '#1a1a1a', shape: 'normal' },
      { id: 'ey2', name: '圆睁', weight: 25, color: '#1a1a1a', shape: 'wide' },
      { id: 'ey3', name: '墨镜', weight: 15, color: '#0a0a0a', shape: 'shades' },
      { id: 'ey4', name: '金瞳', weight: 12, color: '#ffd700', shape: 'normal' },
      { id: 'ey5', name: '红光', weight: 8, color: '#ff3333', shape: 'glow' },
    ],
  },
  {
    id: 'mouth', name: '嘴巴', order: 3,
    traits: [
      { id: 'mo1', name: '微笑', weight: 35, color: '#c0392b', shape: 'smile' },
      { id: 'mo2', name: '严肃', weight: 25, color: '#8b0000', shape: 'flat' },
      { id: 'mo3', name: '咧嘴', weight: 20, color: '#e74c3c', shape: 'grin' },
      { id: 'mo4', name: '小胡子', weight: 12, color: '#3d2b1f', shape: 'mustache' },
      { id: 'mo5', name: '獠牙', weight: 8, color: '#ffffff', shape: 'fangs' },
    ],
  },
  {
    id: 'accessory', name: '配饰', order: 4,
    traits: [
      { id: 'ac1', name: '无', weight: 30, color: 'transparent', shape: 'none' },
      { id: 'ac2', name: '皇冠', weight: 20, color: '#ffd700', shape: 'crown' },
      { id: 'ac3', name: '帽子', weight: 18, color: '#5a3d2a', shape: 'hat' },
      { id: 'ac4', name: '耳机', weight: 15, color: '#333333', shape: 'headphones' },
      { id: 'ac5', name: '光环', weight: 10, color: '#fff9c4', shape: 'halo' },
      { id: 'ac6', name: '角', weight: 7, color: '#8b4513', shape: 'horns' },
    ],
  },
];

function findLayer(layerId) {
  return GENERATOR_LAYERS.find((layer) => layer.id === layerId) || null;
}

function findTrait(layer, traitId) {
  return layer.traits.find((trait) => trait.id === traitId) || null;
}

// 输出给客户端的目录副本：基础权重 ⊕ 用户覆盖，按 order 排序。
function mergedCatalog(overrides = new Map()) {
  return GENERATOR_LAYERS
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((layer) => ({
      id: layer.id,
      name: layer.name,
      order: layer.order,
      traits: layer.traits.map((trait) => {
        const key = `${layer.id}:${trait.id}`;
        const weight = overrides.has(key) ? overrides.get(key) : trait.weight;
        return {
          id: trait.id,
          name: trait.name,
          weight,
          baseWeight: trait.weight,
          overridden: overrides.has(key),
          color: trait.color,
        };
      }),
    }));
}

module.exports = { GENERATOR_LAYERS, findLayer, findTrait, mergedCatalog };
