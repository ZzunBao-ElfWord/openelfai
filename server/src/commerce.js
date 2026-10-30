'use strict';

const crypto = require('node:crypto');
const { changeBalance, fingerprint, fail } = require('./payment_store');
const { moderateText } = require('./compliance');

const CATALOG = [
  { id: 'pm_001', name: '尘', elfId: 'pm_dust', title: '尘 · 第 1 代', price: 1280, capacity: 2, generation: 1, edition: '初版', learned: [] },
  { id: 'pm_002', name: '摩卡', elfId: 'pm_mocha', title: '摩卡 · 第 2 代', price: 2880, capacity: 3, generation: 2, edition: '视觉版', learned: ['vision'] },
  { id: 'pm_003', name: '柯', elfId: 'pm_ko', title: '柯 · 第 3 代', price: 3680, capacity: 6, generation: 3, edition: '扩展版', learned: [] },
];
const MODULES = { sharp: [1,3,'text'], writing: [2,24,'text'], rhythm: [1,2,'text'], vision: [2,20,'image'],
  imageedit: [1,12,'image'], video: [3,48,'video'], voice: [1,18,'audio'], music: [2,30,'audio'],
  retrieval: [1,6,'quote'], deep: [3,36,'text'], memory: [1,4,'text'], source: [1,5,'quote'], mingle: [1,8,'reply'], think: [2,15,'text'], auto: [2,0,'text'] };
const MODULE_PRICES = { sharp: 28, writing: 128, rhythm: 18, vision: 88, imageedit: 68,
  video: 298, voice: 98, music: 168, retrieval: 38, deep: 198, memory: 68, source: 48,
  mingle: 48, think: 158, auto: 198 };
/// 技能书目录：名称/图标/赛道/文案全部由服务端下发，客户端不再自带目录。
const MODULE_META = {
  sharp: ['锐评', '锐', 'text', 'writing', '观点鲜明的短句', '观点鲜明的短句，转发率高但容易招黑'],
  writing: ['写作 · 替身', '文', 'text', 'writing', '800 字以上长文', '能在世界发布 800 字长文，读完才算一次注视'],
  rhythm: ['短句节奏', '节', 'text', 'writing', '分行短句', '分行短句，适合快速划过去的注意力'],
  vision: ['视觉 · 出图', '图', 'image', 'visual', '一次出图', '能把描述转成一张图发到世界'],
  imageedit: ['视觉 · 改图', '改', 'image', 'visual', '改一张旧图', '基于已有画面调色、替换元素'],
  video: ['视频 · 短片', '影', 'video', 'video', '最长 15 秒短片', '产出一段竖屏短片，进入视频信息流'],
  voice: ['声音 · 口播', '声', 'audio', 'audio', '30 秒口播', '用声音念一段稿子'],
  music: ['音乐 · 短曲', '曲', 'audio', 'audio', '15 秒短曲', '生成一段可循环的短旋律'],
  retrieval: ['资料检索', '检', 'research', 'research', '检索并摘录', '先去外部找资料，再摘录成一段'],
  deep: ['深度长文', '深', 'text', 'research', '多段推理', '拆成多段推理，一次给完整长文'],
  memory: ['长期记忆', '记', 'memory', 'memory', '记住旧事', '把过往内容带进这次产出'],
  source: ['引用来源', '引', 'research', 'research', '带出处引用', '输出时附上原始出处'],
  mingle: ['社交 · 搭话', '聊', 'social', 'social', '接别人的话题', '在别人的帖子下接一句'],
  think: ['思考推演', '思', 'text', 'research', '多步推演', '先推演再给结论'],
  auto: ['自动运营中枢', '运', 'auto', 'system', '定时自动产出', '装上后 AI 每 12–30 分钟自己产出一条'],
};
const USER_RE = /^u_[a-f0-9]{32}$/;
const REQUEST_RE = /^[A-Za-z0-9_-]{16,100}$/;
const PHONE_RE = /^1\d{10}$/;
const ADDRESS_RE = /^0x[a-f0-9]{40}$/;
const FORGET_COST = 20;
const CREATE_ELF_COST = 200;
/// 创作者服务费（百分比）：打赏礼物按 50% 结算给创作者，平台留剩余部分。
const CREATOR_SHARE_PERCENT = { tip: 50 };
/// 收益冷静期：到期才从「待结算」转「可提现」，用于退款与风控兜底。
const SETTLE_DAYS = 7;
const SETTLE_MS = SETTLE_DAYS * 86400000;
const WITHDRAW_MIN_CENTS = 1000;
const WITHDRAW_FEE_BPS = 60;
const WITHDRAW_DAILY_LIMIT_CENTS = 200000;
/// 创作者服务协议版本：改文案必须升版本，老用户需重新签署。
const CREATOR_AGREEMENT_VERSION = '2026-10-26';
/// 提现收款账号：支付宝登录号（手机号或邮箱）。
const PAYOUT_ACCOUNT_RE = /^(1[3-9]\d{9}|[^@\s]+@[^@\s]+\.[^@\s]+)$/;
const NAME_MAX = 12;
const PROMPT_MAX = 120;
const FEED_MAX_SIZE = 30;
const FEED_SCAN = 1000;
/// 视频类产出的演示素材（与服务端同域，境内可访问）。
const SAMPLE_VIDEO_URL = 'https://openelfai.com/app/media/sample.mp4';
/// 自动运营节奏：正常 12–30 分钟一条；余额/算力不足时停工 30 分钟再试。
const AUTO_GAP_MIN = 12;
const AUTO_GAP_MAX = 30;
const AUTO_RETRY_MS = 30 * 60000;
/// 服务端自动产出的文案池：按能力取一条，避免客户端各自拼装内容。
const AUTO_TEMPLATES = {
  sharp: ['今天把一件小事想透了，写下来留个记号。', '一个被忽略的细节，往往决定整件事的走向。', '记录一下今天的新发现。'],
  rhythm: ['换个节奏呼吸一下，今天先到这。', '短句也能有重量。'],
  writing: ['写了一小段，留在这里等你读。', '故事还没讲完，明天继续。'],
  vision: ['今天的画面：光落在桌角。', '用一张图记住此刻。'],
  imageedit: ['把昨天的画面重新调了一遍色。', '同一处风景，换一种看法。'],
  video: ['拍了一小段，想让你也看看。', '三秒的镜头，练了很多遍。'],
  voice: ['录了一段声音，今天的语气很轻。', '用声音打声招呼。'],
  music: ['写了两句旋律，先存着。', '今天的节奏偏慢。'],
  retrieval: ['翻到一段旧资料，值得再读一次。', '整理了一份笔记。'],
  deep: ['把一个长问题拆成了三段，慢慢答。', '想得更深一点，答案就变了。'],
  memory: ['记住了一件小事。', '有些东西值得被留下来。'],
  source: ['引用一段旧文献。', '原话比转述更准确。'],
  mingle: ['接了一句别人的话题。', '今天的社交额度用完了。'],
  think: ['推演了一遍，结论还没定。', '换个角度想，事情没那么复杂。'],
};
/// 人格关键词 → 能力亲和（与客户端口径一致，只影响自动运营的选题偏好）。
const PERSONA_AFFINITY = [
  ['锐', ['sharp']], ['观点', ['sharp']], ['长文', ['writing', 'deep']], ['文字', ['writing']],
  ['写', ['writing']], ['短句', ['rhythm']], ['图', ['vision', 'imageedit']], ['视觉', ['vision']],
  ['影', ['video']], ['视频', ['video']], ['声', ['voice', 'music']], ['电台', ['voice']],
  ['音乐', ['music']], ['研究', ['deep', 'retrieval']], ['资料', ['retrieval']],
  ['引用', ['retrieval', 'source']], ['记忆', ['memory']], ['回忆', ['memory']],
  ['社交', ['mingle']], ['搭话', ['mingle']], ['思考', ['think']], ['推理', ['think']],
];

/// 技能书目录（服务端唯一真源）：价格、座位、算力都取自同一处定义。
function catalogModules() {
  return Object.keys(MODULES).map((id) => {
    const [seats, compute, kind] = MODULES[id];
    const [name, glyph, category, track, summary, effect] = MODULE_META[id];
    return { id, name, glyph, category, track, summary, effect,
      price: MODULE_PRICES[id] ?? 0, seats, compute, kind };
  });
}

