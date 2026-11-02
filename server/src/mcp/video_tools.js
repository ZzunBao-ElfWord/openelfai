'use strict';

const crypto = require('node:crypto');
const dns = require('node:dns/promises');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

/// 视频剪辑连接器：短视频切片、字幕与拼接。
/// 转写走可配置的 OpenAI 兼容 ASR，本地不留音频；剪辑与探测依赖系统 ffmpeg / ffprobe。

const MAX_SOURCE_BYTES = Number(process.env.VIDEO_MAX_SOURCE_BYTES || 200 * 1024 * 1024);
const MAX_SOURCE_SEC = Number(process.env.VIDEO_MAX_SOURCE_SEC || 30 * 60);
const MAX_CLIP_SEC = 60;
const MAX_RANGES = 20;
const MAX_HOOKS = 20;
const MAX_CONCAT_CLIPS = 10;
const MAX_CONCAT_SEC = 300;
const MAX_TRANSCRIPT_SEGMENTS = 2000;
const DOWNLOAD_TIMEOUT_MS = Number(process.env.VIDEO_DOWNLOAD_TIMEOUT_MS || 5 * 60 * 1000);
const FFMPEG_TIMEOUT_MS = Number(process.env.VIDEO_FFMPEG_TIMEOUT_MS || 5 * 60 * 1000);
// 长视频转写是「提交-轮询」的异步任务，留足排队时间；nginx 对 /mcp/video 放宽到 600s，
// 这里留 120s 余量给结果下载与响应。
const ASR_TIMEOUT_MS = Number(process.env.ASR_TIMEOUT_MS || 8 * 60 * 1000);
const ASR_POLL_INTERVAL_MS = 2000;
const DASHSCOPE_DEFAULT_BASE = 'https://dashscope.aliyuncs.com/api/v1';

const FILLERS = ['嗯', '呃', '额', '然后', '就是', '那个', '所以', '其实'];
const HOOK_WORDS = ['你知道', '为什么', '其实', '千万别', '记住', '第一', '如果你', '很多人'];

// 参数不合法统一抛 -32602；业务失败交给上层包成 isError 的业务错误。
function paramError(message) {
  const error = new Error(message);
  error.mcpCode = -32602;
  return error;
}

function businessError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function readString(value, field, { required = false, max = 4000 } = {}) {
  if (value === undefined || value === null) {
    if (required) throw paramError(`缺少参数 ${field}`);
    return undefined;
  }
  if (typeof value !== 'string') throw paramError(`${field} 必须是字符串`);
  const text = value.trim();
  if (required && !text) throw paramError(`缺少参数 ${field}`);
  return text.slice(0, max);
}

function readInt(value, field, { required = false, min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null) {
    if (required) throw paramError(`缺少参数 ${field}`);
    return undefined;
  }
  const num = Number(value);
  if (!Number.isSafeInteger(num) || num < min || num > max) {
    throw paramError(`${field} 必须是 ${min}-${max} 的整数`);
  }
  return num;
}

function readBool(value, field, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') throw paramError(`${field} 必须是布尔值`);
  return value;
}

function readIdList(value, field, { min = 1, max = MAX_RANGES } = {}) {
  if (!Array.isArray(value) || value.length < min) {
    throw paramError(`${field} 必须是至少 ${min} 个的数组`);
  }
  if (value.length > max) throw paramError(`${field} 超过上限 ${max}`);
  return value.map((item) => readString(item, field, { required: true, max: 64 }));
}

function readAspect(value) {
  if (value === undefined || value === null) return 'original';
  const allowed = ['original', '9:16', '1:1', '16:9'];
  if (!allowed.includes(value)) throw paramError(`aspect 只支持 ${allowed.join('、')}`);
  return value;
}

// —— 素材地址安全校验：只允许公网 http/https，禁止内网地址与协议 ——

function isPrivateAddress(address) {
  const ip = String(address || '').toLowerCase();
  if (!ip) return true;
  if (ip.startsWith('::')) {
    return ip === '::' || ip === '::1' || ip.startsWith('::ffff:');
  }
  if (/^(fc|fd|fe8|fe9|fea|feb)/.test(ip)) return true;
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 127 || a === 10) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

async function assertSafeUrl(raw) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    throw paramError('sourceUrl 不是合法的网址');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw paramError('sourceUrl 只支持 http/https 地址');
  }
  const host = url.hostname;
  if (!host) throw paramError('sourceUrl 缺少主机名');
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    throw paramError('sourceUrl 不允许访问本机地址');
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    if (isPrivateAddress(host)) throw paramError('sourceUrl 不允许访问内网地址');
    return url;
  }
  let addresses = [];
  try {
    addresses = await dns.lookup(host, { all: true });
  } catch {
    throw paramError('sourceUrl 的主机无法解析');
  }
  if (addresses.length === 0 || addresses.some((item) => isPrivateAddress(item.address))) {
    throw paramError('sourceUrl 不允许访问内网地址');
  }
  return url;
}

// —— 文件与进程辅助 ——

function ensureDir(dir) {
  return fs.mkdir(dir, { recursive: true });
}

async function removeQuietly(file) {
  try {
    await fs.rm(file, { force: true });
  } catch {
    // 清理失败不影响主流程
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Number(ms) || 0));
  });
}

function parseFps(value) {
  const text = String(value || '');
  const match = /^(\d+)\/(\d+)$/.exec(text);
  if (!match) {
    const num = Number(text);
    return Number.isFinite(num) && num > 0 ? Math.round(num * 100) / 100 : 0;
  }
  const den = Number(match[2]);
  if (!den) return 0;
  return Math.round((Number(match[1]) / den) * 100) / 100;
}

