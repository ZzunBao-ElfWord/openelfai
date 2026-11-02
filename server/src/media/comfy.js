'use strict';

/// ComfyUI 出图：提交 workflow → 轮询 history → 下载图片落盘。
/// 只走 ComfyUI 标准的 /prompt、/history、/view 三个接口，不绑定任何自定义节点。
/// ComfyUI 通常是自建内网服务，这里只校验 http(s) 协议，不做内网地址拦截
/// （那是运维配置而非用户输入）；用户自带的 MCP Server 才需要 SSRF 防护。
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PROMPT_CHARS = 500;
const MAX_LORAS = 5;

/// 默认 SDXL 文生图工作流：7 个基础节点，任何 ComfyUI 安装都能直接跑。
/// 模板里的字符串值等于占位键时，会被运行时参数整体替换（含数字类型）。
const DEFAULT_WORKFLOW = {
  3: {
    class_type: 'KSampler',
    inputs: {
      seed: '__SEED__', steps: '__STEPS__', cfg: '__CFG__',
      sampler_name: 'euler', scheduler: 'normal', denoise: 1,
      model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0],
    },
  },
  4: {
    class_type: 'CheckpointLoaderSimple',
    inputs: { ckpt_name: '__CHECKPOINT__' },
  },
  5: {
    class_type: 'EmptyLatentImage',
    inputs: { width: '__WIDTH__', height: '__HEIGHT__', batch_size: 1 },
  },
  6: {
    class_type: 'CLIPTextEncode',
    inputs: { text: '__PROMPT__', clip: ['4', 1] },
  },
  7: {
    class_type: 'CLIPTextEncode',
    inputs: { text: '__NEGATIVE__', clip: ['4', 1] },
  },
  8: {
    class_type: 'VAEDecode',
    inputs: { samples: ['3', 0], vae: ['4', 2] },
  },
  9: {
    class_type: 'SaveImage',
    inputs: { filename_prefix: '__PREFIX__', images: ['8', 0] },
  },
};

const DEFAULT_NEGATIVE = '低质量, 模糊, 变形, 多余手指, 文字, 水印';

/// 深度替换：仅当字符串整体等于占位键时才替换，保证数字型参数不被字符串化。
function fillPlaceholders(node, vars) {
  if (Array.isArray(node)) return node.map((item) => fillPlaceholders(item, vars));
  if (node && typeof node === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(node)) out[key] = fillPlaceholders(value, vars);
    return out;
  }
  if (typeof node === 'string' && Object.prototype.hasOwnProperty.call(vars, node)) return vars[node];
  return node;
}

function fileForContentType(contentType) {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('webp')) return '.webp';
  if (type.includes('jpeg') || type.includes('jpg')) return '.jpg';
  return '.png';
}

/// 在内置工作流里插入 LoRA 链：model 与 clip 都从 checkpoint 出发依次穿过多层 LoraLoader。
/// 只对内置模板生效——自定义 workflow 的节点结构不可假设，强行改写容易出错。
function applyLoras(workflow, loras) {
  if (!Array.isArray(loras) || !loras.length) return workflow;
  if (!workflow?.['4'] || workflow['4'].class_type !== 'CheckpointLoaderSimple') return workflow;
  if (!workflow?.['3']) return workflow;

  // 深拷贝：DEFAULT_WORKFLOW 是模块常量，直接被改写会污染后续请求。
  const next = JSON.parse(JSON.stringify(workflow));
  let lastModelNode = '4';
  let lastClipNode = '4';
  let index = 100;
  for (const name of loras) {
    const id = String(index++);
    next[id] = {
      class_type: 'LoraLoader',
      inputs: {
        lora_name: name,
        strength_model: 1,
        strength_clip: 1,
        model: [lastModelNode, 0],
        clip: [lastClipNode, 1],
      },
    };
    lastModelNode = id;
    lastClipNode = id;
  }
  next['3'].inputs.model = [lastModelNode, 0];
  if (next['6']) next['6'].inputs.clip = [lastClipNode, 1];
  if (next['7']) next['7'].inputs.clip = [lastClipNode, 1];
  return next;
}

/// LoRA 名是 ComfyUI 的相对文件名，不允许路径穿越；超长或含分隔符的直接丢弃。
function normalizeLoras(loras) {
  if (!Array.isArray(loras)) return [];
  return loras
    .filter((name) => typeof name === 'string')
    .map((name) => name.trim().slice(0, 120))
    .filter((name) => name && !name.includes('..') && !name.includes('/') && !name.includes('\\'))
    .slice(0, MAX_LORAS);
}

function assetUrl(file) {
  return `/api/v1/world-assets/${file}`;
}