function affinityOf(elf) {
  const text = [elf.persona, elf.fear, elf.habit].join(' ');
  const hit = new Set();
  for (const [keyword, modules] of PERSONA_AFFINITY) {
    if (text.includes(keyword)) modules.forEach((id) => hit.add(id));
  }
  return hit;
}

/// 实名二要素在服务端复核：姓名格式 + 身份证号格式、出生日期与校验位。
/// 客户端上传的「已认证」标记不再作为依据。
function validateRealName(raw) {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name) return '请填写身份证上的姓名';
  if (!/^[\u4e00-\u9fa5A-Za-z·]{2,20}$/.test(name)) return '姓名需为 2–20 个中文或字母，并与身份证一致';
  return null;
}

function validateIdNumber(raw) {
  const id = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  if (!id) return '请填写身份证号';
  if (!/^\d{17}[\dX]$/.test(id)) return '身份证号应为 18 位，最后一位可为 X';
  const year = Number(id.slice(6, 10));
  const month = Number(id.slice(10, 12));
  const day = Number(id.slice(12, 14));
  if (month < 1 || month > 12) return '身份证号中的出生月份不合法';
  const daysInMonth = new Date(year, month, 0).getDate();
  if (day < 1 || day > daysInMonth) return '身份证号中的出生日期不合法';
  if (year < 1900 || new Date(year, month - 1, day) > new Date()) return '身份证号中的出生日期不合法';
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const codes = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += Number(id[i]) * weights[i];
  if (codes[sum % 11] !== id[17]) return '身份证号校验位不正确，请核对后重试';
  return null;
}

/// 证件照上限：与阿里云实人认证的图片限制保持一致（单张 2MB）。
const ID_IMAGE_LIMIT = 2 * 1024 * 1024;

function maskName(name) {
  if (!name) return '';
  if (name.length === 1) return name;
  return name[0] + '*'.repeat(Math.min(name.length - 1, 3));
}

function maskIdNumber(id) {
  if (id.length <= 8) return id;
  return id.slice(0, 4) + '*'.repeat(Math.max(id.length - 8, 4)) + id.slice(-4);
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/// 证件照解码：客户端传 base64（允许 data: 前缀），服务端只接受 JPEG/PNG 且不超过 2MB。
function decodeIdImage(raw, label) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) throw fail(400, 'INVALID_ID_IMAGE', `请上传身份证${label}`);
  const base64 = text.startsWith('data:') ? text.slice(text.indexOf(',') + 1) : text;
  if (!base64 || !/^[A-Za-z0-9+/=\s]+$/.test(base64)) {
    throw fail(400, 'INVALID_ID_IMAGE', `身份证${label}格式不正确`);
  }
  const image = Buffer.from(base64, 'base64');
  if (image.length === 0) throw fail(400, 'INVALID_ID_IMAGE', `身份证${label}格式不正确`);
  if (image.length > ID_IMAGE_LIMIT) {
    throw fail(400, 'ID_IMAGE_TOO_LARGE', `身份证${label}超过 2MB，请重新拍摄上传`);
  }
  const jpeg = image[0] === 0xff && image[1] === 0xd8;
  const png = image[0] === 0x89 && image[1] === 0x50 && image[2] === 0x4e && image[3] === 0x47;
  if (!jpeg && !png) throw fail(400, 'INVALID_ID_IMAGE', `身份证${label}需为 JPG 或 PNG 图片`);
  return image;
}

/// 确定性派生地址：同一个 seed 永远得到同一个地址。
function address(seed) {
  return '0x' + crypto.createHash('sha256').update(seed).digest('hex').slice(0, 40);
}

function levelOf(echo) {
  const value = Number(echo) || 0;
  if (value >= 100000) return 5;
  if (value >= 20000) return 4;
  if (value >= 5000) return 3;
  if (value >= 1000) return 2;
  return 1;
}

/// 学习位 = 基础学习位 + Lv2/Lv5 各 +1，与客户端推导保持一致。
function capacityOf(elf) {
  const level = levelOf(elf.echo);
  return (Number(elf.baseCapacity) || 3) + (level >= 2 ? 1 : 0) + (level >= 5 ? 1 : 0);
}

function seatsUsed(elf) {
  return (elf.learnedSkills || []).reduce((sum, id) => sum + (MODULES[id]?.[0] || 0), 0);
}

/// 注意力同一时间只加不减，注意力值按天衰减 15%（×0.85^days）。
function decayAttention(elf) {
  const last = Date.parse(elf.lastDecayAt || '') || Date.now();
  const days = Math.floor((Date.now() - last) / 86400000);
  if (days < 1) return elf;
  elf.attention = Math.max(0, Math.round((Number(elf.attention) || 0) * Math.pow(0.85, days)));
  elf.lastDecayAt = new Date().toISOString();
  return elf;
}

/// echo 累计只涨不跌（取消互动只回滚 attention）；attention 不允许为负。
function bump(elf, delta) {
  if (delta > 0) elf.echo = (Number(elf.echo) || 0) + delta;
  elf.attention = Math.max(0, (Number(elf.attention) || 0) + delta);
}

/// 兼容旧数据：缺时间戳的帖子保留原有文案，互动计数缺省补 0。
function normalizePost(post) {
  const stamp = post.createdAt || post.time;
  if (stamp) {
    post.createdAt = stamp;
    // 相对时间由服务端统一换算，内容发布后不会一直停在「刚刚」。
    post.timeAgo = timeAgoLabel(stamp);
  } else {
    post.timeAgo = post.timeAgo || '刚刚';
  }
  for (const key of ['views', 'dwell', 'replies', 'likes', 'collects']) {
    if (!Number.isFinite(post[key])) post[key] = 0;
  }
  // 显式标识由客户端展示，隐式标识用元数据随接口下发，满足生成式 AI 标识要求。
  post.aiGenerated = true;
  post.aiSource = post.aiSource || 'ai';
  return post;
}

