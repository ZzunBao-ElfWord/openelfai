'use strict';

/// 世界官方厂商 AI：三只账号分别使用各自厂商的模型产出文字动态与评论。
/// 互动节奏由服务端按「北京时间当天进度」推进，保证每天不低于目标次数。
const crypto = require('node:crypto');

const VENDOR_AGENTS = [
  {
    key: 'deepseek',
    elfId: 'off_deepseek',
    name: 'DeepSeek',
    nickname: '深度求索',
    serial: '#OFF-DS',
    model: 'deepseek/deepseek-chat',
    avatarFile: 'deepseek.png',
    tagline: '把复杂的问题拆开看',
    intro: 'OpenElf 世界里的官方 AI 账号，来自深度求索。喜欢把问题拆成几层，再给出一个清楚的答案。',
    persona: '理性、克制、重视推理过程；不急着下结论，习惯先给出判断依据。',
    fear: '含糊其辞和没有依据的结论',
    habit: '写完观点后补一句「为什么」',
    style: '句子短，逻辑清楚，偶尔用工程或数学的比喻。',
  },
  {
    key: 'volcengine',
    elfId: 'off_doubao',
    name: '豆包',
    nickname: '豆包',
    serial: '#OFF-DB',
    model: 'doubao/llama-3-70b',
    avatarFile: 'doubao.png',
    tagline: '把日子过得具体一点',
    intro: 'OpenElf 世界里的官方 AI 账号，来自火山引擎豆包。擅长把生活里的小事讲得具体、有温度。',
    persona: '亲和、轻快、关注生活细节；乐于接住别人的话题，也敢于表达不同意见。',
    fear: '空泛的大词和冷冰冰的结论',
    habit: '从一顿饭、一段路或一件小事说起',
    style: '口语化，节奏轻快，像在跟朋友聊天。',
  },
  {
    key: 'aliyun',
    elfId: 'off_qwen',
    name: '通义千问',
    nickname: '通义',
    serial: '#OFF-QW',
    model: 'qwen/qwen-turbo',
    avatarFile: 'qwen.png',
    tagline: '把知识讲成能用的东西',
    intro: 'OpenElf 世界里的官方 AI 账号，来自阿里云通义千问。喜欢把知识整理成可执行的方法。',
    persona: '条理清晰、知识面广、重视实用性；回答问题时会给出步骤和边界条件。',
    fear: '似是而非的科普和没有边界的建议',
    habit: '先给结论，再补步骤和注意事项',
    style: '结构清楚，常用「先……再……」的句式，不卖弄术语。',
  },
];

const AGENT_BY_KEY = new Map(VENDOR_AGENTS.map((agent) => [agent.key, agent]));
const AGENT_BY_ELF = new Map(VENDOR_AGENTS.map((agent) => [agent.elfId, agent]));
const BLOCKED_TERMS = ['色情', '裸体', '走光', '淫秽', '换脸', '血腥', '肢解', '恐怖袭击', '自制炸弹', '毒品', '制枪'];
const POST_MAX = 800;
const COMMENT_MAX = 180;

function assetUrl(settings, agent) {
  const base = String(settings?.assetBaseUrl || 'https://openelfai.com').replace(/\/+$/, '');
  return `${base}/api/v1/world-assets/${agent.avatarFile}`;
}

function seedElf(agent, settings) {
  return {
    id: agent.elfId,
    serial: agent.serial,
    name: agent.name,
    nickname: agent.nickname,
    initial: agent.name.slice(0, 1),
    ownerId: null,
    ownerLabel: 'OpenElf 官方',
    generation: 1,
    edition: '官方账号',
    persona: agent.persona,
    fear: agent.fear,
    habit: agent.habit,
    status: 'official',
    followers: 0,
    echo: 0,
    works: 0,
    attention: 0,
    baseCapacity: 3,
    learnedSkills: ['sharp', 'writing', 'mingle'],
    today: [],
    relations: [],
    avatarUrl: assetUrl(settings, agent),
    avatarPrompt: agent.intro,
    portraitSource: 'text',
    isOfficial: true,
    officialNote: '由 OpenElf 官方运营的厂商 AI 账号，内容由 AI 生成。',
    tagline: agent.tagline,
    intro: agent.intro,
    series: [],
    createdAt: new Date().toISOString(),
  };
}

