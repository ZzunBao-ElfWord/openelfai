'use strict';
const fs = require('node:fs');
const path = require('node:path');
const deltas = JSON.parse(fs.readFileSync(path.join(__dirname, 'resource-delta.json'), 'utf8'));
function applyResourceDelta(input, reverse = false) {
  const output = { ...input };
  const operations = reverse ? [...deltas].reverse() : deltas;
  for (const delta of operations) {
    if (!['app', 'commerce', 'gateway'].includes(delta.key)) throw new Error('未知补丁目标');
    const source = output[delta.key];
    if (typeof source !== 'string') throw new Error('缺少资源补丁目标文件');
    const variants = [delta, ...(delta.variants || [])];
    const applicable = variants.filter(item => source.includes(reverse ? item.after : item.before) || source.includes(reverse ? item.before : item.after));
    if (applicable.length !== 1) throw new Error('资源/出款补丁第' + (deltas.indexOf(delta) + 1) + '段与现有 ' + delta.key + ' 不匹配或存在歧义，停止，未修改服务器；需人工核对上下文');
    const selected = applicable[0];
    const before = reverse ? selected.after : selected.before;
    const after = reverse ? selected.before : selected.after;
    const count = source.split(before).length - 1;
    if (count === 1) output[delta.key] = source.replace(before, after);
    else if (count === 0 && source.split(after).length === 2) continue;
    else throw new Error('资源/出款补丁与现有 ' + delta.key + ' 不匹配，停止，未修改服务器；需人工核对上下文');
  }
  return output;
}
module.exports = { applyResourceDelta };
