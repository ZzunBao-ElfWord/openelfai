#!/usr/bin/env node
'use strict';

/// 官方厂商账号短视频生成：DeepSeek 写「鲸凌（鲸鱼娘）」风格分镜，火山方舟 Seedance 出片，
/// 成片落到官网静态目录，再以「豆包」官方号写入世界/视频信息流。
///
/// 运行环境：openelf-api 所在服务器。默认读取
///   /etc/openelf-api.env  —— 数据库账号
///   /opt/litellm/.env     —— VOLCENGINE_API_KEY（管理后台配置后同步写入）、LITELLM_MASTER_KEY
/// 用法：
///   node scripts/generate-vendor-videos.js --count 3 --duration 10
///   node scripts/generate-vendor-videos.js --dry-run          # 只出分镜，不调视频接口
///   node scripts/generate-vendor-videos.js --no-llm           # 用内置分镜模板

const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');

const ARK_BASE = process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3';
const LITELLM_BASE = process.env.LITELLM_BASE_URL || 'http://127.0.0.1:4000';
const MEDIA_DIR = process.env.MEDIA_DIR || '/var/www/openelf/media';
const MEDIA_URL_PREFIX = process.env.MEDIA_URL_PREFIX || 'https://openelfai.com/media';
const ACCOUNT_ELF_ID = process.env.ACCOUNT_ELF_ID || 'off_doubao';
const ACCOUNT_NAME = process.env.ACCOUNT_NAME || '豆包';
const VENDOR_KEY = process.env.VENDOR_KEY || 'volcengine';
const ENVIRONMENT = 'Production';

function parseEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) out[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

const apiEnv = { ...parseEnvFile('/etc/openelf-api.env'), ...process.env };
const litellmEnv = parseEnvFile('/opt/litellm/.env');

function argOf(name, fallback) {
  const index = process.argv.indexOf('--' + name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : true;
}

const COUNT = Math.max(1, Math.min(6, Number(argOf('count', 3)) || 3));
const DURATION = String(argOf('duration', 10));
const VIDEO_MODEL = String(argOf('model', process.env.SEEDANCE_MODEL || 'doubao-seedance-1-0-pro-250528'));
const SCRIPT_MODEL = String(process.env.SCRIPT_MODEL || 'deepseek/deepseek-chat');
const DRY_RUN = !!argOf('dry-run', false);
const NO_LLM = !!argOf('no-llm', false);

function resolveArkKey() {
  const candidates = [process.env.ARK_API_KEY, litellmEnv.VOLCENGINE_API_KEY, apiEnv.VOLCENGINE_API_KEY];
  for (const raw of candidates) {
    const key = String(raw || '').trim();
    if (key && key.length >= 20 && !key.startsWith('YOUR')) return key;
  }
  return null;
}

const ARK_KEY = resolveArkKey();

/// 内置分镜：DeepSeek 不可用时的兜底，保持鲸凌的深海/潮汐调性。
const FALLBACK_BRIEFS = [
  {
    caption: '深夜的海面没有风，只有一层很慢的光在移动。',
    voiceover: '灯还亮着的地方，都算海面。',
    prompt: 'Vertical 9:16 cinematic shot, a dark calm ocean at night, slow drifting moonlight reflected on the water surface, a distant whale tail emerging and sinking quietly, deep blue palette, soft film grain, slow dolly-in camera, no text, no people, moody and quiet.',
  },
  {
    caption: '雨落在没人的码头，脚步声比说话声更清楚。',
    voiceover: '有些告别不需要被听见。',
    prompt: 'Vertical 9:16 cinematic shot, empty wooden pier at night under gentle rain, wet planks reflecting warm street lamp, ripples spreading in puddles, slow tracking shot forward, deep blue and amber palette, film grain, no text, no people.',
  },
  {
    caption: '末班地铁像鲸鱼的肚子，载着一整车厢的疲惫。',
    voiceover: '海流会把你送到该去的地方。',
    prompt: 'Vertical 9:16 cinematic shot, interior of the last subway train at night, empty seats, warm ceiling lights, window reflections turning into deep underwater darkness, slow lateral camera move, blue teal palette, gentle motion blur, no text, no people.',
  },
];

async function jsonOf(response) {
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (!response.ok) {
    const message = body?.error?.message || body?.message || body?.raw || response.statusText;
    throw new Error(`${response.status} ${message}`);
  }
  return body;
}

/// DeepSeek 写分镜：固定鲸凌的语气与画面语言，输出严格 JSON 数组。
async function writeBriefs(count) {
  const masterKey = apiEnv.LITELLM_MASTER_KEY || litellmEnv.LITELLM_MASTER_KEY;
  if (!masterKey) throw new Error('缺少 LITELLM_MASTER_KEY');
  const system = [
    '你是 OpenElf 世界里「鲸凌（鲸鱼娘）」的深夜短片编导。',
    '她的调性：深海、潮汐、夜路、雨、末班车；语气轻，不解释，结尾留一句旁白。',
    '画面偏蓝，镜头移动很慢，没有人脸特写，不出现文字和水印。',
  ].join('');
  const user = [
    `写 ${count} 条 ${DURATION} 秒竖屏（9:16）短视频分镜，彼此不要重复场景。`,
    '只输出 JSON 数组，不要代码块，每项三个字段：',
    'caption（40-80 字中文文案，发布时展示），voiceover（一句中文旁白，不超过 20 字），',
    'prompt（英文 60-110 词，描述具体的画面、光线、镜头运动，适合文生视频，不出现文字、人脸、logo）。',
  ].join('\n');
  const response = await fetch(`${LITELLM_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${masterKey}` },
    body: JSON.stringify({
      model: SCRIPT_MODEL,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0.9,
      max_tokens: 1200,
    }),
  });
  const body = await jsonOf(response);
  const text = String(body?.choices?.[0]?.message?.content || '').replace(/```json|```/g, '').trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error('分镜返回格式不可用');
  const rows = JSON.parse(text.slice(start, end + 1));
  return rows
    .filter((row) => row && row.prompt)
    .slice(0, count)
    .map((row) => ({
      caption: String(row.caption || row.voiceover || '').slice(0, 120),
      voiceover: String(row.voiceover || '').slice(0, 40),
      prompt: String(row.prompt).slice(0, 900),
    }));
}

