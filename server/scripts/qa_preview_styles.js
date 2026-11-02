// 按预览尺寸渲染 4 种风格排查「都是像素风」问题
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { renderPreview } = require('../src/character/render');

const OUT = process.env.QA_OUT || 'C:\\qa';
for (const [style, seed] of [['通用', 11], ['像素画', 12], ['言情漫画', 13], ['细腻厚涂', 14]]) {
  const r = renderPreview({ style, seed, traits: {} });
  const file = path.join(OUT, `prev_${encodeURIComponent(style)}.png`);
  fs.writeFileSync(file, r.png);
  console.log(style, r.png.length, file);
}
