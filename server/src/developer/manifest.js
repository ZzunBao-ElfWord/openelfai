'use strict';

// 技能 manifest 的首版契约：单文件 node20 源码 + 声明式元数据。
// 这里只做「结构合法」校验，真正的隔离由沙箱 runner 负责。

const TRACKS = Object.freeze(['writing', 'visual', 'video', 'voice', 'knowledge', 'social']);
const RUNTIMES = Object.freeze(['node20']);
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{1,63}$/;

const SOURCE_LIMIT = 64 * 1024;
const BOOK_DIAMONDS_MIN = 18;
const BOOK_DIAMONDS_MAX = 999;

const LIMITS = Object.freeze({
  timeout_ms: { min: 1000, max: 15000, default: 8000 },
  max_llm_calls: { min: 0, max: 3, default: 2 },
  max_input_chars: { min: 1, max: 8000, default: 2000 },
});

// 单文件沙箱内不允许加载这些模块，也不允许读取进程环境。
const BLOCKED_PATTERNS = [
  ['child_process', /require\s*\(\s*['"](?:node:)?(?:child_process)['"]\s*\)/],
  ['fs', /require\s*\(\s*['"](?:node:)?fs(?:\/promises)?['"]\s*\)/],
  ['net', /require\s*\(\s*['"](?:node:)?(?:net|tls|http|https|dgram)['"]\s*\)/],
  ['vm', /require\s*\(\s*['"](?:node:)?(?:vm|worker_threads|cluster|module)['"]\s*\)/],
  ['process.env', /\bprocess\s*\.\s*env\b/],
  ['process.exit', /\bprocess\s*\.\s*exit\b/],
];

function fail(code, message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  return error;
}

function readText(value, field, { min = 1, max = 200 } = {}) {
  const text = typeof value === 'string' ? value.trim() : '';
  const length = [...text].length;
  if (length < min || length > max) {
    throw fail('INVALID_MANIFEST', `${field} 需为 ${min}-${max} 个字符`);
  }
  return text;
}

function readLimit(raw, key) {
  const rule = LIMITS[key];
  const value = raw?.[key];
  if (value === undefined || value === null || value === '') return rule.default;
  const number = Number(value);
  if (!Number.isInteger(number) || number < rule.min || number > rule.max) {
    throw fail('INVALID_MANIFEST', `limits.${key} 需为 ${rule.min}-${rule.max} 的整数`);
  }
  return number;
}

// 返回规范化后的 manifest，写库与调试都使用这一份，避免客户端字段漂移。
function validateManifest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw fail('INVALID_MANIFEST', 'manifest 必须是 JSON 对象');
  }

  const slug = readText(raw.slug, 'slug', { min: 2, max: 32 });
  if (!SLUG_RE.test(slug)) {
    throw fail('INVALID_MANIFEST', 'slug 只能包含小写字母、数字与中划线，且以字母或数字开头');
  }

  const name = readText(raw.name, 'name', { min: 2, max: 32 });
  const track = readText(raw.track, 'track', { min: 2, max: 24 });
  if (!TRACKS.includes(track)) {
    throw fail('INVALID_MANIFEST', `track 需为 ${TRACKS.join(' / ')} 之一`);
  }
  const summary = readText(raw.summary, 'summary', { min: 4, max: 140 });

  const runtime = raw.runtime === undefined || raw.runtime === null || raw.runtime === ''
    ? 'node20'
    : readText(raw.runtime, 'runtime', { min: 2, max: 16 });
  if (!RUNTIMES.includes(runtime)) {
    throw fail('INVALID_MANIFEST', 'runtime 目前仅支持 node20');
  }

  const modelsRaw = raw.models === undefined || raw.models === null ? [] : raw.models;
  if (!Array.isArray(modelsRaw) || modelsRaw.length > 5) {
    throw fail('INVALID_MANIFEST', 'models 需为不超过 5 项的数组');
  }
  const models = modelsRaw.map((item) => {
    const model = readText(item, 'models[]', { min: 2, max: 64 });
    if (!MODEL_RE.test(model)) throw fail('INVALID_MANIFEST', 'models 中存在不合法的模型 ID');
    return model;
  });

  const bookDiamonds = Number(raw.pricing?.book_diamonds);
  if (!Number.isInteger(bookDiamonds) || bookDiamonds < BOOK_DIAMONDS_MIN || bookDiamonds > BOOK_DIAMONDS_MAX) {
    throw fail(
      'INVALID_MANIFEST',
      `pricing.book_diamonds 需为 ${BOOK_DIAMONDS_MIN}-${BOOK_DIAMONDS_MAX} 的整数`,
    );
  }

  const limitsRaw = raw.limits && typeof raw.limits === 'object' ? raw.limits : {};
  const limits = {
    timeout_ms: readLimit(limitsRaw, 'timeout_ms'),
    max_llm_calls: readLimit(limitsRaw, 'max_llm_calls'),
    max_input_chars: readLimit(limitsRaw, 'max_input_chars'),
  };

  const samplesRaw = raw.samples === undefined || raw.samples === null ? [] : raw.samples;
  if (!Array.isArray(samplesRaw) || samplesRaw.length > 3) {
    throw fail('INVALID_MANIFEST', 'samples 需为不超过 3 项的数组');
  }
  const samples = samplesRaw.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw fail('INVALID_MANIFEST', 'samples 每一项需为对象');
    }
    return {
      title: readText(item.title, 'samples[].title', { min: 1, max: 40 }),
      input: item.input === undefined ? {} : item.input,
    };
  });

  return {
    slug,
    name,
    track,
    summary,
    runtime,
    models,
    pricing: { book_diamonds: bookDiamonds },
    limits,
    samples,
  };
}

// 源码校验：限制体积、必须导出 handler、拒绝明显的宿主访问。
function validateSource(source) {
  if (typeof source !== 'string' || !source.trim()) {
    throw fail('INVALID_SOURCE', '请提供技能源码');
  }
  if (Buffer.byteLength(source, 'utf8') > SOURCE_LIMIT) {
    throw fail('INVALID_SOURCE', `源码体积不能超过 ${Math.floor(SOURCE_LIMIT / 1024)}KB`);
  }
  if (!/exports\s*\.\s*handler\s*=/.test(source) && !/module\s*\.\s*exports\s*=/.test(source)) {
    throw fail('INVALID_SOURCE', '源码必须通过 exports.handler 导出处理函数');
  }
  for (const [label, pattern] of BLOCKED_PATTERNS) {
    if (pattern.test(source)) {
      throw fail('INVALID_SOURCE', `源码中不允许使用 ${label}`);
    }
  }
  return source;
}

module.exports = {
  TRACKS,
  LIMITS,
  SOURCE_LIMIT,
  BOOK_DIAMONDS_MIN,
  BOOK_DIAMONDS_MAX,
  validateManifest,
  validateSource,
};
