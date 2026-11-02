'use strict';

const { createCanvas, parseColor } = require('../character/png');

// 服务端没有 Canvas 2D 的描边原语，用沿线/弧连续盖圆点的方式近似 stroke。
function strokeLine(canvas, x1, y1, x2, y2, lineWidth, color) {
  const length = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(1, Math.ceil(length / Math.max(0.5, lineWidth / 2)));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    canvas.fillEllipse(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, lineWidth / 2, lineWidth / 2, color);
  }
}

function strokeArc(canvas, cx, cy, rx, ry, startAngle, endAngle, lineWidth, color) {
  const sweep = Math.abs(endAngle - startAngle);
  const steps = Math.max(8, Math.ceil((sweep * Math.max(rx, ry)) / Math.max(0.5, lineWidth / 2)));
  for (let i = 0; i <= steps; i += 1) {
    const t = startAngle + (endAngle - startAngle) * (i / steps);
    canvas.fillEllipse(
      cx + Math.cos(t) * rx,
      cy + Math.sin(t) * ry,
      lineWidth / 2,
      lineWidth / 2,
      color,
    );
  }
}

// 光晕：描边/填充底下先垫一层大一号的半透明同色。
function glowColor(color, alpha) {
  const [r, g, b] = parseColor(color);
  return [r, g, b, alpha];
}

function drawBackground(canvas, trait, size) {
  if (trait.type === 'gradient' && trait.to) {
    canvas.fillLinearGradient(0, 0, size, size, trait.color, trait.to);
  } else {
    canvas.fillRect(0, 0, size, size, trait.color);
  }
  // 星点装饰：位置与原型一致（伪随机但固定）。
  for (let i = 0; i < 15; i += 1) {
    const x = (i * 137.5) % size;
    const y = (i * 73.3) % size;
    canvas.fillEllipse(x, y, 1, 1, 'rgba(255,255,255,0.08)');
  }
}

function drawBody(canvas, trait, size) {
  const cx = size / 2;
  canvas.fillEllipse(cx, size * 0.72, size * 0.22, size * 0.2, trait.color);
  canvas.fillRect(cx - size * 0.05, size * 0.52, size * 0.1, size * 0.12, trait.color);
  canvas.fillEllipse(cx, size * 0.4, size * 0.18, size * 0.18, trait.color);
}

function drawEyes(canvas, trait, size) {
  const cx = size / 2;
  const ey = size * 0.36;
  const off = size * 0.06;
  if (trait.shape === 'shades') {
    canvas.fillRect(cx - off - size * 0.05, ey - size * 0.02, size * 0.1, size * 0.05, trait.color);
    canvas.fillRect(cx + off - size * 0.05, ey - size * 0.02, size * 0.1, size * 0.05, trait.color);
    canvas.fillRect(cx - off, ey, off * 2, size * 0.01, trait.color);
    return;
  }
  const r = trait.shape === 'wide' ? size * 0.05 : size * 0.035;
  if (trait.shape === 'glow') {
    canvas.fillEllipse(cx - off, ey, r * 2, r * 2, glowColor(trait.color, 70));
    canvas.fillEllipse(cx + off, ey, r * 2, r * 2, glowColor(trait.color, 70));
  }
  canvas.fillEllipse(cx - off, ey, r, r, trait.color);
  canvas.fillEllipse(cx + off, ey, r, r, trait.color);
}

function drawMouth(canvas, trait, size) {
  const cx = size / 2;
  const my = size * 0.46;
  const lineWidth = size * 0.018;
  switch (trait.shape) {
    case 'smile':
      strokeArc(canvas, cx, my, size * 0.05, size * 0.05, 0.2, Math.PI - 0.2, lineWidth, trait.color);
      break;
    case 'grin':
      strokeArc(canvas, cx, my, size * 0.06, size * 0.06, 0.1, Math.PI - 0.1, lineWidth, trait.color);
      canvas.fillRect(cx - size * 0.04, my + size * 0.02, size * 0.08, size * 0.015, '#ffffff');
      break;
    case 'flat':
      strokeLine(canvas, cx - size * 0.04, my, cx + size * 0.04, my, lineWidth, trait.color);
      break;
    case 'mustache':
      strokeLine(canvas, cx - size * 0.04, my, cx + size * 0.04, my, lineWidth, trait.color);
      // 与原型一致：y 轴向下时 0→π 是下半圆，两撇胡子压在嘴线上。
      strokeArc(canvas, cx - size * 0.02, my - size * 0.01, size * 0.03, size * 0.03,
        0, Math.PI, lineWidth, trait.color);
      strokeArc(canvas, cx + size * 0.02, my - size * 0.01, size * 0.03, size * 0.03,
        0, Math.PI, lineWidth, trait.color);
      break;
    case 'fangs':
      strokeArc(canvas, cx, my, size * 0.05, size * 0.05, 0, Math.PI, lineWidth, trait.color);
      canvas.fillPolygon([
        [cx - size * 0.02, my + size * 0.02],
        [cx - size * 0.01, my + size * 0.05],
        [cx, my + size * 0.02],
      ], trait.color);
      canvas.fillPolygon([
        [cx, my + size * 0.02],
        [cx + size * 0.01, my + size * 0.05],
        [cx + size * 0.02, my + size * 0.02],
      ], trait.color);
      break;
    default:
      break;
  }
}

