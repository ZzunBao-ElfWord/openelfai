'use strict';

const zlib = require('node:zlib');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// CRC32（PNG 规范多项式 0xEDB88320），自己实现，避免引入依赖。
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function parseColor(value) {
  if (Array.isArray(value)) {
    return [
      clampByte(value[0], 255),
      clampByte(value[1], 255),
      clampByte(value[2], 255),
      clampByte(value.length > 3 ? value[3] : 255, 255),
    ];
  }
  if (typeof value !== 'string') return [255, 255, 255, 255];
  const text = value.trim();
  if (text.startsWith('#')) {
    let hex = text.slice(1);
    if (hex.length === 3) hex = hex.split('').map((ch) => ch + ch).join('');
    if (hex.length === 6) hex += 'ff';
    if (hex.length !== 8 || !/^[0-9a-f]+$/i.test(hex)) return [255, 255, 255, 255];
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
      parseInt(hex.slice(6, 8), 16),
    ];
  }
  const rgba = /^rgba?\(([^)]+)\)$/i.exec(text);
  if (rgba) {
    const parts = rgba[1].split(',').map((item) => Number(item.trim()));
    if (parts.length >= 3 && parts.every((item) => Number.isFinite(item))) {
      return [
        clampByte(parts[0], 0),
        clampByte(parts[1], 0),
        clampByte(parts[2], 0),
        clampByte(parts[3] === undefined ? 255 : parts[3] * 255, 0),
      ];
    }
  }
  return [255, 255, 255, 255];
}

function clampByte(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(255, Math.round(number)));
}

