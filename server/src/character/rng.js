'use strict';

const crypto = require('node:crypto');

function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

// 稳定序列化：对象键排序，保证跨实例、跨进程得到同一段 JSON 与同一枚哈希。
function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    const text = JSON.stringify(value);
    return text === undefined ? 'null' : text;
  }
  if (Array.isArray(value)) {
    return '[' + value.map((item) => stableStringify(item)).join(',') + ']';
  }
  const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
  return '{' + keys.map((key) => JSON.stringify(key) + ':' + stableStringify(value[key])).join(',') + '}';
}

// xmur3：把任意字符串散列成 32 位种子生成器。
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function nextSeed() {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

// sfc32：轻量确定性 PRNG。
function sfc32(a, b, c, d) {
  let x = a >>> 0;
  let y = b >>> 0;
  let z = c >>> 0;
  let w = d >>> 0;
  return function next() {
    const t = (x + y + w) >>> 0;
    x = (y ^ (y >>> 9)) >>> 0;
    y = (z + (z << 3)) >>> 0;
    z = ((z << 21) | (z >>> 11)) >>> 0;
    w = (w + 1) >>> 0;
    const result = (t + w) >>> 0;
    z = (z + result) >>> 0;
    return result / 4294967296;
  };
}

// 输入字符串 → 稳定随机流；同输入必定同序列。
function createRng(seedText) {
  const seed = xmur3(String(seedText));
  const next = sfc32(seed(), seed(), seed(), seed());
  // 丢掉前几轮，降低相邻种子的相关性。
  for (let i = 0; i < 6; i += 1) next();
  return {
    next,
    int(maxExclusive) {
      if (maxExclusive <= 0) return 0;
      return Math.floor(next() * maxExclusive);
    },
    pick(list) {
      return list[Math.floor(next() * list.length)];
    },
    float(min, max) {
      return min + next() * (max - min);
    },
    bool(probability = 0.5) {
      return next() < probability;
    },
  };
}

module.exports = { sha256Hex, stableStringify, xmur3, sfc32, createRng };