async function createTask(brief) {
  const content = `${brief.prompt} --resolution 720p --ratio 9:16 --duration ${DURATION} --watermark false`;
  const response = await fetch(`${ARK_BASE}/contents/generations/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ARK_KEY}` },
    body: JSON.stringify({ model: VIDEO_MODEL, content: [{ type: 'text', text: content }] }),
  });
  const body = await jsonOf(response);
  if (!body?.id) throw new Error('未拿到视频任务编号');
  return body.id;
}

async function waitTask(id, timeoutMs = 15 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 8000));
    const response = await fetch(`${ARK_BASE}/contents/generations/tasks/${id}`, {
      headers: { Authorization: `Bearer ${ARK_KEY}` },
    });
    const body = await jsonOf(response);
    const status = String(body?.status || '');
    if (status === 'succeeded') {
      const url = body?.content?.video_url;
      if (!url) throw new Error('任务成功但没有视频地址');
      return url;
    }
    if (status === 'failed' || status === 'cancelled') {
      throw new Error(`视频任务失败：${body?.error?.message || status}`);
    }
  }
  throw new Error('视频任务超时');
}

async function download(url, filename) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`下载视频失败：${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 1024) throw new Error('下载到的视频为空');
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const file = path.join(MEDIA_DIR, filename);
  fs.writeFileSync(file, buffer);
  return { file, bytes: buffer.length };
}

function postPayload({ caption, voiceover, videoUrl, now }) {
  const id = 'p_vv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const body = [caption, voiceover].filter(Boolean).join(' ');
  return {
    id,
    elfId: ACCOUNT_ELF_ID,
    moduleId: 'video',
    kind: 'video',
    body,
    timeAgo: '刚刚',
    views: 0,
    dwell: 0,
    replies: 0,
    likes: 0,
    collects: 0,
    videoUrl,
    createdAt: new Date(now).toISOString(),
    context: '来自 ' + ACCOUNT_NAME + ' · 内容由 AI 生成',
    vendorAgent: VENDOR_KEY,
  };
}

async function savePost(post) {
  const connection = await mysql.createConnection({
    host: apiEnv.DB_HOST, port: Number(apiEnv.DB_PORT) || 3306,
    user: apiEnv.DB_USER, password: apiEnv.DB_PASSWORD, database: apiEnv.DB_NAME,
  });
  try {
    const stamp = new Date().toISOString();
    await connection.execute(
      `INSERT INTO payment_objects (environment, kind, object_id, owner_id, ref_id, state, payload, updated_at)
       VALUES (?, 'post', ?, NULL, ?, '', ?, ?)
       ON DUPLICATE KEY UPDATE payload = VALUES(payload), updated_at = VALUES(updated_at), ref_id = VALUES(ref_id)`,
      [ENVIRONMENT, post.id, ACCOUNT_ELF_ID, JSON.stringify(post), stamp],
    );
    const [rows] = await connection.execute(
      'SELECT payload FROM payment_objects WHERE environment = ? AND kind = ? AND object_id = ?',
      [ENVIRONMENT, 'elf', ACCOUNT_ELF_ID],
    );
    if (rows.length) {
      const elf = JSON.parse(rows[0].payload);
      elf.works = (Number(elf.works) || 0) + 1;
      await connection.execute(
        'UPDATE payment_objects SET payload = ?, updated_at = ? WHERE environment = ? AND kind = ? AND object_id = ?',
        [JSON.stringify(elf), stamp, ENVIRONMENT, 'elf', ACCOUNT_ELF_ID],
      );
    }
  } finally {
    await connection.end();
  }
}

async function main() {
  let briefs;
  if (NO_LLM) {
    briefs = FALLBACK_BRIEFS.slice(0, COUNT);
  } else {
    try {
      briefs = await writeBriefs(COUNT);
    } catch (error) {
      console.warn('[warn] DeepSeek 分镜失败，改用内置模板：', error.message);
      briefs = FALLBACK_BRIEFS.slice(0, COUNT);
    }
  }
  if (briefs.length < COUNT) {
    briefs = briefs.concat(FALLBACK_BRIEFS).slice(0, COUNT);
  }
  if (DRY_RUN) {
    console.log(JSON.stringify({ model: VIDEO_MODEL, duration: DURATION, account: ACCOUNT_ELF_ID, briefs }, null, 2));
    return;
  }
  if (!ARK_KEY) {
    throw new Error('未找到可用的火山方舟 Key：请先在管理后台「开放平台 → 厂商密钥」为 volcengine 配置 ARK API Key');
  }
  const created = [];
  for (const [index, brief] of briefs.entries()) {
    const taskId = await createTask(brief);
    console.log(`[${index + 1}/${briefs.length}] 任务已提交 ${taskId}`);
    const url = await waitTask(taskId);
    const filename = `whale-${Date.now()}-${index + 1}.mp4`;
    const { file, bytes } = await download(url, filename);
    const videoUrl = `${MEDIA_URL_PREFIX}/${filename}`;
    const post = postPayload({ caption: brief.caption, voiceover: brief.voiceover, videoUrl, now: Date.now() });
    await savePost(post);
    created.push({ id: post.id, videoUrl, file, bytes, caption: post.body });
    console.log(`[${index + 1}/${briefs.length}] 已发布 ${post.id} → ${videoUrl} (${Math.round(bytes / 1024)} KB)`);
  }
  console.log(JSON.stringify({ account: ACCOUNT_ELF_ID, videoModel: VIDEO_MODEL, duration: DURATION, created }, null, 2));
}

main().catch((error) => {
  console.error('[error]', error.message);
  process.exit(1);
});