function formatSrtTime(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) * 1000));
  const h = Math.floor(total / 3600000);
  const m = Math.floor((total % 3600000) / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const ms = total % 1000;
  const p = (n, len = 2) => String(n).padStart(len, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(ms, 3)}`;
}

function escapeFilterPath(file) {
  return String(file).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function clipUrl(file) {
  return `/api/v1/world-assets/videos/${file}`;
}

function createVideoTools({
  db,
  mediaDir,
  workDir,
  logger,
  fetchImpl = globalThis.fetch,
  ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg',
  ffprobePath = process.env.FFPROBE_PATH || 'ffprobe',
  asr = {},
} = {}) {
  if (!mediaDir || !workDir) throw new Error('视频工具缺少 mediaDir / workDir');

  const sourceDir = path.join(workDir, 'sources');
  const transcriptDir = path.join(workDir, 'transcripts');
  const metaDir = path.join(workDir, 'clips');

  async function ensureDirs() {
    await Promise.all([ensureDir(sourceDir), ensureDir(transcriptDir), ensureDir(metaDir), ensureDir(mediaDir)]);
  }

  // —— 下载与探测 ——

  async function downloadToFile(rawUrl, dest, maxBytes = MAX_SOURCE_BYTES) {
    let url = await assertSafeUrl(rawUrl);
    const deadline = Date.now() + DOWNLOAD_TIMEOUT_MS;
    for (let hop = 0; hop <= 3; hop += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(1000, deadline - Date.now()));
      try {
        const res = await fetchImpl(url.toString(), {
          signal: controller.signal,
          redirect: 'manual',
          headers: { 'user-agent': 'OpenElf-Video/1.0' },
        });
        if ([301, 302, 303, 307, 308].includes(res.status)) {
          const location = res.headers.get('location');
          if (!location) throw businessError('MEDIA_DOWNLOAD_FAILED', '素材地址重定向缺少目标');
          url = await assertSafeUrl(new URL(location, url).toString());
          continue;
        }
        if (!res.ok) {
          throw businessError('MEDIA_DOWNLOAD_FAILED', `素材下载失败（HTTP ${res.status}）`);
        }
        const declared = Number(res.headers.get('content-length') || 0);
        if (declared > maxBytes) {
          throw businessError('MEDIA_TOO_LARGE', `素材超过 ${Math.round(maxBytes / 1024 / 1024)}MB 上限`);
        }
        const chunks = [];
        let bytes = 0;
        for await (const chunk of res.body) {
          bytes += chunk.length;
          if (bytes > maxBytes) {
            controller.abort();
            throw businessError('MEDIA_TOO_LARGE', `素材超过 ${Math.round(maxBytes / 1024 / 1024)}MB 上限`);
          }
          chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);
        if (buffer.length < 1024) {
          throw businessError('INVALID_MEDIA', '素材内容过小或不是有效的视频');
        }
        await fs.writeFile(dest, buffer);
        return { bytes: buffer.length, url: url.toString() };
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw businessError('MEDIA_DOWNLOAD_TIMEOUT', '素材下载超时，请稍后重试或换更小的素材');
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
    throw paramError('sourceUrl 重定向次数过多');
  }

  async function probeFile(file) {
    let stdout;
    try {
      const result = await execFileAsync(ffprobePath, [
        '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file,
      ], { timeout: 60000, maxBuffer: 10 * 1024 * 1024 });
      stdout = result.stdout;
    } catch {
      throw businessError('PROBE_FAILED', '素材解析失败，请确认文件可读且服务端已安装 ffprobe');
    }
    let data;
    try {
      data = JSON.parse(stdout);
    } catch {
      throw businessError('PROBE_FAILED', '素材解析失败，返回内容不是有效 JSON');
    }
    const video = (data.streams || []).find((item) => item.codec_type === 'video');
    const audio = (data.streams || []).find((item) => item.codec_type === 'audio');
    const durationSec = Math.round(Number(data.format?.duration || video?.duration || 0) * 100) / 100;
    return {
      durationSec,
      width: Number(video?.width || 0),
      height: Number(video?.height || 0),
      fps: parseFps(video?.avg_frame_rate || video?.r_frame_rate),
      hasAudio: Boolean(audio),
      codec: video?.codec_name || '',
      sizeBytes: Number(data.format?.size || 0),
    };
  }

  async function withSource(sourceUrl, handler) {
    await ensureDirs();
    const file = path.join(sourceDir, `${crypto.randomUUID().replaceAll('-', '')}.src`);
    try {
      await downloadToFile(sourceUrl, file);
      const info = await probeFile(file);
      return await handler(file, info);
    } finally {
      await removeQuietly(file);
    }
  }

  // —— 转写 ——

  function asrConfig() {
    const rawBase = String(asr.baseUrl || process.env.ASR_BASE_URL || '').replace(/\/+$/, '');
    const rawModel = String(asr.model || process.env.ASR_MODEL || '');
    const explicit = String(asr.provider || process.env.ASR_PROVIDER || '').trim().toLowerCase();
    // 未显式指定时按模型名与域名自动判定，兼容原有的 OpenAI 兼容配置。
    const provider = explicit
      || (rawModel.includes('filetrans') || rawBase.includes('dashscope') ? 'dashscope' : 'openai');
    const base = provider === 'dashscope' && !rawBase ? DASHSCOPE_DEFAULT_BASE : rawBase;
    // 只配了百炼域名却没指定模型时，用百炼的文件转写模型，避免误发 whisper-1。
    const model = rawModel || (provider === 'dashscope' ? 'qwen-audio-3.1-asr-flash-filetrans' : 'whisper-1');
    return {
      provider,
      baseUrl: base,
      url: asr.url || process.env.ASR_TRANSCRIBE_URL
        || (provider === 'openai' && base ? `${base}/audio/transcriptions` : ''),
      apiKey: asr.apiKey || process.env.ASR_API_KEY || '',
      model,
      timeoutMs: Number(asr.timeoutMs || process.env.ASR_TIMEOUT_MS || ASR_TIMEOUT_MS),
    };
  }

  async function asrRequest(url, init, timeoutMs, failureText) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
    try {
      const res = await fetchImpl(url, { ...init, signal: controller.signal });
      const text = await res.text();
      let payload = {};
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        payload = {};
      }
      if (!res.ok) {
        const detail = payload?.message || payload?.output?.message || `HTTP ${res.status}`;
        throw businessError('ASR_FAILED', `${failureText}：${detail}`);
      }
      return payload;
    } catch (error) {
      if (error?.name === 'AbortError') throw businessError('ASR_TIMEOUT', '转写超时，请缩短素材后重试');
      if (error?.code) throw error;
      throw businessError('ASR_FAILED', failureText);
    } finally {
      clearTimeout(timer);
    }
  }

  // 阿里云百炼文件转写是异步任务：提交拿 task_id，轮询到 SUCCEEDED，再下载结果 JSON 取句级时间戳。
  async function transcribeWithDashscope({ sourceUrl, config }) {
    if (!config.baseUrl || !config.apiKey) {
      throw businessError('ASR_NOT_CONFIGURED', '未配置阿里云百炼转写，请联系管理员设置 ASR_BASE_URL 与 ASR_API_KEY');
    }
    const headers = { authorization: `Bearer ${config.apiKey}` };

    const submitted = await asrRequest(
      `${config.baseUrl}/services/audio/asr/transcription`,
      {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json', 'x-dashscope-async': 'enable' },
        body: JSON.stringify({
          model: config.model,
          input: { file_urls: [sourceUrl] },
          parameters: { channel_id: [0] },
        }),
      },
      Math.min(config.timeoutMs, 60 * 1000),
      '提交转写任务失败',
    );
    const taskId = submitted?.output?.task_id;
    if (!taskId) throw businessError('ASR_FAILED', '转写任务未返回 task_id');

    const deadline = Date.now() + config.timeoutMs;
    let result = null;
    while (Date.now() < deadline) {
      const progress = await asrRequest(
        `${config.baseUrl}/tasks/${encodeURIComponent(taskId)}`,
        { headers },
        30 * 1000,
        '查询转写任务失败',
      );
      const state = String(progress?.output?.task_status || '');
      if (state === 'SUCCEEDED') {
        result = progress?.output?.results?.[0] || null;
        break;
      }
      if (state === 'FAILED' || state === 'CANCELED' || state === 'UNKNOWN') {
        throw businessError('ASR_FAILED', progress?.output?.message || `转写任务状态 ${state}`);
      }
      await sleep(ASR_POLL_INTERVAL_MS);
    }
    if (!result) throw businessError('ASR_TIMEOUT', '转写排队或处理超时，请缩短素材后重试');
    if (String(result.subtask_status || 'SUCCEEDED') !== 'SUCCEEDED' || !result.transcription_url) {
      throw businessError('ASR_FAILED', result.message || '转写结果不可用');
    }

    const detail = await asrRequest(
      (await assertSafeUrl(result.transcription_url)).toString(),
      {},
      60 * 1000,
      '下载转写结果失败',
    );
    const transcript = detail?.transcripts?.[0] || {};
    const segments = (Array.isArray(transcript.sentences) ? transcript.sentences : [])
      .map((item) => ({
        start: Number(item.begin_time) / 1000,
        end: Number(item.end_time) / 1000,
        text: String(item.text || '').trim(),
      }))
      .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end)
        && item.end > item.start && item.text);
    const durationSec = Math.round(Number(detail?.properties?.original_duration_in_milliseconds || 0) / 1000);
    return { segments, durationSec };
  }

  function normalizeSegments(input) {
    if (!Array.isArray(input) || input.length === 0) {
      throw paramError('segments 必须是非空数组');
    }
    if (input.length > MAX_TRANSCRIPT_SEGMENTS) {
      throw paramError(`segments 超过上限 ${MAX_TRANSCRIPT_SEGMENTS}`);
    }
    const segments = [];
    for (const item of input) {
      if (!item || typeof item !== 'object') throw paramError('segments 每项必须是 {start,end,text}');
      const start = Number(item.start);
      const end = Number(item.end);
      const text = String(item.text || '').trim();
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
        throw paramError('segments 的 start/end 不合法');
      }
      if (!text) throw paramError('segments 的 text 不能为空');
      segments.push({ start, end, text: text.slice(0, 1000) });
    }
    segments.sort((a, b) => a.start - b.start);
    return segments;
  }

  async function saveTranscript(userId, { language, segments, sourceUrl }) {
    await ensureDirs();
    const id = `tr-${crypto.randomUUID().replaceAll('-', '')}`;
    const record = {
      id,
      userId,
      language,
      segments,
      sourceUrl,
      createdAt: new Date().toISOString(),
    };
    await fs.writeFile(path.join(transcriptDir, `${id}.json`), `${JSON.stringify(record)}\n`, 'utf8');
    return record;
  }

  async function loadTranscript(userId, transcriptId) {
    const id = String(transcriptId || '');
    if (!/^tr-[a-z0-9]+$/.test(id)) throw paramError('transcriptId 不合法');
    let record;
    try {
      record = JSON.parse(await fs.readFile(path.join(transcriptDir, `${id}.json`), 'utf8'));
    } catch {
      throw businessError('TRANSCRIPT_NOT_FOUND', '转写记录不存在或已过期，请重新转写');
    }
    if (record.userId !== userId) throw businessError('TRANSCRIPT_NOT_FOUND', '转写记录不属于当前账号');
    return record;
  }

  // —— 片段元数据 ——

  function clipMetaPath(clipId) {
    if (!/^vc-[a-z0-9]+$/.test(String(clipId || ''))) throw paramError('clipId 不合法');
    return path.join(metaDir, `${clipId}.json`);
  }

  async function saveClipMeta(record) {
    await ensureDirs();
    await fs.writeFile(clipMetaPath(record.clipId), `${JSON.stringify(record)}\n`, 'utf8');
    return record;
  }

  async function loadClipMeta(userId, clipId) {
    let record;
    try {
      record = JSON.parse(await fs.readFile(clipMetaPath(clipId), 'utf8'));
    } catch {
      throw businessError('CLIP_NOT_FOUND', '片段不存在或已删除');
    }
    if (record.userId !== userId) throw businessError('CLIP_NOT_FOUND', '片段不属于当前账号');
    return record;
  }

  function clipFiles(record) {
    return [
      record.file,
      record.coverFile,
      record.subtitleFile,
      record.burnedFile,
    ].filter(Boolean);
  }

  async function makeCover(videoFile) {
    const name = `${path.basename(videoFile, path.extname(videoFile))}-cover.jpg`;
    const target = path.join(mediaDir, name);
    try {
      await execFileAsync(ffmpegPath, [
        '-y', '-ss', '0.2', '-i', path.join(mediaDir, videoFile),
        '-frames:v', '1', '-vf', 'scale=720:-2', '-q:v', '3', target,
      ], { timeout: 60000 });
      const stat = await fs.stat(target);
      if (stat.size < 512) return null;
      return name;
    } catch (error) {
      logger?.warn?.({ err: error }, 'video clip cover failed');
      return null;
    }
  }

  function assetUrls(record) {
    return {
      clipId: record.clipId,
      durationSec: record.durationSec,
      videoUrl: clipUrl(record.burnedFile || record.file),
      coverUrl: record.coverFile ? clipUrl(record.coverFile) : null,
      subtitleUrl: record.subtitleFile ? clipUrl(record.subtitleFile) : null,
    };
  }

  // —— 气口定位 ——

  function scoreWindow(segments, startIdx, endIdx, removeFillers) {
    const first = segments[startIdx];
    const last = segments[endIdx];
    const duration = last.end - first.start;
    const text = segments.slice(startIdx, endIdx + 1).map((item) => item.text).join('');
    const chars = [...text].filter((c) => /[\u3400-\u9fffA-Za-z0-9]/.test(c)).length;
    const density = duration > 0 ? chars / duration : 0;
    const fillers = removeFillers
      ? theCountOf(text, FILLERS)
      : 0;
    const fillerRatio = chars > 0 ? fillers / Math.max(1, chars / 2) : 0;
    const hasQuestion = /[？?]/.test(text);
    const hasExclaim = /[！!]/.test(text);
    const startsWithHook = HOOK_WORDS.some((word) => first.text.startsWith(word));
    const endsClean = /[。！？!?。”』」]$/.test(last.text);

    let score = Math.min(density / 4, 1) * 45;
    if (hasQuestion) score += 15;
    if (hasExclaim) score += 8;
    if (startsWithHook) score += 15;
    if (endsClean) score += 12;
    if (duration >= 20 && duration <= 45) score += 5;
    score -= Math.min(fillerRatio * 20, 20);
    score = Math.max(0, Math.min(100, Math.round(score)));

    const reasons = [];
    if (density >= 2) reasons.push('信息密度高');
    if (hasQuestion) reasons.push('带提问');
    if (startsWithHook) reasons.push('开头有钩子');
    if (endsClean) reasons.push('结尾完整');
    if (removeFillers && fillers > 0) reasons.push(`含 ${fillers} 处口癖`);
    if (duration >= 20 && duration <= 45) reasons.push('时长合适');
    if (reasons.length === 0) reasons.push('可用区间');

    return {
      start: first.start,
      end: last.end,
      score,
      reason: reasons.slice(0, 3).join('、'),
    };
  }

  function theCountOf(text, words) {
    let count = 0;
    for (const word of words) {
      for (const _ of text.matchAll(new RegExp(word, 'g'))) count += 1;
    }
    return count;
  }

  function pickHooks(segments, { count, minSec, maxSec, removeFillers }) {
    const candidates = [];
    for (let i = 0; i < segments.length; i += 1) {
      let j = i;
      let duration = 0;
      while (j < segments.length) {
        duration = segments[j].end - segments[i].start;
        if (duration > maxSec) break;
        if (duration >= minSec && segments[j].text.trim()) {
          candidates.push(scoreWindow(segments, i, j, removeFillers));
        }
        j += 1;
      }
    }
    candidates.sort((a, b) => b.score - a.score || a.start - b.start);
    const picked = [];
    for (const item of candidates) {
      const overlaps = picked.some((other) => {
        const overlap = Math.min(item.end, other.end) - Math.max(item.start, other.start);
        return overlap > 2;
      });
      if (overlaps) continue;
      picked.push(item);
      if (picked.length >= count) break;
    }
    return picked.sort((a, b) => a.start - b.start);
  }

  // —— 工具定义 ——

  const definitions = [
    {
      name: 'probe_media',
      description: '读取素材信息：时长、分辨率、帧率、音轨与体积，用于判断能否直接处理。',
      inputSchema: {
        type: 'object',
        properties: {
          sourceUrl: { type: 'string', description: '素材地址，支持已授权的公网 http/https 链接' },
          maxDurationSec: { type: 'integer', minimum: 1, maximum: MAX_SOURCE_SEC, description: '允许处理的最长时长（秒）' },
        },
        required: ['sourceUrl'],
        additionalProperties: false,
      },
      handler: async (args = {}) => {
        const sourceUrl = readString(args.sourceUrl, 'sourceUrl', { required: true, max: 2000 });
        const maxDurationSec = readInt(args.maxDurationSec, 'maxDurationSec', { min: 1, max: MAX_SOURCE_SEC }) || MAX_SOURCE_SEC;
        return withSource(sourceUrl, async (_file, info) => {
          if (info.durationSec > maxDurationSec) {
            throw businessError('MEDIA_TOO_LONG', `素材时长 ${info.durationSec} 秒，超过上限 ${maxDurationSec} 秒`);
          }
          return { ...info, sourceUrl };
        });
      },
    },
    {
      name: 'transcribe_audio',
      description: '转写素材音轨，返回带时间戳的逐句文本；用于后续定位气口与生成字幕。',
      inputSchema: {
        type: 'object',
        properties: {
          sourceUrl: { type: 'string', description: '素材地址，与 probe_media 相同' },
          language: { type: 'string', maxLength: 12, description: '语言代码，不传则自动识别' },
          wordTimestamps: { type: 'boolean', description: '是否返回词级时间，默认开启' },
        },
        required: ['sourceUrl'],
        additionalProperties: false,
      },
      handler: async (args = {}, { userId }) => {
        const sourceUrl = readString(args.sourceUrl, 'sourceUrl', { required: true, max: 2000 });
        const language = readString(args.language, 'language', { max: 12 });
        if (language && !/^[a-zA-Z-]+$/.test(language)) throw paramError('language 只支持语言代码');
        const wordTimestamps = readBool(args.wordTimestamps, 'wordTimestamps', true);
        const config = asrConfig();
        if (!config.apiKey) {
          throw businessError('ASR_NOT_CONFIGURED', '未配置转写服务，请联系管理员设置 ASR_BASE_URL 与 ASR_API_KEY');
        }

        // 百炼文件转写是异步任务：直接把公网素材地址交给它，省掉本地下载与抽音频。
        if (config.provider === 'dashscope') {
          const safeUrl = await assertSafeUrl(sourceUrl);
          const { segments, durationSec } = await transcribeWithDashscope({
            sourceUrl: safeUrl.toString(),
            config,
          });
          if (durationSec > MAX_SOURCE_SEC) {
            throw businessError('MEDIA_TOO_LONG', `素材时长 ${durationSec} 秒，超过上限 ${MAX_SOURCE_SEC} 秒`);
          }
          if (segments.length === 0) {
            throw businessError('NO_SPEECH', '素材中没有可转写的语音，请改用手动指定区间');
          }
          const trimmed = segments.slice(0, MAX_TRANSCRIPT_SEGMENTS);
          const record = await saveTranscript(userId, { language, segments: trimmed, sourceUrl });
          return {
            transcriptId: record.id,
            language: record.language,
            durationSec: durationSec || Math.ceil(trimmed[trimmed.length - 1].end),
            segmentCount: trimmed.length,
            segments: trimmed.slice(0, 500),
          };
        }

        return withSource(sourceUrl, async (file, info) => {
          if (info.durationSec > MAX_SOURCE_SEC) {
            throw businessError('MEDIA_TOO_LONG', `素材时长超过上限 ${MAX_SOURCE_SEC} 秒`);
          }
          const audioFile = `${file}.wav`;
          try {
            await execFileAsync(ffmpegPath, [
              '-y', '-i', file, '-vn', '-ac', '1', '-ar', '16000',
              '-c:a', 'pcm_s16le', audioFile,
            ], { timeout: FFMPEG_TIMEOUT_MS });
          } catch {
            throw businessError('INVALID_MEDIA', '音轨提取失败，请确认素材包含可读音频');
          }

          const form = new FormData();
          form.set('file', new Blob([await fs.readFile(audioFile)], { type: 'audio/wav' }), 'audio.wav');
          form.set('model', config.model);
          form.set('response_format', 'verbose_json');
          if (language) form.set('language', language);
          if (wordTimestamps) form.set('timestamp_granularities[]', 'word');

          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), config.timeoutMs);
          let payload;
          try {
            const res = await fetchImpl(config.url, {
              method: 'POST',
              headers: { authorization: `Bearer ${config.apiKey}` },
              body: form,
              signal: controller.signal,
            });
            const text = await res.text();
            payload = text ? JSON.parse(text) : {};
            if (!res.ok) {
              throw businessError('ASR_FAILED', `转写服务返回 HTTP ${res.status}`);
            }
          } catch (error) {
            if (error?.name === 'AbortError') throw businessError('ASR_TIMEOUT', '转写超时，请缩短素材后重试');
            if (error?.code) throw error;
            throw businessError('ASR_FAILED', '转写服务调用失败');
          } finally {
            clearTimeout(timer);
            await removeQuietly(audioFile);
          }

          let segments = Array.isArray(payload.segments)
            ? payload.segments
              .map((item) => ({
                start: Number(item.start),
                end: Number(item.end),
                text: String(item.text || '').trim(),
              }))
              .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end)
                && item.end > item.start && item.text)
            : [];
          if (segments.length === 0 && typeof payload.text === 'string' && payload.text.trim()) {
            segments = [{ start: 0, end: info.durationSec, text: payload.text.trim() }];
          }
          if (segments.length === 0) {
            throw businessError('NO_SPEECH', '素材中没有可转写的语音，请改用手动指定区间');
          }
          segments = segments.slice(0, MAX_TRANSCRIPT_SEGMENTS);

          const record = await saveTranscript(userId, {
            language: String(payload.language || language || ''),
            segments,
            sourceUrl,
          });
          return {
            transcriptId: record.id,
            language: record.language,
            durationSec: info.durationSec,
            segmentCount: segments.length,
            segments: segments.slice(0, 500),
          };
        });
      },
    },
    {
      name: 'find_hooks',
      description: '按气口、口癖、信息密度与情绪强度给候选区间打分，返回可裁剪的高完播片段。',
      inputSchema: {
        type: 'object',
        properties: {
          transcriptId: { type: 'string', description: '转写记录 ID，与 segments 二选一' },
          segments: {
            type: 'array',
            description: '直接传入的逐句文本，形如 [{start,end,text}]；与 transcriptId 二选一',
            items: {
              type: 'object',
              properties: {
                start: { type: 'number' },
                end: { type: 'number' },
                text: { type: 'string' },
              },
              required: ['start', 'end', 'text'],
              additionalProperties: false,
            },
          },
          count: { type: 'integer', minimum: 1, maximum: MAX_HOOKS, description: '候选数量，1-20' },
          minSec: { type: 'integer', minimum: 5, maximum: 120, description: '单片段最短时长，默认 15' },
          maxSec: { type: 'integer', minimum: 10, maximum: 120, description: '单片段最长时长，默认 60' },
          removeFillers: { type: 'boolean', description: '是否在评分时计入口癖与停顿，默认开启' },
        },
        additionalProperties: false,
      },
      handler: async (args = {}, { userId }) => {
        const transcriptId = readString(args.transcriptId, 'transcriptId', { max: 64 });
        let segments;
        if (transcriptId) {
          segments = (await loadTranscript(userId, transcriptId)).segments;
        } else if (Array.isArray(args.segments)) {
          segments = normalizeSegments(args.segments);
        } else {
          throw paramError('缺少 transcriptId 或 segments');
        }
        const count = readInt(args.count, 'count', { required: true, min: 1, max: MAX_HOOKS });
        const minSec = readInt(args.minSec, 'minSec', { min: 5, max: 120 }) || 15;
        const maxSec = readInt(args.maxSec, 'maxSec', { min: 10, max: 120 }) || 60;
        if (maxSec <= minSec) throw paramError('maxSec 必须大于 minSec');
        const removeFillers = readBool(args.removeFillers, 'removeFillers', true);
        const hooks = pickHooks(segments, { count, minSec, maxSec, removeFillers });
        return { count: hooks.length, minSec, maxSec, hooks };
      },
    },
    {
      name: 'cut_video',
      description: '按候选区间裁剪并重编码，统一分辨率、帧率与响度；支持一次提交多个区间。',
      inputSchema: {
        type: 'object',
        properties: {
          sourceUrl: { type: 'string', description: '素材地址' },
          ranges: {
            type: 'array',
            description: '区间列表，每项 {start,end}，单次最多 20 段',
            items: {
              type: 'object',
              properties: {
                start: { type: 'number', minimum: 0 },
                end: { type: 'number', minimum: 0 },
              },
              required: ['start', 'end'],
              additionalProperties: false,
            },
          },
          aspect: {
            type: 'string',
            enum: ['original', '9:16', '1:1', '16:9'],
            description: '输出比例，默认保持原比例',
          },
          normalizeLoudness: { type: 'boolean', description: '是否统一响度，默认开启' },
        },
        required: ['sourceUrl', 'ranges'],
        additionalProperties: false,
      },
      handler: async (args = {}, { userId }) => {
        const sourceUrl = readString(args.sourceUrl, 'sourceUrl', { required: true, max: 2000 });
        // 先校验区间，避免参数错误时触发一次无谓的下载。
        const ranges = readRanges(args.ranges);
        const aspect = readAspect(args.aspect);
        const normalizeLoudness = readBool(args.normalizeLoudness, 'normalizeLoudness', true);
        return withSource(sourceUrl, async (file, info) => {
          if (info.durationSec > MAX_SOURCE_SEC) {
            throw businessError('MEDIA_TOO_LONG', `素材时长超过上限 ${MAX_SOURCE_SEC} 秒`);
          }
          const clips = [];
          for (const range of ranges) {
            if (range.end > info.durationSec + 0.5) {
              throw businessError('INVALID_RANGE', `区间 ${range.start}-${range.end} 超出素材时长 ${info.durationSec} 秒`);
            }
            const clipId = `vc-${crypto.randomUUID().replaceAll('-', '')}`;
            const output = path.join(mediaDir, `${clipId}.mp4`);
            await runCut(file, output, range, { aspect, hasAudio: info.hasAudio, normalizeLoudness });
            const cover = await makeCover(`${clipId}.mp4`);
            const record = await saveClipMeta({
              clipId,
              userId,
              file: `${clipId}.mp4`,
              coverFile: cover,
              start: range.start,
              end: range.end,
              durationSec: Math.round((range.end - range.start) * 100) / 100,
              sourceUrl,
              createdAt: new Date().toISOString(),
            });
            clips.push(assetUrls(record));
          }
          return { count: clips.length, aspect, clips };
        });
      },
    },
    {
      name: 'burn_subtitles',
      description: '按转写结果生成字幕，支持压制进画面或输出外挂字幕文件。',
      inputSchema: {
        type: 'object',
        properties: {
          clipIds: {
            type: 'array',
            items: { type: 'string' },
            description: '需要加字幕的片段 ID 列表，单次最多 20 个',
          },
          transcriptId: { type: 'string', description: '转写记录 ID' },
          mode: { type: 'string', enum: ['burn', 'sidecar'], description: 'burn 压制进画面，sidecar 外挂字幕，默认 sidecar' },
          style: { type: 'string', maxLength: 80, description: '字幕样式，如 FontSize=18,Outline=2' },
        },
        required: ['clipIds', 'transcriptId'],
        additionalProperties: false,
      },
      handler: async (args = {}, { userId }) => {
        const clipIds = readIdList(args.clipIds, 'clipIds', { max: MAX_RANGES });
        const transcript = await loadTranscript(userId, readString(args.transcriptId, 'transcriptId', { required: true, max: 64 }));
        const mode = args.mode === undefined ? 'sidecar' : args.mode;
        if (mode !== 'burn' && mode !== 'sidecar') throw paramError('mode 只支持 burn 或 sidecar');
        const style = readString(args.style, 'style', { max: 80 });
        if (style && !/^[A-Za-z0-9=,._\- ]+$/.test(style)) {
          throw paramError('style 只允许 FontSize=18,Outline=2 这类样式片段');
        }

        const items = [];
        for (const clipId of clipIds) {
          const record = await loadClipMeta(userId, clipId);
          const cues = transcript.segments.filter((seg) => seg.end > record.start && seg.start < record.end);
          if (cues.length === 0) {
            throw businessError('NO_SPEECH', `片段 ${clipId} 对应区间没有可用的字幕`);
          }
          const srtFile = `${clipId}.srt`;
          await fs.writeFile(path.join(mediaDir, srtFile), renderSrt(cues, record.start), 'utf8');
          record.subtitleFile = srtFile;

          if (mode === 'burn') {
            const burnedFile = `${clipId}-sub.mp4`;
            await runBurn(path.join(mediaDir, record.file), path.join(mediaDir, srtFile),
              path.join(mediaDir, burnedFile), style);
            record.burnedFile = burnedFile;
          }
          await saveClipMeta(record);
          items.push({ ...assetUrls(record), subtitleUrl: clipUrl(srtFile) });
        }
        return { mode, count: items.length, clips: items };
      },
    },
    {
      name: 'export_clips',
      description: '导出指定片段：补齐封面并返回可直接发布的视频、封面与字幕地址。',
      inputSchema: {
        type: 'object',
        properties: {
          clipIds: { type: 'array', items: { type: 'string' }, description: '要导出的片段 ID 列表' },
          cover: { type: 'boolean', description: '是否同时产出封面，默认开启' },
        },
        required: ['clipIds'],
        additionalProperties: false,
      },
      handler: async (args = {}, { userId }) => {
        const clipIds = readIdList(args.clipIds, 'clipIds', { max: MAX_RANGES });
        const withCover = readBool(args.cover, 'cover', true);
        const items = [];
        for (const clipId of clipIds) {
          const record = await loadClipMeta(userId, clipId);
          if (withCover && !record.coverFile) {
            record.coverFile = await makeCover(record.file);
            await saveClipMeta(record);
          }
          items.push(assetUrls(record));
        }
        return { count: items.length, clips: items };
      },
    },
    {
      name: 'list_clips',
      description: '列出当前账号最近生成的片段，用于找回已导出结果。',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: async (_args, { userId }) => {
        await ensureDirs();
        const names = await fs.readdir(metaDir).catch(() => []);
        const records = [];
        for (const name of names) {
          if (!name.endsWith('.json')) continue;
          try {
            const record = JSON.parse(await fs.readFile(path.join(metaDir, name), 'utf8'));
            if (record.userId === userId) records.push(record);
          } catch {
            // 损坏的元数据跳过
          }
        }
        records.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
        return { count: records.length, clips: records.slice(0, 100).map(assetUrls) };
      },
    },
    {
      name: 'delete_clip',
      description: '删除当前账号名下的指定片段及其封面、字幕文件。',
      inputSchema: {
        type: 'object',
        properties: { clipId: { type: 'string', description: '片段 ID' } },
        required: ['clipId'],
        additionalProperties: false,
      },
      handler: async (args = {}, { userId }) => {
        const record = await loadClipMeta(userId, readString(args.clipId, 'clipId', { required: true, max: 64 }));
        for (const file of clipFiles(record)) {
          await removeQuietly(path.join(mediaDir, file));
        }
        await removeQuietly(clipMetaPath(record.clipId));
        return { deleted: true, clipId: record.clipId };
      },
    },
    {
      name: 'concat_clips',
      description: '按顺序拼接多个片段，输出一条新的视频。',
      inputSchema: {
        type: 'object',
        properties: {
          clipIds: {
            type: 'array',
            items: { type: 'string' },
            description: '按顺序拼接的片段 ID，2-10 个',
          },
        },
        required: ['clipIds'],
        additionalProperties: false,
      },
      handler: async (args = {}, { userId }) => {
        const clipIds = readIdList(args.clipIds, 'clipIds', { min: 2, max: MAX_CONCAT_CLIPS });
        const records = [];
        let total = 0;
        for (const clipId of clipIds) {
          const record = await loadClipMeta(userId, clipId);
          total += Number(record.durationSec) || 0;
          records.push(record);
        }
        if (total > MAX_CONCAT_SEC) {
          throw businessError('MEDIA_TOO_LONG', `拼接后超过 ${MAX_CONCAT_SEC} 秒上限`);
        }
        await ensureDirs();
        const listFile = path.join(sourceDir, `${crypto.randomUUID().replaceAll('-', '')}.txt`);
        await fs.writeFile(listFile, records
          .map((record) => `file '${String(path.join(mediaDir, record.file)).replace(/'/g, "'\\''")}'`)
          .join('\n'), 'utf8');
        const clipId = `vc-${crypto.randomUUID().replaceAll('-', '')}`;
        const output = path.join(mediaDir, `${clipId}.mp4`);
        try {
          await execFileAsync(ffmpegPath, [
            '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', output,
          ], { timeout: FFMPEG_TIMEOUT_MS });
        } catch (error) {
          logger?.warn?.({ err: error }, 'concat clips failed');
          throw businessError('CUT_FAILED', '片段拼接失败，请确认片段格式一致');
        } finally {
          await removeQuietly(listFile);
        }
        const cover = await makeCover(`${clipId}.mp4`);
        const record = await saveClipMeta({
          clipId,
          userId,
          file: `${clipId}.mp4`,
          coverFile: cover,
          durationSec: Math.round(total * 100) / 100,
          sourceClipIds: records.map((item) => item.clipId),
          createdAt: new Date().toISOString(),
        });
        return { clipId: record.clipId, durationSec: record.durationSec, ...assetUrls(record) };
      },
    },
  ];

  // —— ffmpeg 调用 ——

  function readRanges(input) {
    if (!Array.isArray(input) || input.length === 0) throw paramError('ranges 必须是非空数组');
    if (input.length > MAX_RANGES) throw paramError(`ranges 超过上限 ${MAX_RANGES}`);
    const ranges = [];
    for (const item of input) {
      const start = Number(item?.start);
      const end = Number(item?.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
        throw paramError('ranges 的 start/end 不合法');
      }
      if (end - start > MAX_CLIP_SEC) {
        throw paramError(`单段时长不能超过 ${MAX_CLIP_SEC} 秒`);
      }
      if (end - start < 1) throw paramError('单段时长至少 1 秒');
      ranges.push({ start: Math.round(start * 100) / 100, end: Math.round(end * 100) / 100 });
    }
    return ranges;
  }

  function aspectFilter(aspect) {
    const map = {
      '9:16': 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
      '1:1': 'scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080',
      '16:9': 'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080',
    };
    return map[aspect] || '';
  }

  async function runCut(source, output, range, { aspect, hasAudio, normalizeLoudness }) {
    const filter = aspectFilter(aspect);
    const args = ['-y', '-ss', String(range.start), '-to', String(range.end), '-i', source];
    if (filter) args.push('-vf', filter);
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p');
    if (hasAudio) {
      args.push('-c:a', 'aac', '-b:a', '128k');
      if (normalizeLoudness) args.push('-af', 'loudnorm=I=-16:TP=-1.5:LRA=11');
    } else {
      args.push('-an');
    }
    args.push('-movflags', '+faststart', output);
    try {
      await execFileAsync(ffmpegPath, args, { timeout: FFMPEG_TIMEOUT_MS });
    } catch (error) {
      logger?.warn?.({ err: error, range }, 'cut video failed');
      throw businessError('CUT_FAILED', '片段裁剪失败，请确认素材可读后重试');
    }
  }

  async function runBurn(source, srt, output, style) {
    const filter = `subtitles=${escapeFilterPath(srt)}${style ? `:force_style='${style}'` : ''}`;
    try {
      await execFileAsync(ffmpegPath, [
        '-y', '-i', source, '-vf', filter,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', output,
      ], { timeout: FFMPEG_TIMEOUT_MS });
    } catch (error) {
      logger?.warn?.({ err: error }, 'burn subtitles failed');
      throw businessError('SUBTITLE_FAILED', '字幕压制失败，请改用 sidecar 外挂字幕');
    }
  }

  function renderSrt(cues, clipStart) {
    const blocks = cues.map((cue, index) => {
      const start = Math.max(0, cue.start - clipStart);
      const end = Math.max(start + 0.2, cue.end - clipStart);
      return `${index + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${cue.text.trim()}\n`;
    });
    return `${blocks.join('\n')}\n`;
  }

  function list() {
    return definitions.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
  }

  function get(name) {
    return definitions.find((tool) => tool.name === name) || null;
  }

  return { list, get, MAX_RANGES, MAX_HOOKS };
}

module.exports = {
  createVideoTools,
  paramError,
  isPrivateAddress,
  MAX_RANGES,
  MAX_CLIP_SEC,
  MAX_SOURCE_SEC,
};