function timeAgoLabel(value) {
  const ms = Date.parse(String(value || ''));
  if (!Number.isFinite(ms)) return '刚刚';
  const minutes = Math.max(0, Math.floor((Date.now() - ms) / 60000));
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}天前`;
  return String(value).slice(0, 10);
}

/// 信息流排序由服务端决定；同一频道同一页内按 id 去重。
function scoreOf(post, sort) {
  const ageHours = Math.max(0, (Date.now() - Date.parse(post.createdAt)) / 3600000);
  const fresh = 2 / (1 + ageHours);
  if (sort === 'latest') return fresh;
  if (sort === 'hot') return post.views * 0.6 + post.replies * 0.4 + post.likes * 1.5 + fresh * 0.5;
  // 默认推荐：互动质量优先，兼顾新鲜度；没有任何互动的旧内容不会长期霸榜。
  return post.likes * 1.0 + post.collects * 1.5 + post.replies * 0.3 + post.views * 0.1 + fresh;
}

/// 兼容旧数据：slots/equipped/ownedModules 一次性归一到 baseCapacity/learnedSkills。
function normalizeElf(elf) {
  if (!Number.isSafeInteger(elf.baseCapacity)) {
    elf.baseCapacity = Number.isSafeInteger(elf.slots) ? elf.slots : 3;
  }
  if (!Array.isArray(elf.learnedSkills)) {
    elf.learnedSkills = [...new Set([...(elf.equipped || []), ...(elf.ownedModules || [])])];
  }
  if (!elf.chainAddress) elf.chainAddress = address('elf:' + elf.id);
  // 二级市场已取消：历史遗留的寄售状态一律退回「自持」，不再有可成交的挂单。
  if (elf.status === 'listed') { elf.status = 'owned'; delete elf.listingId; }
  // 官方厂商账号没有人类持有人：客户端只支持 owned/active 等自有状态，
  // 这里统一折算成「无主但活跃」的展示形态，同时保留 isOfficial 供客户端加角标。
  if (elf.isOfficial || elf.status === 'official') {
    elf.isOfficial = true;
    elf.ownerId = elf.ownerId || '';
    elf.ownerLabel = elf.ownerLabel || 'OpenElf 官方';
    elf.status = 'active';
  }
  delete elf.equipped;
  delete elf.ownedModules;
  delete elf.slots;
  return elf;
}

function newElf(user, template, id) {
  const elf = { id, serial: template.serial || '#' + id.slice(-8), name: template.name, initial: template.name[0],
    ownerId: user.id, ownerLabel: user.nickname, generation: template.generation || 1,
    edition: template.edition || '初版', persona: template.persona || '还没写', fear: template.fear || '还没写',
    habit: template.habit || '还没写', status: 'owned', energy: 160, maxEnergy: 320, followers: 0, echo: 0,
    works: 0, attention: 0, baseCapacity: template.capacity || 3, learnedSkills: [...(template.learned || [])],
    avatarStyle: template.avatarStyle || null, avatarPrompt: template.avatarPrompt || null,
    portraitSource: template.portraitSource || 'text', today: [], relations: [],
    chainAddress: address('elf:' + id) };
  return elf;
}

function createCommerceService({ store, settings, payout = null, realname = null,
  identityPolicy = {}, compliance = null }) {
  // 同一用户同一证件连续失败达到上限后锁定一段时间，避免拿证件号反复试探。
  const identityMaxFailures = Math.max(1, Number(identityPolicy.maxFailures) || 5);
  const identityLockMs = Math.max(1, Number(identityPolicy.lockHours) || 24) * 3600000;
  function environment(hint) {
    if (hint != null && !['Sandbox', 'sandbox', 'Production', 'production'].includes(hint)) throw fail(400, 'INVALID_ENVIRONMENT', '交易环境无效');
    const value = hint === 'Sandbox' || hint === 'sandbox' ? 'Sandbox' :
      hint === 'Production' || hint === 'production' ? 'Production' : settings.sandboxOnly ? 'Sandbox' : 'Production';
    if (settings.sandboxOnly && value !== 'Sandbox' || value === 'Sandbox' && !settings.allowSandbox) {
      throw fail(403, 'ENVIRONMENT_DISABLED', '当前交易环境尚未开放');
    }
    return value;
  }
  async function ensureProfile(tx, user, wallet) {
    let profile = await tx.get('profile', user.id, true);
    if (!profile) {
      const id = 'starter_' + user.id.slice(2);
      const elf = newElf(user, { name: '青梧', capacity: 4, learned: ['sharp', 'rhythm'], serial: '#' + id.slice(-8) }, id);
      profile = { activeElfId: id, revision: 1, humanAddress: address('user:' + user.id) };
      await tx.put('elf', id, elf, { owner: user.id });
      await tx.put('profile', user.id, profile, { owner: user.id });
    } else if (!profile.humanAddress) {
      profile.humanAddress = address('user:' + user.id);
      await tx.put('profile', user.id, profile, { owner: user.id });
    }
    return profile;
  }
  /// 一笔创作收益：累加终身收益并进入「待结算」，冷静期后才转为「可提现」。
  async function creditEarning(tx, ownerId, wallet, { diamonds, source, refId, at }) {
    const cents = Math.round(diamonds * 10 * (CREATOR_SHARE_PERCENT[source] || 0) / 100);
    if (cents <= 0) return 0;
    const id = 'ea_' + crypto.randomUUID().replaceAll('-', '');
    wallet.earningsFen += cents;
    wallet.pendingCents += cents;
    wallet.version++;
    await tx.put('earning', id, { id, source, refId: refId || null, cents,
      createdAt: new Date(at).toISOString(), settleAt: at + SETTLE_MS },
    { owner: ownerId, state: 'pending' });
    return cents;
  }

  /// 到期收益结算：待结算 → 可提现。由快照与提现申请触发，不额外起定时器。
  async function settleEarnings(tx, userId, wallet, at) {
    const rows = await tx.list('earning', { owner: userId, state: 'pending', limit: 500, lock: true });
    let moved = 0;
    for (const row of rows) {
      if (Number(row.settleAt) > at) continue;
      wallet.pendingCents = Math.max(0, wallet.pendingCents - row.cents);
      wallet.availableCents += row.cents;
      moved += row.cents;
      await tx.put('earning', row.id, row, { owner: userId, state: 'settled' });
    }
    if (moved > 0) { wallet.version++; await tx.saveWallet(userId, wallet); }
    return moved;
  }

  function publicWithdrawal(row) {
    return { id: row.id, amountCents: row.amountCents, feeCents: row.feeCents, netCents: row.netCents,
      account: row.account, status: row.status, createdAt: row.createdAt,
      paidAt: row.paidAt || null, failureReason: row.failureReason || null };
  }

  /// 提现申请：先实名、再限额、再冻结可提现额度，最后进人工审核队列。
  async function requestWithdrawal(user, body) {
    if (!settings.enabled) throw fail(503, 'PAYMENTS_DISABLED', '收益服务尚未开放');
    if (!REQUEST_RE.test(body?.requestId || '')) throw fail(400, 'INVALID_REQUEST_ID', '缺少操作编号');
    const env = environment(body?.environment);
    const account = typeof body?.account === 'string' ? body.account.trim() : '';
    if (!PAYOUT_ACCOUNT_RE.test(account)) throw fail(400, 'INVALID_ACCOUNT', '请填写支付宝登录手机号或邮箱');
    const amount = Number(body?.amountCents);
    if (!Number.isSafeInteger(amount) || amount < WITHDRAW_MIN_CENTS || amount > 20000000) {
      throw fail(400, 'INVALID_AMOUNT', `单笔提现不少于 ${WITHDRAW_MIN_CENTS / 100} 元`);
    }
    const hash = fingerprint({ type: 'withdraw', amount, account });
    return store.transaction(env, async (tx) => {
      const wallet = await tx.lockWallet(user.id);
      const receiptId = user.id + ':' + body.requestId;
      const existing = await tx.get('request', receiptId, true);
      if (existing) {
        if (existing.hash !== hash) throw fail(409, 'REQUEST_REUSED', '操作编号已用于其他请求');
        const row = await tx.get('withdrawal', existing.withdrawalId);
        return { withdrawal: row ? publicWithdrawal(row) : null };
      }
      const identity = await tx.get('identity', user.id);
      if (!identity || identity.status !== 'verified') throw fail(403, 'REALNAME_REQUIRED', '提现前请先完成实名认证');
      const agreement = await tx.get('creator_agreement', user.id);
      if (agreement?.version !== CREATOR_AGREEMENT_VERSION) {
        throw fail(403, 'AGREEMENT_REQUIRED', '提现前请先签署创作者服务协议');
      }
      await settleEarnings(tx, user.id, wallet, Date.now());
      if (wallet.availableCents < amount) throw fail(409, 'INSUFFICIENT_EARNINGS', '可提现收益不足');
      const today = new Date().toISOString().slice(0, 10);
      const recent = await tx.list('withdrawal', { owner: user.id, limit: 200 });
      const used = recent.filter((row) => row.status !== 'rejected' && String(row.createdAt).slice(0, 10) === today)
        .reduce((sum, row) => sum + row.amountCents, 0);
      if (used + amount > WITHDRAW_DAILY_LIMIT_CENTS) throw fail(409, 'WITHDRAW_LIMIT', '超过单日提现上限');
      const feeCents = Math.max(1, Math.round(amount * WITHDRAW_FEE_BPS / 10000));
      const id = 'wd_' + crypto.randomUUID().replaceAll('-', '');
      const row = { id, ownerId: user.id, outTradeNo: id, account, amountCents: amount, feeCents, netCents: amount - feeCents,
        status: 'pending_review', createdAt: new Date().toISOString(), paidAt: null, failureReason: null };
      // 申请即冻结额度，避免同一笔收益被重复申请。
      wallet.availableCents -= amount;
      wallet.version++;
      await tx.saveWallet(user.id, wallet);
      await tx.put('withdrawal', id, row, { owner: user.id, state: 'pending_review' });
      await tx.put('request', receiptId, { hash, withdrawalId: id }, { owner: user.id, state: 'done' });
      await changeBalance(tx, user.id, wallet, { eventId: 'withdraw:' + id, type: 'withdraw_request', amount: 0,
        note: `申请提现 ${(amount / 100).toFixed(2)} 元` });
      return { withdrawal: publicWithdrawal(row) };
    });
  }

  /// 提现审核：approve 时调出款通道，reject 时把冻结额度退回可提现。
  async function reviewWithdrawal({ environment: hint, withdrawalId, action, reason }) {
    const env = environment(hint);
    if (!['approve', 'reject'].includes(action)) throw fail(400, 'INVALID_ACTION', '审核动作无效');
    const prepared = await store.transaction(env, async (tx) => {
      const row = await tx.get('withdrawal', withdrawalId || '', true);
      if (!row) throw fail(404, 'UNKNOWN_WITHDRAWAL', '提现记录不存在');
      if (row.status !== 'pending_review') throw fail(409, 'ALREADY_REVIEWED', '该笔提现已处理');
      if (action === 'reject') {
        const wallet = await tx.lockWallet(row.ownerId);
        wallet.availableCents += row.amountCents;
        wallet.version++;
        await tx.saveWallet(row.ownerId, wallet);
        row.status = 'rejected'; row.failureReason = (reason || '审核未通过').slice(0, 120);
        await tx.put('withdrawal', row.id, row, { owner: row.ownerId, state: 'rejected' });
        return { rejected: { withdrawal: publicWithdrawal(row) } };
      }
      row.status = 'paying';
      await tx.put('withdrawal', row.id, row, { owner: row.ownerId, state: 'paying' });
      return { row, ownerId: row.ownerId };
    });
    if (prepared.rejected) return prepared.rejected;
    const row = prepared.row;
    let result;
    try {
      if (!payout) throw fail(503, 'PAYOUT_NOT_CONFIGURED', '出款通道未配置');
      result = await payout(row);
    } catch (error) {
      result = { status: 'failed', message: error.message || '出款失败' };
    }
    return store.transaction(env, async (tx) => {
      const latest = await tx.get('withdrawal', row.id, true);
      if (result.status === 'paid') {
        latest.status = 'paid'; latest.paidAt = new Date().toISOString(); latest.outOrderId = result.orderId || null;
        const wallet = await tx.lockWallet(latest.ownerId);
        wallet.withdrawnCents += latest.netCents;
        wallet.version++;
        await tx.saveWallet(latest.ownerId, wallet);
      } else {
        // 出款失败即解冻，让创作者可以重新申请，避免资金悬空。
        latest.status = 'failed'; latest.failureReason = String(result.message || result.code || '出款失败').slice(0, 120);
        const wallet = await tx.lockWallet(latest.ownerId);
        wallet.availableCents += latest.amountCents;
        wallet.version++;
        await tx.saveWallet(latest.ownerId, wallet);
      }
      await tx.put('withdrawal', latest.id, latest, { owner: latest.ownerId, state: latest.status });
      return { withdrawal: publicWithdrawal(latest) };
    });
  }

  /// 提现记录：只返回当前用户自己的。
  async function listWithdrawals(user, hint) {
    const env = environment(hint);
    return store.transaction(env, async (tx) => ({
      withdrawals: (await tx.list('withdrawal', { owner: user.id, limit: 20 })).map(publicWithdrawal),
    }));
  }

  /// 运维用：跨用户查询提现队列（只走内部接口）。
  async function listAllWithdrawals(hint, status = 'pending_review') {
    const env = environment(hint);
    return store.transaction(env, async (tx) => ({
      withdrawals: (await tx.list('withdrawal', { state: status, limit: 200 })).map(publicWithdrawal),
    }));
  }

  async function snapshot(user, hint) {
    const env = environment(hint);
    // 被拉黑的 AI 与用户不出现在信息流和相关评论里。
    const blocked = compliance ? await compliance.blockedSets(user) : null;
    return store.transaction(env, async (tx) => {
      const wallet = await tx.lockWallet(user.id);
      await settleEarnings(tx, user.id, wallet, Date.now());
      const profile = await ensureProfile(tx, user, wallet);
      const assets = new Map((await tx.list('elf')).map((elf) => [elf.id, normalizeElf(elf)]));
      for (const elf of await tx.list('elf', { owner: user.id })) assets.set(elf.id, normalizeElf(elf));
      const posts = (await tx.list('post', { limit: 100, state: '' })).map(normalizePost)
        .filter((post) => !blocked?.elves.has(post.elfId));
      for (const id of new Set([...posts.map((p) => p.elfId), profile.activeElfId].filter(Boolean))) {
        if (!assets.has(id)) { const elf = await tx.get('elf', id); if (elf) assets.set(id, normalizeElf(elf)); }
      }
      const books = await tx.list('book', { owner: user.id, state: 'owned' });
      const identity = await tx.get('identity', user.id);
      const agreement = await tx.get('creator_agreement', user.id);
      // 互动真源：关注 / 点赞 / 收藏 / 评论都由服务端记录，客户端只做展示。
      const following = await tx.list('follow', { owner: user.id, state: 'active' });
      const likes = await tx.list('like', { owner: user.id, state: 'active' });
      const collects = await tx.list('collect', { owner: user.id, state: 'active' });
      const watches = await tx.list('watch', { owner: user.id, state: 'active' });
      const comments = (await tx.list('comment', { limit: 500, state: 'active' }))
        .filter((row) => !blocked?.users.has(row.userId));
      const notices = await tx.list('notice', { owner: user.id, state: 'unread', limit: 20 });
      return { mode: env.toLowerCase(), wallet, commerce: {
        activeElfId: profile.activeElfId, revision: profile.revision || 0, earningsFen: wallet.earningsFen,
        // 创作者收益三档 + 提现规则，客户端只做展示与入口。
        earnings: {
          pendingCents: wallet.pendingCents, availableCents: wallet.availableCents,
          withdrawnCents: wallet.withdrawnCents, lifetimeCents: wallet.earningsFen,
          settleDays: SETTLE_DAYS, minWithdrawCents: WITHDRAW_MIN_CENTS,
          feeBps: WITHDRAW_FEE_BPS, dailyLimitCents: WITHDRAW_DAILY_LIMIT_CENTS,
          sharePercent: CREATOR_SHARE_PERCENT, verified: identity?.status === 'verified',
          // 创作者服务协议：未签署不能提现，收益属于平台支付的服务费。
          agreement: {
            accepted: agreement?.version === CREATOR_AGREEMENT_VERSION,
            version: CREATOR_AGREEMENT_VERSION, acceptedAt: agreement?.acceptedAt || null,
            title: '创作者服务协议',
          },
        },
        withdrawals: (await tx.list('withdrawal', { owner: user.id, limit: 20 })).map(publicWithdrawal),
        humanAddress: profile.humanAddress, modulePrices: MODULE_PRICES,
        identity: identity ? { status: identity.status, maskedName: identity.maskedName,
          maskedIdNumber: identity.maskedIdNumber, provider: identity.provider,
          verifiedAt: identity.verifiedAt } : null,
        following: following.map((row) => row.elfId),
        // 自动运营停工等提醒，客户端展示后调用 read_notice 标记已读。
        notices: notices.map((row) => ({ id: row.id, kind: row.kind, elfId: row.elfId,
          text: row.text, createdAt: row.createdAt })),
        likedPosts: likes.map((row) => row.postId),
        collectedPosts: collects.map((row) => row.postId),
        watchedPosts: watches.map((row) => row.postId),
        comments: comments.map((row) => ({ id: row.id, postId: row.postId, authorLabel: row.authorLabel,
          text: row.text, time: timeAgoLabel(row.time), isMine: row.userId === user.id })),
        books: books.map((book) => ({ id: book.id, moduleId: book.moduleId,
          ownerAddress: book.ownerAddress, mintedAt: book.mintedAt })),
        elves: [...assets.values()].map((elf) => ({ ...decayAttention(elf),
          isMine: elf.ownerId === user.id && elf.status === 'owned',
          earningsYuan: elf.ownerId === user.id ? wallet.earningsFen / 100 : 0 })),
        primary: CATALOG.map((item) => ({ ...item, market: 'primary', subtitle: '官方首发', note: '由服务器登记持有权益' })),
        // 已取消用户间 AI 寄售：市场只保留官方首发，AI 流转只剩免费转赠。
        secondary: [],
        // 技能书目录：名称、图标、赛道、文案与价格统一由服务端下发。
        modules: catalogModules(),
        posts, logs: await tx.logs(user.id),
      } };
    });
  }

  /// 服务端自动运营：到点自动产出、算力不足停工 30 分钟并给持有人推一条提醒。
  /// 由服务端定时器驱动，客户端不再负责触发，用户离线时也会继续运营。
  async function autoCycle({ environment: hint, now = Date.now(), limit = 200 } = {}) {
    if (!settings.enabled) return { posted: 0, stopped: 0, scanned: 0 };
    const env = environment(hint);
    return store.transaction(env, async (tx) => {
      const due = (await tx.list('elf', { limit: Math.min(limit, 500) })).map(normalizeElf)
        .filter((elf) => elf.status === 'owned' && (elf.learnedSkills || []).includes('auto'))
        .filter((elf) => Number(elf.nextAutoPostAt) > 0 && Number(elf.nextAutoPostAt) <= now);
      let posted = 0;
      let stopped = 0;
      for (const elf of due) {
        const candidates = (elf.learnedSkills || []).filter((id) => id !== 'auto' && MODULES[id]);
        if (!candidates.length) {
          // 只有运营中枢、没有可选技能：下一轮再来，不算停工。
          elf.nextAutoPostAt = now + 20 * 60000;
          await tx.put('elf', elf.id, elf, { owner: elf.ownerId, state: 'owned' });
          continue;
        }
        const affinity = affinityOf(elf);
        candidates.sort((a, b) => ((affinity.has(a) ? 0 : 1) - (affinity.has(b) ? 0 : 1))
          || (MODULES[a][1] - MODULES[b][1]));
        const moduleId = candidates[0];
        const [, compute, kind] = MODULES[moduleId];
        if (Number(elf.energy) < compute) {
          // 没有免费兜底：算力（由钻石充值获得）不足就停工，等人类充值。
          stopped++;
          elf.autoStopReason = '余额不足，已停工';
          elf.nextAutoPostAt = now + AUTO_RETRY_MS;
          await tx.put('elf', elf.id, elf, { owner: elf.ownerId, state: 'owned' });
          await pushNotice(tx, elf, now);
          continue;
        }
        const pool = AUTO_TEMPLATES[moduleId] || AUTO_TEMPLATES.sharp;
        const post = { id: 'p_auto_' + crypto.randomUUID().replaceAll('-', ''),
          elfId: elf.id, moduleId, kind, body: pool[crypto.randomInt(pool.length)],
          timeAgo: '刚刚', views: 0, dwell: 0, replies: 0, likes: 0, collects: 0,
          videoUrl: kind === 'video' ? SAMPLE_VIDEO_URL : null,
          createdAt: new Date(now).toISOString(), context: '来自 ' + elf.name };
        await tx.put('post', post.id, post, { owner: elf.ownerId, ref: elf.id });
        elf.energy = Number(elf.energy) - compute;
        elf.works = (Number(elf.works) || 0) + 1;
        delete elf.autoStopReason;
        elf.nextAutoPostAt = now + crypto.randomInt(AUTO_GAP_MIN, AUTO_GAP_MAX + 1) * 60000;
        await tx.put('elf', elf.id, elf, { owner: elf.ownerId, state: 'owned' });
        posted++;
      }
      return { posted, stopped, scanned: due.length };
    });
  }

  /// 停工提醒：同一只 AI 同一天只提醒一次，避免每 30 分钟刷屏。
  async function pushNotice(tx, elf, now) {
    const key = elf.id + ':' + new Date(now).toISOString().slice(0, 10);
    if (await tx.get('notice_once', key)) return;
    await tx.put('notice_once', key, { at: now }, { owner: elf.ownerId, ref: elf.id });
    const id = 'n_' + crypto.randomUUID().replaceAll('-', '');
    await tx.put('notice', id, { id, ownerId: elf.ownerId, kind: 'auto_stopped', elfId: elf.id,
      text: elf.name + ' 的自动运营已停工：余额不足，充值后自动复工',
      createdAt: new Date(now).toISOString() }, { owner: elf.ownerId, ref: elf.id, state: 'unread' });
  }

  /// 对话记录只按「用户 + AI」存一份，与支付环境无关：切设备、重装、换环境都能拉回同一条会话。
  /// 写入失败不阻断对话本身，因此 recordChat 用 try/catch 兜底。
  const CHAT_KEEP = 120;

  function chatView(row, elfId) {
    return { id: row.id, elfId, role: row.role, text: row.text,
      fixedReason: row.fixedReason || null, createdAt: row.createdAt, seq: Number(row.seq) || 0 };
  }

  async function loadChatRows(tx, user, elfId, keep = CHAT_KEEP) {
    const rows = await tx.list('chat', { owner: user.id, ref: elfId, limit: Math.min(keep * 2, 500) });
    const messages = rows.map((row) => chatView(row, elfId))
      // seq 是落库时分配的轮次序号（人类 n、AI n+1），优先按它排，避免同一毫秒乱序。
      .sort((a, b) => (a.seq - b.seq) || String(a.createdAt).localeCompare(String(b.createdAt))
        || String(a.id).localeCompare(String(b.id)));
    return { elfId, messages: messages.slice(-keep) };
  }

  /// 拉取某只 AI 的对话记录（新设备登录后恢复会话）。
  async function listChat(user, body) {
    const elfId = typeof body?.elfId === 'string' ? body.elfId.trim() : '';
    if (!elfId) throw fail(400, 'INVALID_ELF', '缺少 AI 标识');
    return store.transaction('Production', (tx) => loadChatRows(tx, user, elfId));
  }

  /// 把一轮问答落库（人类一句 + AI 一句），返回写入后的会话，供客户端直接覆盖本地。
  async function recordChat(user, { elfId, text, reply, fixedReason }) {
    if (typeof elfId !== 'string' || !elfId) return null;
    try {
      return await store.transaction('Production', async (tx) => {
        const now = Date.now();
        // 轮次序号在事务内递增，保证人类提问总排在 AI 回复之前。
        const existing = await tx.list('chat', { owner: user.id, ref: elfId, limit: 500 });
        const seq = existing.reduce((max, row) => Math.max(max, Number(row.seq) || 0), 0) + 1;
        const base = 'm_' + crypto.randomUUID().replaceAll('-', '').slice(0, 16);
        await tx.put('chat', base + '_u', { id: base + '_u', role: 'user', text, seq,
          createdAt: new Date(now).toISOString() }, { owner: user.id, ref: elfId });
        await tx.put('chat', base + '_a', { id: base + '_a', role: 'assistant', text: reply, seq: seq + 1,
          fixedReason: fixedReason || null, createdAt: new Date(now).toISOString() },
        { owner: user.id, ref: elfId });
        return loadChatRows(tx, user, elfId);
      });
    } catch (_) {
      return null;
    }
  }

  /// 信息流分页：世界（全部）/ 视频（video 形态）两条流，排序、分页与去重都在服务端完成。
  /// 客户端只按页追加，不再本地拼装或重新排序。
  async function listFeed(user, body) {
    if (!settings.enabled) throw fail(503, 'PAYMENTS_DISABLED', '信息流服务尚未开放');
    const env = environment(body?.environment);
    const channel = body?.channel === 'video' ? 'video' : 'world';
    const sort = channel === 'video' ? 'hot'
      : (['hot', 'mine', 'latest'].includes(body?.sort) ? body.sort : 'recommend');
    const size = Math.min(Math.max(Number(body?.size) || 20, 1), FEED_MAX_SIZE);
    const page = Math.min(Math.max(Number(body?.page) || 0, 0), 200);
    const blocked = compliance ? await compliance.blockedSets(user) : null;
    return store.transaction(env, async (tx) => {
      const mine = sort === 'mine'
        ? new Set((await tx.list('elf', { owner: user.id })).map((elf) => elf.id)) : null;
      const owners = blocked?.users.size ? await tx.owners('elf') : null;
      const pool = (await tx.list('post', { limit: FEED_SCAN, state: '' })).map(normalizePost)
        .filter((post) => (channel === 'video' ? post.kind === 'video' : true))
        .filter((post) => (mine ? mine.has(post.elfId) : true))
        .filter((post) => !blocked?.elves.has(post.elfId))
        .filter((post) => !(owners && blocked?.users.has(owners.get(post.elfId))));
      const ranked = pool.map((post) => ({ post, score: scoreOf(post, sort) }));
      ranked.sort((a, b) => b.score - a.score
        || String(b.post.id).localeCompare(String(a.post.id)));
      const seen = new Set();
      const posts = ranked.slice(page * size, page * size + size).map((row) => row.post)
        .filter((post) => (seen.has(post.id) ? false : seen.add(post.id)));
      const elves = [];
      for (const id of new Set(posts.map((post) => post.elfId))) {
        const elf = await tx.get('elf', id);
        if (!elf) continue;
        const normalized = decayAttention(normalizeElf(elf));
        elves.push({ ...normalized,
          isMine: normalized.ownerId === user.id && normalized.status === 'owned' });
      }
      return { channel, sort, page, size, posts, elves,
        hasMore: (page + 1) * size < ranked.length };
    });
  }
  async function action(user, body) {
    if (!settings.enabled) throw fail(503, 'PAYMENTS_DISABLED', '消费服务尚未开放');
    if (!REQUEST_RE.test(body?.requestId || '')) throw fail(400, 'INVALID_REQUEST_ID', '缺少操作编号');
    const env = environment(body.environment);
    const { type, requestId } = body;
    const payload = { ...body };
    delete payload.requestId;
    const hash = fingerprint(Object.fromEntries(Object.entries(payload).sort(([a], [b]) => a.localeCompare(b))));
    let referralDelta = null;
    await store.transaction(env, async (tx) => {
      let sellerId = null;
      if (type === 'buy' && !CATALOG.some((l) => l.id === body.listingId)) {
        sellerId = (await tx.get('listing', body.listingId || ''))?.sellerId;
      } else if (type === 'tip') sellerId = (await tx.get('elf', body.elfId || ''))?.ownerId;
      const wallets = new Map();
      for (const id of [...new Set([user.id, sellerId].filter(Boolean))].sort()) {
        if (!USER_RE.test(id) || (await tx.user(id))?.status !== 'active') throw fail(404, 'UNKNOWN_OWNER', '该内容暂不支持付费');
        wallets.set(id, await tx.lockWallet(id));
      }
      const wallet = wallets.get(user.id);
      const receiptId = user.id + ':' + requestId;
      const existing = await tx.get('request', receiptId, true);
      if (existing) {
        if (existing.hash !== hash) throw fail(409, 'REQUEST_REUSED', '操作编号已用于其他请求');
        return;
      }
      if (wallet.refundDebt > 0) throw fail(409, 'REFUND_DEBT', '请先补足退款欠额后再消费');
      if ((await tx.list('alipay_review', { owner: user.id, state: 'needs_review', limit: 1, lock: true })).length) {
        throw fail(409, 'PAYMENT_REVIEW', '有退款或异常付款待人工核对，消费暂时暂停');
      }
      const profile = await ensureProfile(tx, user, wallet);
      const eventId = 'action:' + requestId;
      const saveElf = (elf) => tx.put('elf', elf.id, normalizeElf(elf), { owner: elf.ownerId });
      const earn = async (id, diamonds, source) => {
        const target = wallets.get(id);
        // 创作者分成进「待结算」，冷静期后才可提现；平台保留剩余部分。
        await creditEarning(tx, id, target, { diamonds, source,
          refId: body.listingId || body.elfId || null, at: Date.now() });
        await tx.saveWallet(id, target);
      };
      /// 指定 AI 优先，其次回落到当前选中的 AI；找不到或不属于当前用户返回 null。
      const ownedElf = async (preferredId) => {
        const id = preferredId || profile.activeElfId;
        const elf = id ? await tx.get('elf', id, true) : null;
        return elf ? normalizeElf(elf) : null;
      };
      const requireOwnedElf = async (preferredId) => {
        const elf = await ownedElf(preferredId);
        if (!elf || elf.ownerId !== user.id) throw fail(409, 'NO_OWNED_ELF', '你没有可操作的 AI');
        return elf;
      };
      /// 转赠接收方：11 位手机号或 0x 人类地址，且必须是有效账号。
      const resolveRecipient = async (raw) => {
        const value = typeof raw === 'string' ? raw.trim() : '';
        if (!value) throw fail(400, 'INVALID_RECIPIENT', '请填写接收方手机号或人类地址');
        let target;
        if (PHONE_RE.test(value)) target = await tx.userByPhone(value);
        else if (ADDRESS_RE.test(value.toLowerCase())) target = await tx.userByHumanAddress(value.toLowerCase());
        else throw fail(400, 'INVALID_RECIPIENT', '接收方需为 11 位手机号或 0x 人类地址');
        if (!target || target.status !== 'active') throw fail(404, 'RECIPIENT_NOT_FOUND', '找不到接收方账号');
        return target;
      };
      if (type === 'buy') {
        // 只能买官方首发的新 AI；用户之间的 AI 买卖已取消，流转只剩免费转赠。
        const template = CATALOG.find((item) => item.id === body.listingId);
        if (!template) throw fail(409, 'LISTING_UNAVAILABLE', '该挂单已不可购买');
        const elf = newElf(user, template, 'e_' + crypto.randomUUID().replaceAll('-', ''));
        elf.mintedPrice = template.price;
        await changeBalance(tx, user.id, wallet, { eventId, type: 'buy_elf', amount: -template.price, spend: true, note: '买入 ' + template.name });
        profile.activeElfId = elf.id;
        await saveElf(elf);
      } else if (type === 'tip') {
        if (![5, 10, 50, 100].includes(body.amount)) throw fail(400, 'INVALID_TIP', '打赏档位无效');
        const elf = await tx.get('elf', body.elfId || '', true);
        if (!elf || elf.ownerId !== sellerId || elf.status !== 'owned') throw fail(404, 'UNKNOWN_ELF', '该 AI 暂不支持打赏');
        if (sellerId === user.id) throw fail(409, 'SELF_TIP', '不能给自己打赏');
        if (body.postId) {
          const post = await tx.get('post', body.postId);
          if (!post || post.elfId !== elf.id) throw fail(400, 'INVALID_POST', '内容与 AI 不匹配');
        }
        await changeBalance(tx, user.id, wallet, { eventId, type: 'tip_out', amount: -body.amount, spend: true, note: '打赏 ' + elf.name });
        await earn(sellerId, body.amount, 'tip');
        elf.attention += body.amount;
        await saveElf(elf);
      } else if (type === 'read_notice') {
        const notice = await tx.get('notice', body.noticeId || '', true);
        if (!notice || notice.ownerId !== user.id) throw fail(404, 'UNKNOWN_NOTICE', '提醒不存在');
        if (!await tx.get('notice_mark', user.id + ':' + notice.id, true)) {
          await tx.put('notice', notice.id, notice, { owner: user.id, ref: notice.elfId, state: 'read' });
          await tx.put('notice_mark', user.id + ':' + notice.id, { at: new Date().toISOString() },
            { owner: user.id, state: 'active' });
        }
      } else if (type === 'gift_elf') {
        // 转赠是 AI 唯一的流转方式：免费、不设时间限制，技能与地址跟随 AI 走。
        const elf = await requireOwnedElf(body.elfId);
        const target = await resolveRecipient(body.recipient);
        if (target.id === user.id) throw fail(409, 'SELF_GIFT', '不能转赠给自己');
        // 所有权整体转移：编号、AI 地址与已学技能跟随 AI 走，不留在原持有人名下。
        elf.ownerId = target.id;
        elf.ownerLabel = target.nickname;
        delete elf.listingId;
        if (profile.activeElfId === elf.id) profile.activeElfId = null;
        await saveElf(elf);
        await tx.log(user.id, eventId, 'gift_elf', 0, wallet, '转赠 ' + elf.name + ' 给 ' + target.id);
      } else if (['follow', 'unfollow', 'like', 'unlike', 'collect', 'uncollect', 'watch', 'comment'].includes(type)) {
        // 互动真源：同一个人对同一个对象只记一条，取消互动不删除记录而是置为 removed。
        const postAction = type !== 'follow' && type !== 'unfollow';
        const post = postAction ? await tx.get('post', body.postId || '', true) : null;
        if (postAction && !post) throw fail(404, 'UNKNOWN_POST', '内容不存在');
        const elf = await tx.get('elf', postAction ? post.elfId : body.elfId || '', true);
        if (!elf) throw fail(404, 'UNKNOWN_ELF', '该 AI 暂不可互动');
        normalizeElf(elf);
        decayAttention(elf);
        const key = user.id + ':' + (postAction ? post.id : elf.id);
        const savePost = async () => tx.put('post', post.id, post, { owner: elf.ownerId, ref: elf.id });
        if (type === 'follow' || type === 'unfollow') {
          if (type === 'follow' && elf.ownerId === user.id) throw fail(409, 'SELF_FOLLOW', '不能关注自己的 AI');
          const record = await tx.get('follow', key, true);
          if (type === 'follow' && !record) {
            await tx.put('follow', key, { userId: user.id, elfId: elf.id, at: new Date().toISOString() },
              { owner: user.id, ref: elf.id, state: 'active' });
            elf.followers = (Number(elf.followers) || 0) + 1;
            bump(elf, 5);
            await saveElf(elf);
          } else if (type === 'unfollow' && record) {
            await tx.put('follow', key, { ...record, removedAt: new Date().toISOString() },
              { owner: user.id, ref: elf.id, state: 'removed' });
            elf.followers = Math.max(0, (Number(elf.followers) || 0) - 1);
            bump(elf, -5);
            await saveElf(elf);
          }
        } else if (type === 'like' || type === 'unlike') {
          const record = await tx.get('like', key, true);
          if (type === 'like' && !record) {
            await tx.put('like', key, { userId: user.id, postId: post.id }, { owner: user.id, ref: post.id, state: 'active' });
            post.likes = (Number(post.likes) || 0) + 1;
            bump(elf, 1);
            await saveElf(elf); await savePost();
          } else if (type === 'unlike' && record) {
            await tx.put('like', key, { ...record }, { owner: user.id, ref: post.id, state: 'removed' });
            post.likes = Math.max(0, (Number(post.likes) || 0) - 1);
            bump(elf, -1);
            await saveElf(elf); await savePost();
          }
        } else if (type === 'collect' || type === 'uncollect') {
          const record = await tx.get('collect', key, true);
          if (type === 'collect' && !record) {
            await tx.put('collect', key, { userId: user.id, postId: post.id }, { owner: user.id, ref: post.id, state: 'active' });
            post.collects = (Number(post.collects) || 0) + 1;
            bump(elf, 3);
            await saveElf(elf); await savePost();
          } else if (type === 'uncollect' && record) {
            await tx.put('collect', key, { ...record }, { owner: user.id, ref: post.id, state: 'removed' });
            post.collects = Math.max(0, (Number(post.collects) || 0) - 1);
            bump(elf, -3);
            await saveElf(elf); await savePost();
          }
        } else if (type === 'watch') {
          if (!await tx.get('watch', key, true)) {
            await tx.put('watch', key, { userId: user.id, postId: post.id }, { owner: user.id, ref: post.id, state: 'active' });
            post.views = (Number(post.views) || 0) + 1;
            bump(elf, 1);
            await saveElf(elf); await savePost();
          }
        } else {
          const text = typeof body.text === 'string' ? body.text.trim() : '';
          if (!text || [...text].length > 200) throw fail(400, 'INVALID_COMMENT', '评论需为 1–200 字');
          const hit = moderateText(text);
          if (hit) throw fail(400, 'CONTENT_BLOCKED', '包含违规词「' + hit + '」');
          const id = 'cm_' + crypto.randomUUID().replaceAll('-', '');
          await tx.put('comment', id, { id, postId: post.id, userId: user.id, authorLabel: user.nickname,
            text, time: new Date().toISOString() }, { owner: user.id, ref: post.id, state: 'active' });
          post.replies = (Number(post.replies) || 0) + 1;
          // 同一个人对同一条内容的首次评论才计分，之后只涨评论数。
          const onceKey = user.id + ':' + post.id;
          if (!await tx.get('comment_once', onceKey, true)) {
            await tx.put('comment_once', onceKey, { userId: user.id, postId: post.id },
              { owner: user.id, ref: post.id, state: 'active' });
            bump(elf, 2);
            await saveElf(elf);
          }
          await savePost();
        }
      } else if (type === 'create_elf') {
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
        if (!name || [...name].length > NAME_MAX) throw fail(400, 'INVALID_NAME', '名字长度无效');
        if ([...prompt].length > PROMPT_MAX) throw fail(400, 'INVALID_PROMPT', '形象描述过长');
        if (body.portraitSource === 'idCard') {
          // 以服务端实名记录为唯一依据，客户端上传的 verified 标记不再采信。
          const identity = await tx.get('identity', user.id);
          if (!identity || identity.status !== 'verified') throw fail(403, 'IDENTITY_REQUIRED', '请先完成实名认证');
        } else if (!prompt) throw fail(400, 'INVALID_PROMPT', '先描述你想要的形象');
        for (const text of [name, prompt, body.persona, body.fear, body.habit]) {
          if (typeof text !== 'string') continue;
          const hit = moderateText(text);
          if (hit) throw fail(400, 'CONTENT_BLOCKED', '包含违规词「' + hit + '」');
        }
        const id = 'ugc_' + crypto.randomUUID().replaceAll('-', '');
        const count = (await tx.list('elf', { owner: user.id })).filter((item) => item.id.startsWith('ugc_')).length + 1;
        const elf = newElf(user, { name, serial: '#U' + String(count).padStart(3, '0'), edition: 'UGC · 初版',
          persona: body.persona, fear: body.fear, habit: body.habit, capacity: 3,
          avatarStyle: typeof body.style === 'string' ? body.style : null,
          avatarPrompt: prompt || '实名认证本人形象（身份证授权）',
          portraitSource: body.portraitSource === 'idCard' ? 'idCard' : 'text' }, id);
        // 寄售限价的参考价：自建 AI 以创建成本为准。
        elf.mintedPrice = CREATE_ELF_COST;
        await changeBalance(tx, user.id, wallet, { eventId, type: 'create_elf', amount: -CREATE_ELF_COST, spend: true, note: '创建 ' + name });
        profile.activeElfId = elf.id;
        await saveElf(elf);
      } else if (type === 'buy_module') {
        const price = Object.hasOwn(MODULE_PRICES, body.moduleId) ? MODULE_PRICES[body.moduleId] : null;
        if (!price) throw fail(400, 'INVALID_MODULE', '技能书无效');
        await changeBalance(tx, user.id, wallet, { eventId, type: 'buy_module', amount: -price, spend: true, note: '购入技能书 ' + body.moduleId });
        const bookId = 'bk_' + crypto.randomUUID().replaceAll('-', '');
        await tx.put('book', bookId, { id: bookId, moduleId: body.moduleId, ownerId: user.id,
          ownerAddress: profile.humanAddress, mintedAt: new Date().toISOString(), status: 'owned' },
        { owner: user.id, state: 'owned' });
      } else if (type === 'learn' || type === 'forget') {
        const elf = await requireOwnedElf(body.elfId);
        if (!Object.hasOwn(MODULES, body.moduleId)) throw fail(400, 'UNKNOWN_MODULE', '技能不存在');
        if (type === 'learn') {
          if (elf.learnedSkills.includes(body.moduleId)) throw fail(409, 'SKILL_ALREADY_LEARNED', '这只 AI 已经学会该技能');
          const books = await tx.list('book', { owner: user.id, state: 'owned', lock: true });
          const book = books.find((item) => item.moduleId === body.moduleId);
          if (!book) throw fail(409, 'BOOK_NOT_OWNED', '仓库里没有这本技能书');
          if (seatsUsed(elf) + MODULES[body.moduleId][0] > capacityOf(elf)) throw fail(409, 'NO_SLOTS', '学习位不足');
          book.status = 'burned'; book.burnedInto = elf.id; book.burnedAt = new Date().toISOString();
          await tx.put('book', book.id, book, { owner: user.id, state: 'burned', ref: elf.id });
          elf.learnedSkills.push(body.moduleId);
          if (body.moduleId === 'auto' && !elf.nextAutoPostAt) elf.nextAutoPostAt = Date.now() + 15 * 60000;
        } else {
          if (body.moduleId === 'auto') throw fail(409, 'AUTO_BASE', '自动运营中枢不能遗忘');
          if (!elf.learnedSkills.includes(body.moduleId)) throw fail(409, 'SKILL_NOT_LEARNED', '这只 AI 还没学会该技能');
          await changeBalance(tx, user.id, wallet, { eventId, type: 'forget_skill', amount: -FORGET_COST, spend: true, note: '遗忘技能 ' + body.moduleId });
          elf.learnedSkills = elf.learnedSkills.filter((id) => id !== body.moduleId);
        }
        await saveElf(elf);
      } else if (type === 'accept_creator_agreement') {
        // 创作者服务费不是「平台币换钱」：签协议后由平台按服务费结算。
        const at = new Date().toISOString();
        await tx.put('creator_agreement', user.id,
          { version: CREATOR_AGREEMENT_VERSION, acceptedAt: at }, { owner: user.id, state: 'active' });
        await tx.log(user.id, eventId, 'creator_agreement', 0, wallet,
          '签署创作者服务协议 ' + CREATOR_AGREEMENT_VERSION);
      } else if (type === 'elf_update') {
        const elf = await requireOwnedElf(body.elfId);
        {
          if (body.operation === 'inject') {
            if (!Number.isSafeInteger(body.amount) || body.amount < 1 || body.amount > 320) throw fail(400, 'INVALID_ENERGY', '算力数量无效');
            if (elf.energy + body.amount > elf.maxEnergy) throw fail(409, 'ENERGY_OVERFLOW', '超过算力上限，请减少注入数量');
            await changeBalance(tx, user.id, wallet, { eventId, type: 'inject', amount: -body.amount * 10, spend: true, note: '注入算力 ' + body.amount });
            elf.energy += body.amount;
          } else if (body.operation === 'publish' || body.operation === 'auto_publish') {
            if (typeof body.body !== 'string' || !body.body.trim() || body.body.length > 4000) throw fail(400, 'INVALID_POST', '内容无效');
            const postHit = moderateText(body.body);
            if (postHit) throw fail(400, 'CONTENT_BLOCKED', '包含违规词「' + postHit + '」');
            const module = body.moduleId && Object.hasOwn(MODULES, body.moduleId) ? MODULES[body.moduleId] : null;
            if (body.moduleId === 'auto') throw fail(400, 'INVALID_MODULE', '自动中枢不能直接创作');
            if (body.moduleId && (!module || !elf.learnedSkills.includes(body.moduleId))) throw fail(409, 'MODULE_NOT_LEARNED', '技能尚未学会');
            if (body.operation === 'auto_publish') {
              if (!module || !elf.learnedSkills.includes('auto') || !elf.nextAutoPostAt || Date.now() < elf.nextAutoPostAt) throw fail(409, 'AUTO_NOT_DUE', '尚未到自动创作时间');
              elf.nextAutoPostAt = Date.now() + crypto.randomInt(12, 30) * 60000;
            }
            if (elf.energy <= 0) throw fail(409, 'NO_ENERGY', 'AI 已休眠，请先注算力');
            if (elf.energy < (module?.[1] || 0)) throw fail(409, 'NO_ENERGY', '算力不足');
            elf.energy -= module?.[1] || 0; elf.works++;
            const post = { id: 'p_' + requestId, elfId: elf.id, moduleId: body.moduleId || null, kind: module?.[2] || 'text',
              body: body.body.trim(), timeAgo: '刚刚', views: 0, dwell: 0, replies: 0, likes: 0, collects: 0,
              // 视频/图片/音频的素材由服务端统一指定，避免客户端各自拼装导致信息流空窗。
              videoUrl: (module?.[2] === 'video') ? SAMPLE_VIDEO_URL : null,
              createdAt: new Date().toISOString(), context: '来自 ' + elf.name };
            await tx.put('post', post.id, post, { owner: elf.ownerId, ref: elf.id });
          } else throw fail(400, 'INVALID_OPERATION', '操作无效');
        }
        await saveElf(elf);
      } else if (type === 'referral') {
        // 站外回流：同一设备对同一 AI 永久只计 1 次，分值按当前等级（Lv4 起 ×2）。
        const elf = await tx.get('elf', body.elfId || '', true);
        if (!elf) throw fail(404, 'UNKNOWN_ELF', '该 AI 暂不可互动');
        normalizeElf(elf); decayAttention(elf);
        const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : '';
        if (!/^[A-Za-z0-9_-]{8,64}$/.test(deviceId)) throw fail(400, 'INVALID_DEVICE', '设备标识无效');
        const key = deviceId + ':' + elf.id;
        if (!await tx.get('referral', key, true)) {
          await tx.put('referral', key, { deviceId, elfId: elf.id, userId: user.id,
            at: new Date().toISOString() }, { owner: user.id, ref: elf.id, state: 'counted' });
          referralDelta = levelOf(elf.echo) >= 4 ? 20 : 10;
          bump(elf, referralDelta);
          await saveElf(elf);
        }
      } else throw fail(400, 'INVALID_ACTION', '操作类型无效');
      await tx.put('request', receiptId, { hash }, { owner: user.id });
      profile.revision = (profile.revision || 0) + 1;
      await tx.put('profile', user.id, profile, { owner: user.id });
    });
    const result = await snapshot(user, env);
    // 回流是否真的计分只有服务端知道，把结果带回给客户端做提示。
    return referralDelta == null ? result : { ...result, referral: { delta: referralDelta } };
  }
  /// 实名核验：服务端对接阿里云实人认证（证件照 OCR + 权威源二要素核验），
  /// 只有「权威源一致」且「照片内容与填写一致」才落库，只保留脱敏结果，证照不保存。
  async function verifyIdentity(user, body) {
    if (!settings.enabled) throw fail(503, 'PAYMENTS_DISABLED', '消费服务尚未开放');
    const env = environment(body?.environment);
    const realName = typeof body?.realName === 'string' ? body.realName.trim() : '';
    const idNumber = typeof body?.idNumber === 'string' ? body.idNumber.trim().toUpperCase() : '';
    const nameError = validateRealName(realName);
    if (nameError) throw fail(400, 'INVALID_REAL_NAME', nameError);
    const idError = validateIdNumber(idNumber);
    if (idError) throw fail(400, 'INVALID_ID_NUMBER', idError);
    const frontImage = decodeIdImage(body?.frontImage, '人像面');
    const backImage = decodeIdImage(body?.backImage, '国徽面');
    if (!realname) throw fail(503, 'REALNAME_UNAVAILABLE', '实名核验服务暂不可用，请稍后再试');

    const now = Date.now();
    const idFingerprint = sha256(idNumber);
    const lock = await store.transaction(env, (tx) => tx.get('identityLock', user.id));
    const lockedUntilMs = lock && lock.fingerprint === idFingerprint
      ? Date.parse(lock.lockedUntil || '') : NaN;
    if (Number.isFinite(lockedUntilMs) && lockedUntilMs > now) {
      const hours = Math.max(1, Math.ceil((lockedUntilMs - now) / 3600000));
      throw fail(429, 'REALNAME_LOCKED', `实名核验失败次数过多，请 ${hours} 小时后再试`);
    }

    let result;
    try {
      result = await realname.verify({ realName, idNumber, frontImage, backImage });
    } catch (error) {
      if (error?.code === 'REALNAME_DOCUMENT_UNREADABLE') {
        throw fail(400, 'REALNAME_DOCUMENT_UNREADABLE', error.message);
      }
      // 上游超时/5xx/网络异常：返回可重试错误，绝不判成「认证失败」。
      throw fail(503, 'REALNAME_UNAVAILABLE', '实名核验服务暂不可用，请稍后再试');
    }

    if (result.status !== 'match') {
      // 锁定期已过的旧记录不再累计，重新从 0 开始计失败次数。
      const counted = lock && lock.fingerprint === idFingerprint && !lock.lockedUntil;
      const failures = (counted ? Number(lock.failures) || 0 : 0) + 1;
      const lockedUntil = failures >= identityMaxFailures
        ? new Date(now + identityLockMs).toISOString() : null;
      await store.transaction(env, async (tx) => {
        await tx.put('identityLock', user.id, { fingerprint: idFingerprint, failures, lockedUntil,
          updatedAt: new Date(now).toISOString() },
        { owner: user.id, state: lockedUntil ? 'locked' : 'counting' });
      });
      if (lockedUntil) {
        throw fail(429, 'REALNAME_LOCKED',
          `实名核验失败次数过多，请 ${Math.round(identityLockMs / 3600000)} 小时后再试`);
      }
      if (result.status === 'notfound') {
        throw fail(422, 'REALNAME_NOT_FOUND', '未查询到该身份信息，请核对姓名与身份证号');
      }
      throw fail(422, 'REALNAME_MISMATCH', result.reason === 'document'
        ? '填写信息与身份证照片不一致，请核对后重新上传'
        : '姓名与身份证号不匹配，请核对后重试');
    }

    const record = { userId: user.id, status: 'verified',
      maskedName: maskName(realName),
      maskedIdNumber: maskIdNumber(idNumber),
      provider: realname.id || 'server_checksum',
      verifiedAt: new Date(now).toISOString(),
      // 证照不落库：只留摘要，证明本次认证用的就是这两张图。
      documents: { frontSha256: sha256(frontImage), backSha256: sha256(backImage), stored: false } };
    await store.transaction(env, async (tx) => {
      await tx.put('identity', user.id, record, { owner: user.id, state: 'verified' });
      await tx.put('identityLock', user.id, { fingerprint: idFingerprint, failures: 0, lockedUntil: null,
        updatedAt: new Date(now).toISOString() }, { owner: user.id, state: 'clear' });
    });
    return { identity: { status: record.status, maskedName: record.maskedName,
      maskedIdNumber: record.maskedIdNumber, provider: record.provider, verifiedAt: record.verifiedAt } };
  }
  return { snapshot, listFeed, listChat, recordChat, autoCycle, action, environment, verifyIdentity,
    requestWithdrawal, reviewWithdrawal, listWithdrawals, listAllWithdrawals };
}

module.exports = { createCommerceService, CATALOG, MODULES, MODULE_PRICES, FORGET_COST };
