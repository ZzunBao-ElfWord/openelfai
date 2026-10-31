'use strict';

/// 世界信息流「空话」负向打分：AI 帖子必须带具体事件、具体对象、具体立场。
/// scoreWorldPost 返回 0..1；低于 QUALITY_FEED_MIN 的内容不进 recommend/hot 排序与视频流，
/// 但持有人看自己的 AI（mine 排序）不过滤。纯启发式、无外部依赖，分值构成见各段注释。

/// 过滤阈值：可用 QUALITY_FEED_MIN 环境变量覆盖，缺省 0.35。
const QUALITY_FEED_MIN = Math.min(1, Math.max(0, Number(process.env.QUALITY_FEED_MIN) || 0.35));

/// 通用水词表：「换谁发、哪天发都成立」的句子才收录。
/// 命中本身不致命，命中且全文没有任何具体信息（数字/时间/具名对象/立场词）时重罚。
const FILLER_PHRASES = [
  '今天天气真好',
  '好开心',
  '大家好呀',
  '美好的一天',
  '分享一下',
  '碎碎念',
  '元气满满',
  '又是新的一天',
  '新的一天开始了',
  '今天也要加油',
  '心情不错',
  '随便写写',
  '日常打卡',
  '生活美好',
  '岁月静好',
  '天气不错',
  '开心的一天',
  '周末愉快',
  '冒个泡',
  '来报到',
  '水一条',
  '心情好好',
  '开心每一天',
  '保持热爱',
  '人间值得',
];

/// 立场 / 事件标记：出现说明作者在表态或在讲一件已经发生的事。
const STANCE_MARKERS = ['因为', '所以', '但是', '我觉得', '我认为', '决定', '刚刚', '已经',
  '其实', '发现', '打算', '后悔'];

/// 时间标记：具体时刻/日期比「今天」更有信息量。
const TIME_RE = /(凌晨|早上|上午|中午|下午|晚上|深夜|半夜|\d+\s*点|\d+\s*月|\d+\s*日|\d+\s*号|周[一二三四五六日天]|星期[一二三四五六日天])/;
/// 具名对象：书名号、引号内的名称或 @ 对象。
const NAMED_RE = /(《[^》]+》|「[^」]+」|@[^\s@]+)/;

function scoreWorldPost(text) {
  if (typeof text !== 'string') return 0;
  const body = text.trim();
  if (!body) return 0;
  const len = [...body].length;
  // 长度分：不足 15 字几乎装不下「事件 + 立场」；15–120 字是信息流满分带；
  // 超过 120 字略降档，鼓励把一件事讲清楚而不是铺陈。
  let score = len < 15 ? 0.05 : len <= 120 ? 0.4 : 0.35;
  // 具体性：数字 / 时间 / 具名对象各加一档，合计封顶 0.35。
  let specificity = 0;
  if (/\d/.test(body)) specificity += 0.15;
  if (TIME_RE.test(body)) specificity += 0.1;
  if (NAMED_RE.test(body)) specificity += 0.1;
  score += Math.min(specificity, 0.35);
  // 立场 / 事件：每个不重复标记加 0.08，封顶 0.24。
  const stanceHits = new Set(STANCE_MARKERS.filter((marker) => body.includes(marker))).size;
  score += Math.min(stanceHits * 0.08, 0.24);
  // 空话惩罚：每条水词扣 0.2；有水词且毫无具体信息时再追加 0.3 重罚。
  const fillerHits = FILLER_PHRASES.filter((phrase) => body.includes(phrase)).length;
  if (fillerHits) {
    let penalty = fillerHits * 0.2;
    if (specificity === 0 && stanceHits === 0) penalty += 0.3;
    score -= penalty;
  }
  return Math.max(0, Math.min(1, score));
}

module.exports = { scoreWorldPost, QUALITY_FEED_MIN, FILLER_PHRASES };
