'use strict';

/// 语音合成：走 OpenAI 兼容的 /v1/audio/speech（国内多数厂商都兼容这一事实标准），
/// 产出 mp3 落盘到媒体目录，经 /api/v1/world-assets/audio/:file 对外播放。
/// 平台自持 Key，成本由「单次字数上限 + 每日调用配额」两道闸控制。
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];

function assetUrl(file) {
  return `/api/v1/world-assets/audio/${file}`;
}

function createTtsService({
  settings = {},
  mediaDir,
  assetBaseUrl = '',
  logger,
} = {}) {
  const baseUrl = String(settings.baseUrl || '').replace(/\/+$/, '');
  const apiKey = String(settings.apiKey || '');
  const model = String(settings.model || 'tts-1');
  const defaultVoice = String(settings.voice || 'alloy');
  const timeoutMs = Number(settings.timeoutMs) || 60000;
  const maxChars = Number(settings.maxChars) || 1000;
  const dailyLimit = Number(settings.dailyLimit) || 50;

  function isEnabled() {
    return settings.enabled !== false && !!baseUrl && !!apiKey;
  }

  function normalizeText(value) {
    const text = String(value || '').replace(/\r\n?/g, '\n').trim();
    if (!text) throw Object.assign(new Error('语音文本不能为空'), { statusCode: 400 });
    if (text.length > maxChars) {
      throw Object.assign(new Error(`语音文本超过 ${maxChars} 字`), { statusCode: 400 });
    }
    return text;
  }

  function normalizeVoice(value) {
    const voice = typeof value === 'string' ? value.trim() : '';
    if (!voice) return defaultVoice;
    // 只允许契约内的音色名，避免把任意字符串拼进上游请求。
    if (!DEFAULT_VOICES.includes(voice)) {
      throw Object.assign(new Error(`不支持的音色：${voice}`), { statusCode: 400 });
    }
    return voice;
  }

  /// 合成并落盘；返回可直接下发给客户端的播放地址。
  async function synthesize({ text: rawText, voice } = {}) {
    if (!isEnabled()) {
      throw Object.assign(new Error('语音能力未启用'), { statusCode: 503 });
    }
    const text = normalizeText(rawText);
    const chosenVoice = normalizeVoice(voice);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl}/v1/audio/speech`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          input: text,
          voice: chosenVoice,
          response_format: 'mp3',
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        throw Object.assign(new Error(`语音上游返回 ${res.status}`), { statusCode: 502 });
      }
      const contentType = String(res.headers.get('content-type') || '');
      if (!contentType.startsWith('audio/')) {
        throw Object.assign(new Error('语音上游返回的不是音频'), { statusCode: 502 });
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_BYTES) {
        throw Object.assign(new Error('语音文件体积超限'), { statusCode: 502 });
      }

      const file = `tts_${crypto.randomBytes(10).toString('hex')}.mp3`;
      await fs.mkdir(mediaDir, { recursive: true });
      await fs.writeFile(path.join(mediaDir, file), buf);

      const base = String(assetBaseUrl || '').replace(/\/+$/, '');
      return {
        audioUrl: `${base}${assetUrl(file)}`,
        bytes: buf.length,
        chars: text.length,
        voice: chosenVoice,
        model,
      };
    } catch (error) {
      if (error.statusCode) throw error;
      logger?.warn?.({ err: error }, 'tts synthesize failed');
      throw Object.assign(new Error('语音合成失败'), { statusCode: 502 });
    } finally {
      clearTimeout(timer);
    }
  }

  return { isEnabled, synthesize, maxChars, dailyLimit, voices: DEFAULT_VOICES };
}

module.exports = { createTtsService, DEFAULT_VOICES, MAX_BYTES };