function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // color type: RGBA
  header[10] = 0; // compression
  header[11] = 0; // filter
  header[12] = 0; // interlace

  // 每行前加一个 filter 字节（0 = None），再整体 deflate。
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 6 });

  return Buffer.concat([
    PNG_SIGNATURE,
    makeChunk('IHDR', header),
    makeChunk('IDAT', idat),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'latin1');
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

// 画布：逻辑坐标绘制，内部按 scale 放大后再缩小，实现 2x 超采样抗锯齿。
function createCanvas(width, height, options = {}) {
  const logicalWidth = Math.max(1, Math.round(width));
  const logicalHeight = Math.max(1, Math.round(height));
  const scale = Math.max(1, Math.floor(options.scale || 1));
  const deviceWidth = logicalWidth * scale;
  const deviceHeight = logicalHeight * scale;
  const data = Buffer.alloc(deviceWidth * deviceHeight * 4);

  function blend(index, color) {
    const alpha = color[3];
    if (alpha === 0) return;
    if (alpha === 255) {
      data[index] = color[0];
      data[index + 1] = color[1];
      data[index + 2] = color[2];
      data[index + 3] = 255;
      return;
    }
    const dstAlpha = data[index + 3];
    if (dstAlpha === 255) {
      // 目标不透明时直接按源透明度插值，避免除法。
      const ratio = alpha / 255;
      data[index] = Math.round(color[0] * ratio + data[index] * (1 - ratio));
      data[index + 1] = Math.round(color[1] * ratio + data[index + 1] * (1 - ratio));
      data[index + 2] = Math.round(color[2] * ratio + data[index + 2] * (1 - ratio));
      return;
    }
    const sa = alpha / 255;
    const da = dstAlpha / 255;
    const oa = sa + da * (1 - sa);
    if (oa <= 0) return;
    data[index] = Math.round((color[0] * sa + data[index] * da * (1 - sa)) / oa);
    data[index + 1] = Math.round((color[1] * sa + data[index + 1] * da * (1 - sa)) / oa);
    data[index + 2] = Math.round((color[2] * sa + data[index + 2] * da * (1 - sa)) / oa);
    data[index + 3] = Math.round(oa * 255);
  }

  function fillRect(x, y, w, h, color) {
    const rgba = parseColor(color);
    const x0 = Math.max(0, Math.round(x * scale));
    const y0 = Math.max(0, Math.round(y * scale));
    const x1 = Math.min(deviceWidth, Math.round((x + w) * scale));
    const y1 = Math.min(deviceHeight, Math.round((y + h) * scale));
    for (let py = y0; py < y1; py += 1) {
      for (let px = x0; px < x1; px += 1) blend((py * deviceWidth + px) * 4, rgba);
    }
  }

  function fillEllipse(cx, cy, rx, ry, color) {
    const rgba = parseColor(color);
    const centerX = cx * scale;
    const centerY = cy * scale;
    const radiusX = Math.abs(rx * scale);
    const radiusY = Math.abs(ry * scale);
    if (radiusX <= 0 || radiusY <= 0) return;
    const x0 = Math.max(0, Math.floor(centerX - radiusX));
    const x1 = Math.min(deviceWidth - 1, Math.ceil(centerX + radiusX));
    const y0 = Math.max(0, Math.floor(centerY - radiusY));
    const y1 = Math.min(deviceHeight - 1, Math.ceil(centerY + radiusY));
    const rx2 = radiusX * radiusX;
    const ry2 = radiusY * radiusY;
    for (let py = y0; py <= y1; py += 1) {
      const dy = py + 0.5 - centerY;
      for (let px = x0; px <= x1; px += 1) {
        const dx = px + 0.5 - centerX;
        if ((dx * dx) / rx2 + (dy * dy) / ry2 <= 1) blend((py * deviceWidth + px) * 4, rgba);
      }
    }
  }

  // 扫描线多边形填充（偶奇规则）。
  function fillPolygon(points, color) {
    if (!points || points.length < 3) return;
    const rgba = parseColor(color);
    const vertices = points.map((point) => [point[0] * scale, point[1] * scale]);
    let minY = Infinity;
    let maxY = -Infinity;
    for (const vertex of vertices) {
      if (vertex[1] < minY) minY = vertex[1];
      if (vertex[1] > maxY) maxY = vertex[1];
    }
    const yStart = Math.max(0, Math.floor(minY));
    const yEnd = Math.min(deviceHeight - 1, Math.ceil(maxY));
    const edges = [];
    for (let i = 0; i < vertices.length; i += 1) {
      const a = vertices[i];
      const b = vertices[(i + 1) % vertices.length];
      if (a[1] === b[1]) continue;
      edges.push([a[1] < b[1] ? a : b, a[1] < b[1] ? b : a]);
    }
    for (let py = yStart; py <= yEnd; py += 1) {
      const scanY = py + 0.5;
      const crossings = [];
      for (const [a, b] of edges) {
        if (scanY < a[1] || scanY >= b[1]) continue;
        crossings.push(a[0] + ((scanY - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
      if (crossings.length < 2) continue;
      crossings.sort((left, right) => left - right);
      for (let i = 0; i + 1 < crossings.length; i += 2) {
        const startX = Math.max(0, Math.ceil(crossings[i]));
        const endX = Math.min(deviceWidth, Math.floor(crossings[i + 1]));
        for (let px = startX; px < endX; px += 1) blend((py * deviceWidth + px) * 4, rgba);
      }
    }
  }

  // 竖向线性渐变填充矩形。
  function fillLinearGradient(x, y, w, h, topColor, bottomColor) {
    const top = parseColor(topColor);
    const bottom = parseColor(bottomColor);
    const x0 = Math.max(0, Math.round(x * scale));
    const y0 = Math.max(0, Math.round(y * scale));
    const x1 = Math.min(deviceWidth, Math.round((x + w) * scale));
    const y1 = Math.min(deviceHeight, Math.round((y + h) * scale));
    const rows = Math.max(1, y1 - y0 - 1);
    for (let py = y0; py < y1; py += 1) {
      const t = Math.min(1, (py - y0) / rows);
      const rgba = [
        Math.round(top[0] + (bottom[0] - top[0]) * t),
        Math.round(top[1] + (bottom[1] - top[1]) * t),
        Math.round(top[2] + (bottom[2] - top[2]) * t),
        Math.round(top[3] + (bottom[3] - top[3]) * t),
      ];
      if (rgba[3] === 255) {
        for (let px = x0; px < x1; px += 1) {
          const index = (py * deviceWidth + px) * 4;
          data[index] = rgba[0];
          data[index + 1] = rgba[1];
          data[index + 2] = rgba[2];
          data[index + 3] = 255;
        }
      } else {
        for (let px = x0; px < x1; px += 1) blend((py * deviceWidth + px) * 4, rgba);
      }
    }
  }

  function downsample() {
    if (scale === 1) return data;
    const out = Buffer.alloc(logicalWidth * logicalHeight * 4);
    const block = scale * scale;
    for (let y = 0; y < logicalHeight; y += 1) {
      for (let x = 0; x < logicalWidth; x += 1) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let sy = 0; sy < scale; sy += 1) {
          const rowOffset = ((y * scale + sy) * deviceWidth + x * scale) * 4;
          for (let sx = 0; sx < scale; sx += 1) {
            const index = rowOffset + sx * 4;
            r += data[index];
            g += data[index + 1];
            b += data[index + 2];
            a += data[index + 3];
          }
        }
        const index = (y * logicalWidth + x) * 4;
        out[index] = Math.round(r / block);
        out[index + 1] = Math.round(g / block);
        out[index + 2] = Math.round(b / block);
        out[index + 3] = Math.round(a / block);
      }
    }
    return out;
  }

  return {
    width: logicalWidth,
    height: logicalHeight,
    scale,
    deviceWidth,
    deviceHeight,
    data,
    fillRect,
    fillEllipse,
    fillPolygon,
    fillLinearGradient,
    linearGradient: fillLinearGradient,
    toPng() {
      return encodePng(logicalWidth, logicalHeight, downsample());
    },
  };
}

module.exports = { createCanvas, encodePng, crc32, parseColor, PNG_SIGNATURE };
