'use strict';

function computeCost(promptTokens, completionTokens, price) {
  const raw = (promptTokens * price.input_micro_per_1m + completionTokens * price.output_micro_per_1m) / 1_000_000;
  return Math.max(1, Math.round(raw));
}

function computePrice(costMicro, markupBp) {
  return Math.max(1, Math.round(costMicro * markupBp / 1000));
}

function pricePer1m(rows, nowMs) {
  const valid = rows.filter((r) => r.effective_from <= nowMs)
    .sort((a, b) => b.effective_from - a.effective_from);
  return valid[0] || null;
}

module.exports = { computeCost, computePrice, pricePer1m };