function createComfyService({ settings = {}, mediaDir, assetBaseUrl = '', logger } = {}) {
  const baseUrl = String(settings.baseUrl || '').replace(/\/+$/, '');
  const checkpoint = String(settings.checkpoint || '');
  const timeoutMs = Number(settings.timeoutMs) || 180000;
  const pollMs = Math.max(500, Number(settings.pollMs) || 1500);
  const workflowPath = String(settings.workflowPath || '');
  const dailyLimit = Number(settings.dailyLimit) || 100;

  function isEnabled() {
    return settings.enabled !== false && !!baseUrl;
  }

  async function loadTemplate() {
    if (!workflowPath) return { workflow: DEFAULT_WORKFLOW, builtin: true };
    try {
      const raw = await fs.readFile(workflowPath, 'utf8');
      return { workflow: JSON.parse(raw), builtin: false };
    } catch (error) {
      logger?.warn?.({ err: error, workflowPath }, 'ComfyUI workflow 读取失败，回退默认模板');
      return { workflow: DEFAULT_WORKFLOW, builtin: true };
    }
  }

  function clampInt(value, { min, max, fallback }) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.round(n)));
  }

  async function postJson(url, payload) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`ComfyUI 返回 ${res.status}`);
    return res.json();
  }

  /// 轮询 history 直到出图完成；超时直接失败，避免占住请求。
  async function waitForHistory(promptId, deadline) {
    while (Date.now() < deadline) {
      const res = await fetch(`${baseUrl}/history/${encodeURIComponent(promptId)}`);
      if (res.ok) {
        const history = await res.json().catch(() => ({}));
        const entry = history?.[promptId];
        if (entry && entry.outputs) {
          const images = [];
          for (const output of Object.values(entry.outputs)) {
            for (const image of output?.images || []) {
              if (image?.filename) images.push(image);
            }
          }
          if (images.length) return images[0];
        }
        // 明确失败状态立刻返回，不再空等。
        if (entry?.status?.status_str === 'error') throw new Error('ComfyUI 执行出错');
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    throw new Error('ComfyUI 出图超时');
  }

  async function generateImage({
    prompt: rawPrompt, negativePrompt, seed, width, height, steps, cfg, loras,
  } = {}) {
    if (!isEnabled()) {
      throw Object.assign(new Error('ComfyUI 出图能力未启用'), { statusCode: 503 });
    }
    const prompt = String(rawPrompt || '').trim();
    if (!prompt) throw Object.assign(new Error('prompt 不能为空'), { statusCode: 400 });
    if (prompt.length > MAX_PROMPT_CHARS) {
      throw Object.assign(new Error(`prompt 超过 ${MAX_PROMPT_CHARS} 字`), { statusCode: 400 });
    }

    const chosenSeed = clampInt(seed, { min: 0, max: 2 ** 31 - 1, fallback: crypto.randomInt(0, 2 ** 31 - 1) });
    const vars = {
      __PROMPT__: prompt,
      __NEGATIVE__: String(negativePrompt || '').trim() || DEFAULT_NEGATIVE,
      __SEED__: chosenSeed,
      __WIDTH__: clampInt(width, { min: 256, max: 1536, fallback: 1024 }),
      __HEIGHT__: clampInt(height, { min: 256, max: 1536, fallback: 1024 }),
      __STEPS__: clampInt(steps, { min: 4, max: 50, fallback: 25 }),
      __CFG__: clampInt(cfg, { min: 1, max: 20, fallback: 7 }),
      __CHECKPOINT__: checkpoint,
      __PREFIX__: `openelf_${crypto.randomBytes(4).toString('hex')}`,
    };
    if (!vars.__CHECKPOINT__) delete vars.__CHECKPOINT__;

    const deadline = Date.now() + timeoutMs;
    const appliedLoras = normalizeLoras(loras);
    try {
      const { workflow: template, builtin } = await loadTemplate();
      // 自定义工作流的结构不可假设，LoRA 只在节点结构已知的内置模板上注入。
      const withLoras = builtin && appliedLoras.length ? applyLoras(template, appliedLoras) : template;
      const workflow = fillPlaceholders(withLoras, vars);
      const submitted = await postJson(`${baseUrl}/prompt`, { prompt: workflow });
      const promptId = submitted?.prompt_id;
      if (!promptId) throw new Error('ComfyUI 未返回 prompt_id');

      const image = await waitForHistory(promptId, deadline);
      const query = new URLSearchParams({
        filename: image.filename,
        subfolder: image.subfolder || '',
        type: image.type || 'output',
      });
      const res = await fetch(`${baseUrl}/view?${query.toString()}`);
      if (!res.ok) throw new Error(`ComfyUI 取图返回 ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_BYTES) throw new Error('ComfyUI 图片体积超限');

      const file = `comfy_${crypto.randomBytes(10).toString('hex')}${fileForContentType(res.headers.get('content-type'))}`;
      await fs.mkdir(mediaDir, { recursive: true });
      await fs.writeFile(path.join(mediaDir, file), buf);

      const base = String(assetBaseUrl || '').replace(/\/+$/, '');
      return {
        imageUrl: `${base}${assetUrl(file)}`,
        seed: chosenSeed,
        bytes: buf.length,
        promptId,
        width: vars.__WIDTH__,
        height: vars.__HEIGHT__,
        loras: builtin ? appliedLoras : [],
        lorasApplied: builtin && appliedLoras.length > 0,
      };
    } catch (error) {
      if (error.statusCode) throw error;
      logger?.warn?.({ err: error }, 'comfy generate failed');
      throw Object.assign(new Error(error.message || 'ComfyUI 出图失败'), { statusCode: 502 });
    }
  }

  return { isEnabled, generateImage, fillPlaceholders, dailyLimit, DEFAULT_WORKFLOW };
}

module.exports = {
  createComfyService, fillPlaceholders, applyLoras, normalizeLoras,
  DEFAULT_WORKFLOW, MAX_PROMPT_CHARS,
};