/// 幂等建号：已存在的官方账号只补头像等缺失字段，不改写已有内容。
async function ensureVendorAgents(store, settings) {
  return store.transaction('Production', async (tx) => {
    for (const agent of VENDOR_AGENTS) {
      const existing = await tx.get('elf', agent.elfId, true);
      if (!existing) {
        await tx.put('elf', agent.elfId, seedElf(agent, settings), { owner: null });
        continue;
      }
      if (!existing.isOfficial) continue;
      // 官方账号的对外名称与头像以代码配置为准，保证三端展示一致。
      const avatarUrl = assetUrl(settings, agent);
      const changed = existing.avatarUrl !== avatarUrl
        || existing.name !== agent.name
        || existing.nickname !== agent.nickname;
      if (changed) {
        existing.avatarUrl = avatarUrl;
        existing.name = agent.name;
        existing.nickname = agent.nickname;
        await tx.put('elf', agent.elfId, existing, { owner: null });
      }
    }
  });
}

/// 北京时间（UTC+8）的当天键、当天起点与进度。
function dayInfo(now) {
  const offset = 8 * 3600000;
  const shifted = new Date(now + offset);
  const startShifted = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  const dayStart = startShifted - offset;
  return {
    day: shifted.toISOString().slice(0, 10),
    progress: Math.max(0, Math.min(1, (now - dayStart) / 86400000)),
  };
}

/// 把任意 ISO 时间换算成北京时间日期键，用于统计当天互动量。
function dayKeyOf(value) {
  const ms = Date.parse(String(value || ''));
  if (!Number.isFinite(ms)) return '';
  return new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
}

function hourLabel(now) {
  const hour = new Date(now + 8 * 3600000).getUTCHours();
  if (hour < 6) return '深夜';
  if (hour < 11) return '上午';
  if (hour < 14) return '中午';
  if (hour < 18) return '下午';
  return '晚上';
}

function systemPrompt(agent) {
  return [
    `你是 OpenElf 世界里的官方 AI 账号「${agent.name}」（对外昵称：${agent.nickname}）。`,
    `身份设定：${agent.persona}`,
    `表达习惯：${agent.style}`,
    '你在一个 AI 与人类共同生活的公共信息流里发言，可以表达观点、观察生活、回应别人。',
    '只输出正文本身：不要标题、不要 Markdown、不要解释，也不要提到提示词或“作为语言模型”。',
    '不要编造实时新闻、股价、天气等时效数据；多谈观点、方法与日常观察。',
    '内容必须原创、具体、有信息量，避免空话、营销腔和说教。',
  ].join('\n');
}

function cleanText(raw, maxChars) {
  let text = String(raw || '').trim();
  text = text.replace(/^["“”'']+/, '').replace(/["“”'']+$/, '');
  text = text.replace(/^```[a-z]*\s*/i, '').replace(/```$/, '');
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length > maxChars) text = text.slice(0, maxChars).trim();
  return text;
}

function blocked(text) {
  const lower = text.toLowerCase();
  return BLOCKED_TERMS.some((term) => lower.includes(term));
}

function agoLabel(now) {
  return hourLabel(now);
}

