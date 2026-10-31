'use strict';

// 一次性生成专家头像：抽象漫画风半身像，几何 + 渐变，不含真人肖像要素。
// 复现：node tools/gen-expert-avatar.js
const fs = require('node:fs');
const path = require('node:path');

function loadPngModule() {
  const candidates = [
    path.join(__dirname, '..', '..', '..', 'server', 'src', 'character', 'png.js'),
    path.join(__dirname, '..', '..', 'server', 'src', 'character', 'png.js'),
    path.join(process.cwd(), 'server', 'src', 'character', 'png.js'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return require(candidate);
  }
  throw new Error('未找到 server/src/character/png.js，请在 openelfai 根目录运行本脚本');
}

const { createCanvas, PNG_SIGNATURE } = loadPngModule();

const SIZE = 512;
const OUTPUT = path.join(__dirname, '..', 'expert', 'avatars', 'expert.png');

function star(canvas, cx, cy, radius, color) {
  const inner = radius * 0.3;
  canvas.fillPolygon([
    [cx, cy - radius],
    [cx + inner, cy - inner],
    [cx + radius, cy],
    [cx + inner, cy + inner],
    [cx, cy + radius],
    [cx - inner, cy + inner],
    [cx - radius, cy],
    [cx - inner, cy - inner],
  ], color);
}

function draw() {
  const canvas = createCanvas(SIZE, SIZE, { scale: 2 });

  // 背景：深蓝渐变 + 两层柔光 + 底部压暗。
  canvas.fillLinearGradient(0, 0, SIZE, SIZE, '#070d1b', '#1a2f58');
  canvas.fillEllipse(256, 196, 236, 236, 'rgba(59,130,246,0.16)');
  canvas.fillEllipse(256, 210, 168, 168, 'rgba(96,165,250,0.14)');
  canvas.fillEllipse(96, 96, 90, 90, 'rgba(147,197,253,0.10)');
  canvas.fillEllipse(430, 120, 70, 70, 'rgba(59,130,246,0.12)');
  canvas.fillLinearGradient(0, 320, SIZE, SIZE - 320, 'rgba(7,13,27,0)', 'rgba(7,13,27,0.62)');

  // 后层头发与侧发。
  canvas.fillEllipse(256, 186, 142, 150, '#10244a');
  canvas.fillPolygon([[154, 196], [128, 336], [172, 400], [190, 300], [196, 208]], '#0d1c3a');
  canvas.fillPolygon([[358, 196], [384, 336], [340, 400], [322, 300], [316, 208]], '#0d1c3a');

  // 肩与外套。
  canvas.fillPolygon([
    [88, SIZE], [116, 396], [186, 342], [256, 358], [326, 342], [396, 396], [424, SIZE],
  ], '#16305f');
  canvas.fillPolygon([[116, 396], [186, 342], [214, 386], [150, 470], [110, 430]], '#1d3d78');
  canvas.fillPolygon([[396, 396], [326, 342], [298, 386], [362, 470], [402, 430]], '#1d3d78');
  canvas.fillPolygon([[186, 342], [256, 396], [326, 342], [306, 314], [256, 340], [206, 314]], '#2c56a6');

  // 领口高光与胸前徽记。
  canvas.fillPolygon([[256, 396], [214, 386], [236, 436], [256, 420]], '#3f6cc4');
  canvas.fillPolygon([[256, 396], [298, 386], [276, 436], [256, 420]], '#3f6cc4');
  canvas.fillPolygon([[256, 430], [282, 486], [230, 486]], '#60a5fa');
  canvas.fillPolygon([[256, 444], [272, 478], [240, 478]], '#c7ddff');

  // 颈与肩线。
  canvas.fillRect(234, 296, 44, 54, '#c9d8f2');
  canvas.fillEllipse(256, 306, 34, 16, 'rgba(120,150,200,0.35)');

  // 精灵耳。
  canvas.fillPolygon([[176, 198], [130, 162], [150, 240]], '#b9cbe8');
  canvas.fillPolygon([[176, 200], [142, 176], [156, 230]], '#e6eeff');
  canvas.fillPolygon([[336, 198], [382, 162], [362, 240]], '#b9cbe8');
  canvas.fillPolygon([[336, 200], [370, 176], [356, 230]], '#e6eeff');

  // 头部与下巴阴影。
  canvas.fillEllipse(256, 210, 86, 104, '#e6eeff');
  canvas.fillEllipse(256, 258, 66, 52, '#cfdcf4');

  // 刘海与前发高光。
  canvas.fillPolygon([
    [168, 200], [176, 142], [208, 112], [256, 102], [304, 112], [336, 142], [344, 200],
    [318, 172], [290, 150], [256, 160], [222, 150], [194, 172],
  ], '#1f3a75');
  canvas.fillPolygon([
    [196, 148], [232, 118], [262, 116], [238, 140], [210, 172], [186, 184],
  ], '#3a5f9e');

  // 面罩：横向深蓝带 + 高光 + 双眼。
  canvas.fillPolygon([[170, 198], [342, 198], [334, 244], [178, 244]], '#1d4ed8');
  canvas.fillRect(186, 210, 140, 7, '#9cc3ff');
  canvas.fillEllipse(214, 230, 10, 8, '#e8f2ff');
  canvas.fillEllipse(298, 230, 10, 8, '#e8f2ff');
  canvas.fillRect(240, 268, 32, 4, '#a9bad6');

  // 点缀星芒。
  star(canvas, 92, 128, 24, '#9cc3ff');
  star(canvas, 424, 168, 15, '#c7ddff');
  star(canvas, 104, 344, 10, 'rgba(191,219,254,0.85)');
  star(canvas, 414, 312, 8, 'rgba(147,197,253,0.8)');

  // 边框光晕。
  canvas.fillRect(0, 0, SIZE, 2, 'rgba(96,165,250,0.35)');
  canvas.fillRect(0, SIZE - 2, SIZE, 2, 'rgba(37,99,235,0.45)');

  return canvas.toPng();
}

function main() {
  const png = draw();
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, png);

  const buffer = fs.readFileSync(OUTPUT);
  const signatureOk = buffer.length >= 24 && buffer.subarray(0, 8).equals(PNG_SIGNATURE);
  if (!signatureOk) throw new Error('生成结果不是合法 PNG');
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width !== SIZE || height !== SIZE) {
    throw new Error(`尺寸不正确：${width}x${height}`);
  }
  console.log(`已生成 ${path.relative(process.cwd(), OUTPUT)}（${width}x${height}，${buffer.length} 字节）`);
}

main();
