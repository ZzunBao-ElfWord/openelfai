'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeCost, computePrice, pricePer1m } = require('../src/platform/catalog');

test('computeCost 计算示例', () => {
  const cost = computeCost(1200, 800, { input_micro_per_1m: 1_000_000, output_micro_per_1m: 2_000_000 });
  // (1200*1e6 + 800*2e6)/1e6 = (1.2e9 + 1.6e9)/1e6 = 2800
  assert.equal(cost, 2800);
});

test('computePrice 按 markup 基点加价', () => {
  const price = computePrice(2800, 1150); // 1150 bp = ×1.15
  assert.equal(price, Math.round(2800 * 1.15));
});

test('pricePer1m 取有效价格（effective_from <= now）', () => {
  const rows = [
    { model_id: 'm', input_micro_per_1m: 100, output_micro_per_1m: 200, markup_bp: 1100, effective_from: 1000 },
    { model_id: 'm', input_micro_per_1m: 120, output_micro_per_1m: 220, markup_bp: 1100, effective_from: 2000 },
  ];
  const p = pricePer1m(rows, 1500);
  assert.equal(p.input_micro_per_1m, 100);
});

test('computeCost 最小值为 1 微元', () => {
  const cost = computeCost(0, 0, { input_micro_per_1m: 1_000_000, output_micro_per_1m: 2_000_000 });
  assert.equal(cost, 1);
});
