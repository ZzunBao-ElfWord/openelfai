// 生成创建页「风格」样图：每种风格用固定 seed 渲染一张方形 PNG，输出到 app/assets/styles/。
// 用法：node server/scripts/gen_style_samples.js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { renderPng } = require('../src/character/render');

const OUT_DIR = path.join(__dirname, '..', '..', 'app', 'assets', 'styles');
// 风格名与客户端 create_elf_page.dart 的 _styles 保持一致；seed 固定保证可复现。
const SAMPLES = [
  ['通用', 'style_general.png', 20261031],
  ['像素画', 'style_pixel.png', 20261032],
  ['言情漫画', 'style_manga.png', 20261033],
  ['细腻厚涂', 'style_impasto.png', 20261034],
];

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const [style, file, seed] of SAMPLES) {
  const png = renderPng({ traits: {}, seed, style, width: 512, height: 512, scale: 2 });
  fs.writeFileSync(path.join(OUT_DIR, file), png);
  console.log(`ok ${style} -> ${file} (${png.length} bytes)`);
}