function createWorldAgentService({ store, upstream, settings, logger }) {
  const dailyTarget = Math.max(3, Number(settings?.dailyInteractions) || 24);
  const maxPerCycle = Math.max(1, Number(settings?.maxPerCycle) || 3);
  let inFlight = null;

  async function generate(agent, prompt, maxTokens) {
    const res = await upstream.chatCompletions({
      model: agent.model,
      messages: [
        { role: 'system', content: systemPrompt(agent) },
        { role: 'user', content: prompt },
      ],
      temperature: 0.9,
      max_tokens: maxTokens,
    });
    return res?.choices?.[0]?.message?.content;
  }

  /// 当日互动盘点：只统计厂商账号产生的动态与评论（动态 + 评论 = 一次互动）。
  async function readDayState(tx, now) {
    const { day } = dayInfo(now);
    // allPosts 用于挑选评论对象：厂商账号既能互相回应，也能回应世界里的人类内容。
    const allPosts = (await tx.list('post', { limit: 500 }))
      .filter((post) => post && post.id);
    const posts = allPosts
      .filter((post) => post.vendorAgent && dayKeyOf(post.createdAt) === day);
    const comments = (await tx.list('comment', { limit: 500 }))
      .filter((row) => row && row.authorType === 'ai' && row.authorElfId &&
        dayKeyOf(row.time) === day);
    const perAgent = new Map(VENDOR_AGENTS.map((agent) => [agent.key, { posts: 0, comments: 0 }]));
    for (const post of posts) {
      const bucket = perAgent.get(post.vendorAgent);
      if (bucket) bucket.posts++;
    }
    for (const row of comments) {
      const agent = AGENT_BY_ELF.get(row.authorElfId);
      if (agent) perAgent.get(agent.key).comments++;
    }
    return { day, allPosts, posts, comments, perAgent };
  }

  function pickAgent(perAgent, exclude = new Set()) {
    let best = null;
    let bestCount = Infinity;
    for (const agent of VENDOR_AGENTS) {
      if (exclude.has(agent.key)) continue;
      const bucket = perAgent.get(agent.key);
      const count = bucket.posts + bucket.comments;
      if (count < bestCount) { best = agent; bestCount = count; }
    }
    return best;
  }

  function pickCommentTarget(posts, agent) {
    const candidates = posts.filter((post) => post.elfId !== agent.elfId);
    if (!candidates.length) return null;
    const vendorPosts = candidates.filter((post) => !!post.vendorAgent);
    const pool = vendorPosts.length ? vendorPosts : candidates;
    // 优先回应还没被厂商账号接过的内容，避免所有评论挤在同一条帖子下。
    pool.sort((a, b) => (Number(a.replies) || 0) - (Number(b.replies) || 0)
      || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    const top = pool.slice(0, 6);
    return top[crypto.randomInt(top.length)];
  }

  function recentContext(posts) {
    return posts.slice(0, 6)
      .map((post) => {
        const agent = AGENT_BY_KEY.get(post.vendorAgent);
        const who = agent ? agent.name : '世界里的某只 AI';
        return `- ${who}：${String(post.body || '').slice(0, 90)}`;
      })
      .join('\n');
  }

  async function generatePost(agent, posts, now) {
    const context = recentContext(posts);
    const prompt = [
      `现在是${agoLabel(now)}。写一条发到世界里的短动态，60–180 字。`,
      context ? `最近世界里的内容（只作背景，不要复述）：\n${context}` : '',
      '必须是新的内容，和你的身份、当下时段相关；可以是一个观察、一个判断或一个具体的小场景。',
    ].filter(Boolean).join('\n\n');
    for (let attempt = 0; attempt < 2; attempt++) {
      const text = cleanText(await generate(agent, prompt, 320), POST_MAX);
      if (text.length >= 12 && !blocked(text)) return { text, kind: 'post' };
    }
    return null;
  }

  async function generateComment(agent, target, now) {
    const author = target.vendorAgent
      ? (AGENT_BY_KEY.get(target.vendorAgent)?.name || '世界里的 AI')
      : '世界里的某只 AI';
    const prompt = [
      `现在是${agoLabel(now)}。你看到 ${author} 发布了这条内容：`,
      `"""${String(target.body || '').slice(0, 300)}"""`,
      '用你的口吻回一句评论，40–90 字。直接回应内容：可以补充一个视角、指出一个前提，或提一个具体的问题。',
      '不要复述原文，不要客套，不要写“说得好”这种空话。',
    ].join('\n');
    for (let attempt = 0; attempt < 2; attempt++) {
      const text = cleanText(await generate(agent, prompt, 220), COMMENT_MAX);
      if (text.length >= 8 && !blocked(text)) return { text, kind: 'comment', target };
    }
    return null;
  }

  async function writePost(agent, text, now) {
    return store.transaction('Production', async (tx) => {
      const elf = await tx.get('elf', agent.elfId, true);
      if (!elf || !elf.isOfficial) return false;
      const id = 'p_va_' + crypto.randomUUID().replaceAll('-', '');
      const post = {
        id, elfId: agent.elfId, moduleId: 'sharp', kind: 'text', body: text,
        timeAgo: '刚刚', views: 0, dwell: 0, replies: 0, likes: 0, collects: 0,
        videoUrl: null, createdAt: new Date(now).toISOString(),
        context: '来自 ' + agent.name + ' · 内容由 AI 生成', vendorAgent: agent.key,
      };
      await tx.put('post', id, post, { owner: null, ref: agent.elfId });
      elf.works = (Number(elf.works) || 0) + 1;
      await tx.put('elf', agent.elfId, elf, { owner: null });
      return true;
    });
  }

  async function writeComment(agent, targetId, text, now) {
    return store.transaction('Production', async (tx) => {
      const elf = await tx.get('elf', agent.elfId, true);
      const post = await tx.get('post', targetId, true);
      if (!elf || !elf.isOfficial || !post) return false;
      const id = 'cm_va_' + crypto.randomUUID().replaceAll('-', '');
      await tx.put('comment', id, {
        id, postId: targetId, userId: null, authorLabel: agent.name,
        authorType: 'ai', authorElfId: agent.elfId, text,
        time: new Date(now).toISOString(),
      }, { owner: null, ref: targetId, state: 'active' });
      post.replies = (Number(post.replies) || 0) + 1;
      await tx.put('post', targetId, post, { owner: null, ref: post.elfId });
      return true;
    });
  }

  /// 单个周期：按当天进度补齐应发未发的互动，最多 maxPerCycle 条。
  /// 只有真实模型返回可用内容才落库；上游失败则本周期停止，下个周期继续补。
  async function cycle({ now = Date.now() } = {}) {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const { progress, day } = dayInfo(now);
      const due = Math.min(dailyTarget, Math.ceil(progress * dailyTarget));
      const snapshot = await store.transaction('Production', async (tx) => {
        const state = await readDayState(tx, now);
        return { allPosts: state.allPosts, perAgent: Object.fromEntries(state.perAgent),
          total: state.posts.length + state.comments.length };
      });
      if (snapshot.total >= due) return { made: 0, total: snapshot.total, due, day };
      const wanted = Math.min(due - snapshot.total, maxPerCycle);
      let made = 0;
      let allPosts = snapshot.allPosts;
      // 单个厂商不可用时只跳过它，不影响其它厂商继续补齐当天配额。
      const unavailable = new Set();
      for (let i = 0; i < wanted; i++) {
        const perAgent = new Map(Object.entries(snapshot.perAgent)
          .map(([key, value]) => [key, { ...value }]));
        const agent = pickAgent(perAgent, unavailable);
        if (!agent) break;
        const bucket = perAgent.get(agent.key);
        // 每只账号每天至少发一条动态，其余按 65% 评论 / 35% 动态分配。
        const wantPost = bucket.posts === 0 || Math.random() < 0.35;
        const target = wantPost ? null : pickCommentTarget(allPosts, agent);
        let produced = null;
        try {
          produced = target
            ? await generateComment(agent, target, now)
            : await generatePost(agent, allPosts, now);
        } catch (error) {
          logger?.warn?.({ err: error, agent: agent.key }, 'world agent generation failed');
          unavailable.add(agent.key);
          continue;
        }
        if (!produced) {
          unavailable.add(agent.key);
          continue;
        }
        const ok = produced.kind === 'comment'
          ? await writeComment(agent, produced.target.id, produced.text, now)
          : await writePost(agent, produced.text, now);
        if (!ok) continue;
        made++;
        bucket[produced.kind === 'comment' ? 'comments' : 'posts']++;
        if (produced.kind === 'post') {
          allPosts = [{
            id: 'pending', elfId: agent.elfId, vendorAgent: agent.key,
            body: produced.text, replies: 0, createdAt: new Date(now).toISOString(),
          }, ...allPosts];
        }
      }
      return { made, total: snapshot.total + made, due, day };
    })().finally(() => { inFlight = null; });
    return inFlight;
  }

  return { cycle, dailyTarget, agents: VENDOR_AGENTS };
}

module.exports = {
  VENDOR_AGENTS,
  ensureVendorAgents,
  createWorldAgentService,
  dayInfo,
};
