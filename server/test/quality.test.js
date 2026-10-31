'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { scoreWorldPost, QUALITY_FEED_MIN, FILLER_PHRASES } = require('../src/quality');

test('水词表不少于 20 条，阈值在 0..1 内', () => {
  assert.ok(FILLER_PHRASES.length >= 20);
  assert.ok(QUALITY_FEED_MIN > 0 && QUALITY_FEED_MIN <= 1);
});

test('典型空话得低分，被过滤线挡下', () => {
  for (const text of [
    '今天天气真好，好开心，美好的一天，分享一下',
    '大家好呀，元气满满，今天也要加油，碎碎念',
    '岁月静好，人间值得，保持热爱，开心每一天',
  ]) {
    assert.ok(scoreWorldPost(text) < QUALITY_FEED_MIN, `空话应低分：${text} → ${scoreWorldPost(text)}`);
  }
});

test('带事件 / 对象 / 立场的帖子得高分', () => {
  const text = '刚刚把拖了 3 天的方案改完第 2 版，因为换了数据结构，接口耗时从 800ms 降到 120ms，我觉得这个决定是对的';
  assert.ok(scoreWorldPost(text) >= 0.6, `具体帖子应高分：${scoreWorldPost(text)}`);
});

test('命中水词但有具体信息时不会被重罚到过滤线下', () => {
  // 含「分享一下」，但带数字、时间与立场，应留在时间线。
  const text = '分享一下今天 3 点的实验结果：第 5 组样本的误差已经降到 2%，我觉得方向对了';
  assert.ok(scoreWorldPost(text) >= QUALITY_FEED_MIN);
});

test('长度边界：过短低分，15–120 字满分带', () => {
  assert.ok(scoreWorldPost('短') < QUALITY_FEED_MIN, '过短内容应低分');
  // 恰好 15 字、带具体信息的帖子进入满分带（14 字版落在短内容档）。
  const fourteen = '1' + '跑'.repeat(13);
  const fifteen = '1' + '跑'.repeat(14);
  assert.ok(fourteen.length === 14 && fifteen.length === 15);
  assert.ok(scoreWorldPost(fifteen) > scoreWorldPost(fourteen));
  // 长文不抛错且分值仍在 0..1。
  const long = '因为'.concat('这是一件需要长期坚持的小事，'.repeat(30));
  const score = scoreWorldPost(long);
  assert.ok(score >= 0 && score <= 1);
});

test('空字符串与非字符串输入不抛错，返回 0', () => {
  assert.equal(scoreWorldPost(''), 0);
  assert.equal(scoreWorldPost('   '), 0);
  assert.equal(scoreWorldPost(null), 0);
  assert.equal(scoreWorldPost(undefined), 0);
  assert.equal(scoreWorldPost(42), 0);
});
