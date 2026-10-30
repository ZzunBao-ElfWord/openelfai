'use strict';

const { createCanvas, parseColor } = require('./png');
const { sha256Hex, createRng } = require('./rng');
const parts = require('./parts');

const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 1536;
const THUMB_WIDTH = 256;
const THUMB_HEIGHT = 384;

function normalizeTraits(raw, catalog) {
  if (!raw) return {};
  let traits = raw;
  if (typeof traits === 'string') {
    try {
      traits = JSON.parse(traits);
    } catch (_) {
      return {};
    }
  }
  if (typeof traits !== 'object') return {};
  const result = {};
  for (const slot of parts.SLOT_ORDER) {
    const value = traits[slot];
    if (value && parts.getTrait(slot, String(value), catalog)) result[slot] = String(value);
  }
  return result;
}

function normalizeSeed(seed) {
  const number = Number(seed);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

// 配件是生成输入：缺失的 slot 按 seed/style 补齐，已选中的 slot 原样保留。
function resolveTraits(card, catalog) {
  const traits = normalizeTraits(card?.traits, catalog);
  const seed = normalizeSeed(card?.seed);
  const style = String(card?.style || 'general');
  return parts.pickTraits(seed, style, traits, catalog);
}

// compositionHash = sha256({style, 按 slot 顺序的 traits, seed})。
function compositionHash({ traits, seed, style }) {
  const ordered = {};
  for (const slot of parts.SLOT_ORDER) {
    if (traits[slot]) ordered[slot] = traits[slot];
  }
  const payload = {
    style: String(style || 'general'),
    traits: ordered,
    seed: normalizeSeed(seed),
  };
  return sha256Hex(JSON.stringify(payload));
}

function mixColor(a, b, t) {
  const left = parseColor(a);
  const right = parseColor(b);
  const ratio = Math.max(0, Math.min(1, t));
  return [
    Math.round(left[0] + (right[0] - left[0]) * ratio),
    Math.round(left[1] + (right[1] - left[1]) * ratio),
    Math.round(left[2] + (right[2] - left[2]) * ratio),
    Math.round(left[3] + (right[3] - left[3]) * ratio),
  ];
}

function darken(color, amount = 0.3) {
  return mixColor(color, [0, 0, 0, 255], amount);
}

function lighten(color, amount = 0.3) {
  return mixColor(color, [255, 255, 255, 255], amount);
}

function withAlpha(color, alpha) {
  const rgba = parseColor(color);
  return [rgba[0], rgba[1], rgba[2], alpha];
}

// —— 各图层绘制：全部是几何图形 + 颜色参数，保证风格统一且可确定性复现 ——

function drawBackground(canvas, draw, W, H, rng) {
  canvas.fillLinearGradient(0, 0, W, H, draw.from, draw.to);
  const ink = 'rgba(255,255,255,0.14)';
  const soft = 'rgba(255,255,255,0.07)';
  const pattern = draw.pattern || 'stars';
  if (pattern === 'stars') {
    for (let i = 0; i < 46; i += 1) {
      const x = rng.next() * W;
      const y = rng.next() * H;
      const radius = W * (0.0018 + rng.next() * 0.0045);
      canvas.fillEllipse(x, y, radius, radius, i % 4 === 0 ? ink : soft);
    }
  } else if (pattern === 'grid') {
    const line = W * 0.0026;
    const columns = 9;
    const rows = 13;
    for (let i = 1; i < columns; i += 1) canvas.fillRect((W * i) / columns, 0, line, H, soft);
    for (let i = 1; i < rows; i += 1) canvas.fillRect(0, (H * i) / rows, W, line, soft);
  } else if (pattern === 'orbs') {
    for (let i = 0; i < 5; i += 1) {
      const x = rng.next() * W;
      const y = H * (0.15 + rng.next() * 0.65);
      const radius = W * (0.10 + rng.next() * 0.16);
      canvas.fillEllipse(x, y, radius, radius * 0.62, soft);
    }
    canvas.fillEllipse(W * 0.5, H * 0.30, W * 0.24, W * 0.16, 'rgba(255,255,255,0.10)');
  } else if (pattern === 'rays') {
    const ray = 'rgba(255,255,255,0.06)';
    canvas.fillPolygon([[W * 0.5, H * 0.42], [0, 0], [W * 0.22, 0], [W * 0.5, H * 0.42]], ray);
    canvas.fillPolygon([[W * 0.5, H * 0.42], [W, 0], [W * 0.78, 0], [W * 0.5, H * 0.42]], ray);
    canvas.fillPolygon([[W * 0.5, H * 0.62], [0, H], [W * 0.16, H], [W * 0.5, H * 0.62]], ray);
    canvas.fillPolygon([[W * 0.5, H * 0.62], [W, H], [W * 0.84, H], [W * 0.5, H * 0.62]], ray);
  } else if (pattern === 'waves') {
    for (let i = 0; i < 4; i += 1) {
      const y = H * (0.66 + i * 0.09);
      canvas.fillEllipse(W * 0.5, y, W * 0.62, H * 0.045, soft);
    }
  }
  // 底部暗角，让角色与背景分离。
  canvas.fillLinearGradient(0, H * 0.82, W, H * 0.18, 'rgba(0,0,0,0)', 'rgba(0,0,0,0.35)');
}

function buildGeometry(W, H, bodyDraw, rng) {
  const build = ['slim', 'normal', 'broad'].includes(bodyDraw.build) ? bodyDraw.build : 'normal';
  const shoulderHalf = W * { slim: 0.132, normal: 0.152, broad: 0.176 }[build];
  const waistHalf = W * { slim: 0.098, normal: 0.112, broad: 0.128 }[build];
  const hipHalf = waistHalf * 1.08;
  return {
    cx: W * 0.5 + rng.float(-0.008, 0.008) * W,
    headCy: H * 0.172 + rng.float(-0.004, 0.004) * H,
    headRx: W * 0.086,
    headRy: W * 0.104,
    shoulderHalf,
    waistHalf,
    hipHalf,
    shoulderY: H * 0.315,
    waistY: H * 0.60,
    hipY: H * 0.635,
    footY: H * 0.905,
    build,
  };
}

function drawBody(canvas, draw, W, H, g) {
  const skin = draw.skin || '#e2ae82';
  const shade = draw.shade || darken(skin, 0.2);
  const cx = g.cx;
  const neckTop = g.headCy + g.headRy * 0.78;
  const neckHeight = g.shoulderY + H * 0.012 - neckTop;
  // 手臂先画，躯干覆盖肩部，避免穿模。
  for (const side of [-1, 1]) {
    const topX = cx + side * (g.shoulderHalf - W * 0.016);
    const topY = g.shoulderY + H * 0.008;
    const bottomX = cx + side * (g.waistHalf + W * 0.052);
    const bottomY = g.waistY + H * 0.035;
    const halfWidth = W * 0.024;
    canvas.fillPolygon([
      [topX - halfWidth, topY],
      [topX + halfWidth, topY],
      [bottomX + halfWidth * 0.86, bottomY],
      [bottomX - halfWidth * 0.86, bottomY],
    ], skin);
    canvas.fillEllipse(bottomX, bottomY + W * 0.014, W * 0.028, W * 0.034, shade);
  }
  // 双腿。
  for (const side of [-1, 1]) {
    const outerTop = cx + side * g.hipHalf;
    const innerTop = cx + side * W * 0.012;
    const outerBottom = cx + side * W * 0.082;
    const innerBottom = cx + side * W * 0.022;
    canvas.fillPolygon([
      [outerTop, g.hipY - W * 0.03],
      [innerTop, g.hipY - W * 0.03],
      [innerBottom, g.footY - W * 0.012],
      [outerBottom, g.footY - W * 0.012],
    ], skin);
    canvas.fillEllipse(cx + side * W * 0.052, g.footY - W * 0.006, W * 0.048, W * 0.02, shade);
  }
  canvas.fillEllipse(cx, g.hipY - W * 0.02, g.hipHalf, W * 0.07, skin);
  // 躯干（上宽下窄的梯形）。
  canvas.fillPolygon([
    [cx - g.shoulderHalf, g.shoulderY],
    [cx + g.shoulderHalf, g.shoulderY],
    [cx + g.waistHalf, g.waistY],
    [cx - g.waistHalf, g.waistY],
  ], skin);
  canvas.fillEllipse(cx - g.shoulderHalf, g.shoulderY, W * 0.028, W * 0.03, skin);
  canvas.fillEllipse(cx + g.shoulderHalf, g.shoulderY, W * 0.028, W * 0.03, skin);
  // 脖子与头。
  canvas.fillRect(cx - W * 0.026, neckTop - W * 0.01, W * 0.052, neckHeight, shade);
  canvas.fillEllipse(cx, g.headCy, g.headRx, g.headRy, skin);
  canvas.fillEllipse(cx - g.headRx * 0.99, g.headCy + g.headRy * 0.05, W * 0.016, W * 0.03, shade);
  canvas.fillEllipse(cx + g.headRx * 0.99, g.headCy + g.headRy * 0.05, W * 0.016, W * 0.03, shade);
  canvas.fillRect(cx - W * 0.007, g.headCy + g.headRy * 0.34, W * 0.014, W * 0.028, shade);
  // 脖子为头部让位，重新补一小段阴影。
  canvas.fillRect(cx - W * 0.03, neckTop - W * 0.006, W * 0.06, W * 0.014, darken(shade, 0.12));
}

function drawBottom(canvas, draw, W, H, g) {
  const color = draw.color || '#2f4a72';
  const accent = darken(color, 0.28);
  const type = draw.type || 'pants';
  if (type === 'skirt') {
    canvas.fillPolygon([
      [g.cx - g.waistHalf, g.waistY],
      [g.cx + g.waistHalf, g.waistY],
      [g.cx + W * 0.17, g.hipY + W * 0.11],
      [g.cx - W * 0.17, g.hipY + W * 0.11],
    ], color);
    canvas.fillRect(g.cx - W * 0.17, g.hipY + W * 0.09, W * 0.34, W * 0.024, accent);
    for (let i = -2; i <= 2; i += 1) {
      canvas.fillPolygon([
        [g.cx + i * W * 0.055, g.waistY],
        [g.cx + i * W * 0.055 + W * 0.006, g.waistY],
        [g.cx + i * W * 0.085 + W * 0.006, g.hipY + W * 0.09],
        [g.cx + i * W * 0.085, g.hipY + W * 0.09],
      ], withAlpha(accent, 150));
    }
    return;
  }
  const bottomY = type === 'shorts' ? H * 0.71 : g.footY - W * 0.02;
  for (const side of [-1, 1]) {
    canvas.fillPolygon([
      [g.cx + side * g.hipHalf, g.waistY - W * 0.01],
      [g.cx + side * W * 0.006, g.waistY - W * 0.01],
      [g.cx + side * W * 0.02, bottomY],
      [g.cx + side * (type === 'shorts' ? W * 0.11 : W * 0.092), bottomY],
    ], color);
    canvas.fillRect(
      g.cx + side * (type === 'shorts' ? W * 0.11 : W * 0.092) - (side > 0 ? W * 0.05 : 0),
      bottomY - W * 0.014,
      W * 0.05,
      W * 0.018,
      accent,
    );
  }
  canvas.fillRect(g.cx - g.waistHalf, g.waistY - W * 0.024, g.waistHalf * 2, W * 0.024, accent);
}

function drawOutfit(canvas, draw, W, H, g) {
  const colors = Array.isArray(draw.colors) && draw.colors.length ? draw.colors : ['#3a4a5c', '#222c38'];
  const main = colors[0];
  const accent = colors[1] || darken(main, 0.3);
  // 袖子：比手臂略宽。
  for (const side of [-1, 1]) {
    const topX = g.cx + side * (g.shoulderHalf - W * 0.016);
    const topY = g.shoulderY + H * 0.006;
    const bottomX = g.cx + side * (g.waistHalf + W * 0.052);
    const bottomY = g.waistY + H * 0.035;
    const halfWidth = W * 0.029;
    canvas.fillPolygon([
      [topX - halfWidth, topY],
      [topX + halfWidth, topY],
      [bottomX + halfWidth * 0.86, bottomY],
      [bottomX - halfWidth * 0.86, bottomY],
    ], main);
    canvas.fillRect(bottomX - halfWidth * 0.9, bottomY - W * 0.012, halfWidth * 1.8, W * 0.016, accent);
  }
  canvas.fillPolygon([
    [g.cx - g.shoulderHalf - W * 0.008, g.shoulderY - H * 0.004],
    [g.cx + g.shoulderHalf + W * 0.008, g.shoulderY - H * 0.004],
    [g.cx + g.waistHalf + W * 0.012, g.waistY + W * 0.018],
    [g.cx - g.waistHalf - W * 0.012, g.waistY + W * 0.018],
  ], main);
  // V 领。
  canvas.fillPolygon([
    [g.cx - W * 0.055, g.shoulderY - H * 0.002],
    [g.cx, g.shoulderY + H * 0.048],
    [g.cx + W * 0.055, g.shoulderY - H * 0.002],
    [g.cx + W * 0.028, g.shoulderY - H * 0.01],
    [g.cx, g.shoulderY + H * 0.022],
    [g.cx - W * 0.028, g.shoulderY - H * 0.01],
  ], accent);
  canvas.fillRect(g.cx - g.waistHalf, g.waistY + W * 0.002, g.waistHalf * 2, W * 0.018, accent);

  const emblemY = g.shoulderY + (g.waistY - g.shoulderY) * 0.46;
  const emblem = draw.emblem || 'circle';
  if (emblem === 'circle') {
    canvas.fillEllipse(g.cx, emblemY, W * 0.03, W * 0.03, accent);
    canvas.fillEllipse(g.cx, emblemY, W * 0.018, W * 0.018, lighten(accent, 0.35));
  } else if (emblem === 'stripe') {
    canvas.fillRect(g.cx - W * 0.06, emblemY - W * 0.008, W * 0.12, W * 0.016, accent);
    canvas.fillRect(g.cx - W * 0.06, emblemY + W * 0.016, W * 0.12, W * 0.01, withAlpha(accent, 160));
  } else if (emblem === 'bolt') {
    canvas.fillPolygon([
      [g.cx + W * 0.012, emblemY - W * 0.04],
      [g.cx - W * 0.03, emblemY + W * 0.006],
      [g.cx - W * 0.006, emblemY + W * 0.006],
      [g.cx - W * 0.014, emblemY + W * 0.04],
      [g.cx + W * 0.034, emblemY - W * 0.006],
      [g.cx + W * 0.008, emblemY - W * 0.006],
    ], accent);
  } else if (emblem === 'dot') {
    canvas.fillEllipse(g.cx - W * 0.02, emblemY, W * 0.012, W * 0.012, accent);
    canvas.fillEllipse(g.cx + W * 0.02, emblemY, W * 0.012, W * 0.012, accent);
    canvas.fillRect(g.cx - W * 0.008, emblemY - W * 0.004, W * 0.016, W * 0.008, accent);
  } else if (emblem === 'number') {
    canvas.fillRect(g.cx - W * 0.055, emblemY - W * 0.03, W * 0.11, W * 0.06, withAlpha(accent, 110));
    canvas.fillRect(g.cx - W * 0.012, emblemY - W * 0.022, W * 0.024, W * 0.044, accent);
  } else if (emblem === 'crest') {
    canvas.fillPolygon([
      [g.cx, emblemY - W * 0.045],
      [g.cx + W * 0.045, emblemY - W * 0.015],
      [g.cx, emblemY + W * 0.045],
      [g.cx - W * 0.045, emblemY - W * 0.015],
    ], accent);
    canvas.fillPolygon([
      [g.cx, emblemY - W * 0.024],
      [g.cx + W * 0.022, emblemY - W * 0.006],
      [g.cx, emblemY + W * 0.022],
      [g.cx - W * 0.022, emblemY - W * 0.006],
    ], lighten(accent, 0.4));
  }
}

function drawOuter(canvas, draw, W, H, g) {
  const type = draw.type || 'none';
  if (type === 'none') return;
  const color = draw.color || '#3b2f2a';
  const accent = lighten(color, 0.22);
  const bottomY = type === 'coat' ? H * 0.80 : type === 'cape' ? H * 0.82 : H * 0.71;
  for (const side of [-1, 1]) {
    const outerX = g.cx + side * (g.shoulderHalf + W * 0.018);
    const innerX = g.cx + side * (g.waistHalf + W * 0.008);
    const hemX = g.cx + side * (g.waistHalf + W * 0.055);
    const innerHemX = g.cx + side * (g.waistHalf - W * 0.005);
    canvas.fillPolygon([
      [outerX, g.shoulderY - H * 0.004],
      [innerX, g.shoulderY + H * 0.01],
      [innerHemX, bottomY],
      [hemX, bottomY],
    ], color);
    canvas.fillRect(
      Math.min(outerX, hemX) - W * 0.004,
      bottomY - W * 0.012,
      Math.abs(hemX - outerX) + W * 0.008,
      W * 0.016,
      accent,
    );
  }
  // 领口装饰。
  canvas.fillPolygon([
    [g.cx - W * 0.075, g.shoulderY - H * 0.006],
    [g.cx - W * 0.045, g.shoulderY + H * 0.045],
    [g.cx - W * 0.018, g.shoulderY - H * 0.006],
  ], accent);
  canvas.fillPolygon([
    [g.cx + W * 0.075, g.shoulderY - H * 0.006],
    [g.cx + W * 0.045, g.shoulderY + H * 0.045],
    [g.cx + W * 0.018, g.shoulderY - H * 0.006],
  ], accent);
}

function drawShoes(canvas, draw, W, H, g) {
  const color = draw.color || '#e2e2e2';
  const sole = darken(color, 0.35);
  const high = draw.height === 'high';
  for (const side of [-1, 1]) {
    const fx = g.cx + side * W * 0.052;
    if (draw.glow) {
      canvas.fillEllipse(fx, g.footY + W * 0.006, W * 0.075, W * 0.032, withAlpha(color, 90));
    }
    if (high) {
      canvas.fillRect(fx - W * 0.044, g.footY - W * 0.07, W * 0.088, W * 0.078, color);
      canvas.fillEllipse(fx, g.footY + W * 0.006, W * 0.054, W * 0.024, color);
    } else {
      canvas.fillEllipse(fx, g.footY, W * 0.056, W * 0.023, color);
    }
    canvas.fillRect(fx - W * 0.05, g.footY + W * 0.012, W * 0.1, W * 0.012, sole);
  }
}

function drawHair(canvas, draw, W, H, g) {
  const color = draw.color || '#2b1d15';
  const shade = draw.shade || darken(color, 0.3);
  const style = draw.style || 'short';
  const cx = g.cx;
  const cy = g.headCy;
  const rx = g.headRx;
  const ry = g.headRy;
  // 顶部发冠。
  canvas.fillEllipse(cx, cy - ry * 0.32, rx * 1.06, ry * 0.72, color);
  // 刘海：几块三角形拼出发际线。
  canvas.fillPolygon([
    [cx - rx * 0.98, cy - ry * 0.16],
    [cx - rx * 0.34, cy + ry * 0.06],
    [cx - rx * 0.08, cy - ry * 0.28],
    [cx + rx * 0.30, cy + ry * 0.08],
    [cx + rx * 0.96, cy - ry * 0.20],
    [cx + rx * 0.86, cy - ry * 0.78],
    [cx - rx * 0.86, cy - ry * 0.78],
  ], color);
  canvas.fillPolygon([
    [cx - rx * 0.62, cy - ry * 0.72],
    [cx - rx * 0.18, cy - ry * 0.10],
    [cx + rx * 0.10, cy - ry * 0.72],
  ], shade);
  if (style === 'long') {
    for (const side of [-1, 1]) {
      canvas.fillPolygon([
        [cx + side * rx * 0.92, cy - ry * 0.45],
        [cx + side * rx * 1.18, cy + ry * 0.30],
        [cx + side * rx * 1.05, g.shoulderY + H * 0.03],
        [cx + side * rx * 0.62, g.shoulderY + H * 0.01],
      ], side < 0 ? shade : color);
    }
  } else if (style === 'bob') {
    for (const side of [-1, 1]) {
      canvas.fillPolygon([
        [cx + side * rx * 0.90, cy - ry * 0.35],
        [cx + side * rx * 1.10, cy + ry * 0.55],
        [cx + side * rx * 0.78, cy + ry * 0.95],
        [cx + side * rx * 0.60, cy + ry * 0.50],
      ], side < 0 ? shade : color);
    }
  } else if (style === 'bun') {
    canvas.fillEllipse(cx, cy - ry * 0.92, W * 0.048, W * 0.044, color);
    canvas.fillEllipse(cx - W * 0.008, cy - ry * 0.94, W * 0.022, W * 0.02, shade);
  } else if (style === 'spiky') {
    for (let i = -2; i <= 2; i += 1) {
      const offset = i * rx * 0.36;
      canvas.fillPolygon([
        [cx + offset - rx * 0.20, cy - ry * 0.55],
        [cx + offset + rx * 0.20, cy - ry * 0.55],
        [cx + offset + rx * 0.05, cy - ry * 1.42],
      ], i % 2 === 0 ? color : shade);
    }
  }
  // 鬓角收边。
  canvas.fillRect(cx - rx * 1.02, cy - ry * 0.05, rx * 0.10, ry * 0.52, shade);
  canvas.fillRect(cx + rx * 0.92, cy - ry * 0.05, rx * 0.10, ry * 0.52, shade);
}

function drawAccessory(canvas, draw, W, H, g) {
  const type = draw.type || 'none';
  if (type === 'none') return;
  const color = draw.color || '#1d1a18';
  const cx = g.cx;
  const cy = g.headCy;
  const rx = g.headRx;
  const ry = g.headRy;
  if (type === 'glasses') {
    const lensY = cy + ry * 0.10;
    const lensW = rx * 0.62;
    const lensH = ry * 0.36;
    for (const side of [-1, 1]) {
      const lensX = cx + side * (rx * 0.44) - lensW / 2;
      canvas.fillRect(lensX, lensY, lensW, lensH, withAlpha(color, 55));
      canvas.fillRect(lensX, lensY, lensW, W * 0.005, color);
      canvas.fillRect(lensX, lensY + lensH - W * 0.005, lensW, W * 0.005, color);
      canvas.fillRect(lensX, lensY, W * 0.005, lensH, color);
      canvas.fillRect(lensX + lensW - W * 0.005, lensY, W * 0.005, lensH, color);
    }
    canvas.fillRect(cx - rx * 0.44 + rx * 0.31, lensY + lensH * 0.4, rx * 0.26, W * 0.005, color);
  } else if (type === 'headphones') {
    canvas.fillRect(cx - rx * 1.12, cy - ry * 0.94, rx * 2.24, W * 0.014, color);
    for (const side of [-1, 1]) {
      canvas.fillEllipse(cx + side * rx * 1.06, cy + ry * 0.02, W * 0.034, W * 0.05, color);
      canvas.fillEllipse(cx + side * rx * 1.06, cy + ry * 0.02, W * 0.020, W * 0.032, lighten(color, 0.3));
    }
  } else if (type === 'scarf') {
    canvas.fillRect(cx - W * 0.075, g.shoulderY - H * 0.012, W * 0.15, W * 0.032, color);
    canvas.fillRect(cx + W * 0.035, g.shoulderY + W * 0.014, W * 0.045, H * 0.10, color);
    canvas.fillRect(cx + W * 0.035, g.shoulderY + W * 0.014, W * 0.045, W * 0.014, lighten(color, 0.25));
  } else if (type === 'visor') {
    canvas.fillRect(cx - rx * 1.02, cy + ry * 0.02, rx * 2.04, ry * 0.30, withAlpha(color, 150));
    canvas.fillRect(cx - rx * 1.02, cy + ry * 0.02, rx * 2.04, W * 0.006, color);
    canvas.fillRect(cx - rx * 1.02, cy + ry * 0.30, rx * 2.04, W * 0.006, color);
  } else if (type === 'halo') {
    for (let i = 0; i < 28; i += 1) {
      const angle = (Math.PI * 2 * i) / 28;
      const hx = cx + Math.cos(angle) * rx * 0.92;
      const hy = cy - ry * 1.22 + Math.sin(angle) * W * 0.022;
      canvas.fillEllipse(hx, hy, W * 0.011, W * 0.011, withAlpha(color, 220));
    }
    canvas.fillEllipse(cx, cy - ry * 1.22, rx * 1.02, W * 0.04, withAlpha(color, 45));
  }
}

function drawExpression(canvas, draw, W, H, g) {
  const ink = draw.ink || '#1b1410';
  const type = draw.type || 'calm';
  const cx = g.cx;
  const cy = g.headCy;
  const eyeY = cy + g.headRy * 0.18;
  const eyeDx = g.headRx * 0.42;
  const unit = W * 0.013;
  const mouthY = cy + g.headRy * 0.55;
  if (type === 'calm') {
    for (const side of [-1, 1]) canvas.fillEllipse(cx + side * eyeDx, eyeY, unit * 1.25, unit * 0.72, ink);
    canvas.fillRect(cx - W * 0.016, mouthY, W * 0.032, W * 0.006, ink);
  } else if (type === 'smile') {
    for (const side of [-1, 1]) canvas.fillEllipse(cx + side * eyeDx, eyeY, unit * 1.2, unit * 0.8, ink);
    canvas.fillEllipse(cx, mouthY, W * 0.038, W * 0.012, ink);
    canvas.fillEllipse(cx, mouthY + W * 0.004, W * 0.022, W * 0.006, lighten(ink, 0.45));
    for (const side of [-1, 1]) {
      canvas.fillEllipse(cx + side * eyeDx * 1.5, eyeY + unit * 2.2, unit * 1.3, unit * 0.7, withAlpha('#e08a7a', 90));
    }
  } else if (type === 'stern') {
    for (const side of [-1, 1]) {
      const x = cx + side * eyeDx;
      canvas.fillPolygon([
        [x - unit * 1.7, eyeY + unit * 0.4],
        [x + unit * 1.7, eyeY - unit * 0.4],
        [x + unit * 1.7, eyeY + unit * 0.4],
        [x - unit * 1.7, eyeY + unit * 1.0],
      ], ink);
      canvas.fillPolygon([
        [x - unit * 1.8, eyeY - unit * 1.3],
        [x + unit * 1.8, eyeY - unit * 1.9],
        [x + unit * 1.8, eyeY - unit * 1.4],
      ], ink);
    }
    canvas.fillRect(cx - W * 0.022, mouthY, W * 0.044, W * 0.005, ink);
  } else if (type === 'wink') {
    canvas.fillRect(cx - eyeDx - W * 0.022, eyeY, W * 0.044, W * 0.006, ink);
    canvas.fillEllipse(cx + eyeDx, eyeY, unit * 1.25, unit * 0.9, ink);
    canvas.fillPolygon([
      [cx - W * 0.018, mouthY - W * 0.004],
      [cx + W * 0.020, mouthY + W * 0.006],
      [cx - W * 0.006, mouthY + W * 0.012],
    ], ink);
  } else if (type === 'surprised') {
    for (const side of [-1, 1]) {
      canvas.fillEllipse(cx + side * eyeDx, eyeY, unit * 1.5, unit * 1.25, ink);
      canvas.fillEllipse(cx + side * eyeDx - unit * 0.4, eyeY - unit * 0.35, unit * 0.4, unit * 0.4, '#ffffff');
    }
    canvas.fillEllipse(cx, mouthY + W * 0.002, W * 0.022, W * 0.026, ink);
    canvas.fillEllipse(cx, mouthY + W * 0.010, W * 0.014, W * 0.008, darken(ink, 0.2));
  }
  // 通用鼻子阴影。
  canvas.fillRect(cx - W * 0.006, cy + g.headRy * 0.36, W * 0.012, W * 0.018, withAlpha(ink, 130));
}

function drawScene(canvas, { traits, rngSeed, catalog }) {
  const W = canvas.width;
  const H = canvas.height;
  const rng = createRng(rngSeed);
  const background = parts.getTrait('background', traits.background, catalog);
  const body = parts.getTrait('body', traits.body, catalog);
  const bottom = parts.getTrait('bottom', traits.bottom, catalog);
  const outfit = parts.getTrait('outfit', traits.outfit, catalog);
  const outer = parts.getTrait('outer', traits.outer, catalog);
  const shoes = parts.getTrait('shoes', traits.shoes, catalog);
  const hair = parts.getTrait('hair', traits.hair, catalog);
  const accessory = parts.getTrait('accessory', traits.accessory, catalog);
  const expression = parts.getTrait('expression', traits.expression, catalog);

  if (background) drawBackground(canvas, background.draw, W, H, rng);
  const geometry = buildGeometry(W, H, body ? body.draw : {}, rng);
  if (body) drawBody(canvas, body.draw, W, H, geometry);
  if (bottom) drawBottom(canvas, bottom.draw, W, H, geometry);
  if (outfit) drawOutfit(canvas, outfit.draw, W, H, geometry);
  if (outer) drawOuter(canvas, outer.draw, W, H, geometry);
  if (shoes) drawShoes(canvas, shoes.draw, W, H, geometry);
  if (hair) drawHair(canvas, hair.draw, W, H, geometry);
  if (accessory) drawAccessory(canvas, accessory.draw, W, H, geometry);
  if (expression) drawExpression(canvas, expression.draw, W, H, geometry);
}

function renderPng({ traits, seed, style, width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT, scale = 2, catalog }) {
  const resolved = parts.pickTraits(seed, style, normalizeTraits(traits, catalog), catalog);
  const hash = compositionHash({ traits: resolved, seed, style });
  const canvas = createCanvas(width, height, { scale });
  drawScene(canvas, { traits: resolved, rngSeed: `character-render:${hash}`, catalog });
  return canvas.toPng();
}

function renderCard(card, options = {}) {
  const catalog = options.catalog;
  const traits = resolveTraits(card || {}, catalog);
  const seed = normalizeSeed(card?.seed);
  const style = String(card?.style || 'general');
  const hash = compositionHash({ traits, seed, style });
  const rarity = parts.computeRarity(traits, catalog);
  const scale = options.scale === undefined ? 2 : Math.max(1, Math.floor(options.scale));
  const png = renderPng({
    traits,
    seed,
    style,
    width: options.width || DEFAULT_WIDTH,
    height: options.height || DEFAULT_HEIGHT,
    scale,
    catalog,
  });
  const thumbPng = renderPng({
    traits,
    seed,
    style,
    width: options.thumbWidth || THUMB_WIDTH,
    height: options.thumbHeight || THUMB_HEIGHT,
    scale: options.thumbScale === undefined ? scale : Math.max(1, Math.floor(options.thumbScale)),
    catalog,
  });
  return { png, thumbPng, traits, compositionHash: hash, rarityScore: rarity.score, rarityTier: rarity.tier };
}

function renderPreview(card, options = {}) {
  const catalog = options.catalog;
  const traits = resolveTraits(card || {}, catalog);
  const seed = normalizeSeed(card?.seed);
  const style = String(card?.style || 'general');
  const hash = compositionHash({ traits, seed, style });
  const rarity = parts.computeRarity(traits, catalog);
  const scale = options.scale === undefined ? 2 : Math.max(1, Math.floor(options.scale));
  const png = renderPng({
    traits,
    seed,
    style,
    width: options.width || THUMB_WIDTH,
    height: options.height || THUMB_HEIGHT,
    scale,
    catalog,
  });
  return { png, traits, compositionHash: hash, rarity: { score: rarity.score, tier: rarity.tier } };
}

module.exports = {
  DEFAULT_WIDTH,
  DEFAULT_HEIGHT,
  THUMB_WIDTH,
  THUMB_HEIGHT,
  compositionHash,
  normalizeTraits,
  normalizeSeed,
  resolveTraits,
  renderPng,
  renderCard,
  renderPreview,
  drawScene,
};