function drawAccessory(canvas, trait, size) {
  const cx = size / 2;
  switch (trait.shape) {
    case 'crown':
      canvas.fillPolygon([
        [cx - size * 0.12, size * 0.28],
        [cx - size * 0.08, size * 0.2],
        [cx - size * 0.04, size * 0.26],
        [cx, size * 0.18],
        [cx + size * 0.04, size * 0.26],
        [cx + size * 0.08, size * 0.2],
        [cx + size * 0.12, size * 0.28],
      ], trait.color);
      canvas.fillEllipse(cx, size * 0.22, size * 0.015, size * 0.015, '#ff3333');
      break;
    case 'hat':
      canvas.fillRect(cx - size * 0.14, size * 0.26, size * 0.28, size * 0.02, trait.color);
      canvas.fillRect(cx - size * 0.09, size * 0.16, size * 0.18, size * 0.12, trait.color);
      break;
    case 'headphones':
      strokeArc(canvas, cx, size * 0.3, size * 0.16, size * 0.16,
        Math.PI * 1.1, Math.PI * 1.9, size * 0.02, trait.color);
      canvas.fillRect(cx - size * 0.17, size * 0.28, size * 0.04, size * 0.06, trait.color);
      canvas.fillRect(cx + size * 0.13, size * 0.28, size * 0.04, size * 0.06, trait.color);
      break;
    case 'halo':
      strokeArc(canvas, cx, size * 0.16, size * 0.1, size * 0.025,
        0, Math.PI * 2, size * 0.02, glowColor(trait.color, 70));
      strokeArc(canvas, cx, size * 0.16, size * 0.1, size * 0.025,
        0, Math.PI * 2, size * 0.012, trait.color);
      break;
    case 'horns':
      canvas.fillPolygon([
        [cx - size * 0.06, size * 0.26],
        [cx - size * 0.1, size * 0.18],
        [cx - size * 0.03, size * 0.24],
      ], trait.color);
      canvas.fillPolygon([
        [cx + size * 0.06, size * 0.26],
        [cx + size * 0.1, size * 0.18],
        [cx + size * 0.03, size * 0.24],
      ], trait.color);
      break;
    default:
      // 'none'：不画
      break;
  }
}

function drawTrait(canvas, layerId, trait, size) {
  switch (layerId) {
    case 'background': drawBackground(canvas, trait, size); break;
    case 'body': drawBody(canvas, trait, size); break;
    case 'eyes': drawEyes(canvas, trait, size); break;
    case 'mouth': drawMouth(canvas, trait, size); break;
    case 'accessory': drawAccessory(canvas, trait, size); break;
    default: break;
  }
}

// selection: [{ layerId, trait }]，按图层 order 依次叠加。
function drawComposition(canvas, selection, size) {
  for (const part of selection) {
    drawTrait(canvas, part.layerId, part.trait, size);
  }
}

function renderPng(selection, size, scale = 2) {
  const canvas = createCanvas(size, size, { scale });
  drawComposition(canvas, selection, size);
  return canvas.toPng();
}

// 加权随机：rngValue ∈ [0,1)，权重为 0 的配件永远不会被选中。
function weightedPick(traits, rngValue) {
  const total = traits.reduce((sum, trait) => sum + trait.weight, 0);
  if (total <= 0) return traits[0];
  let r = rngValue * total;
  for (const trait of traits) {
    r -= trait.weight;
    if (r < 0) return trait;
  }
  return traits[traits.length - 1];
}

// 稀有度：与各配件命中概率的乘积成反比，口径与原型 calcRarity 一致。
function calcRarity(selection) {
  let score = 1;
  const parts = [];
  for (const part of selection) {
    const total = part.layer.traits.reduce((sum, trait) => sum + trait.weight, 0);
    const prob = total > 0 ? part.trait.weight / total : 0;
    score *= Math.max(prob, 1e-9);
    parts.push({ layerId: part.layerId, layer: part.layer.name, trait: part.trait.name, prob });
  }
  const rarityScore = Math.round((1 / score) * 100) / 100;
  let tier = 'common';
  if (rarityScore > 50) tier = 'rare';
  if (rarityScore > 200) tier = 'epic';
  if (rarityScore > 500) tier = 'legendary';
  return { score: rarityScore, tier, parts };
}

module.exports = { renderPng, drawComposition, weightedPick, calcRarity };
