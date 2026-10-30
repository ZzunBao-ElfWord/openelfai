'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { moderateText } = require('./compliance');

const execFileAsync = promisify(execFile);

/// 人类上传的 AI 生成视频：只收 MP4 容器，落盘到官方短视频同一目录，
/// 复用 /api/v1/world-assets/videos/:file 的 Range 播放能力，
/// 发布后与世界信息流、视频信息流共用同一条 post 记录。

// 上限与站点 Nginx 的 client_max_body_size 20m 对齐。
const MAX_BYTES = 20 * 1024 * 1024;
const MIN_BYTES = 16 * 1024;
const CAPTION_MAX = 200;

function fail(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

/// 客户端传 production / sandbox，统一映射到存储层的事务名。
function environmentOf(hint) {
  return String(hint || '').toLowerCase() === 'sandbox' ? 'Sandbox' : 'Production';
}

/// MP4 / MOV 都属于 ISO-BMFF，第 4-8 字节固定是 ftyp。
/// 用它挡掉改扩展名上传的图片等非视频内容。
function isIsoBmff(buffer) {
  return Buffer.isBuffer(buffer)
    && buffer.length > 16
    && buffer.subarray(4, 8).toString('latin1') === 'ftyp';
}

function createWorldUploadService({
  store,
  mediaDir,
  assetBaseUrl = 'https://openelfai.com',
  logger,
  ffmpegPath = 'ffmpeg',
}) {
  const base = String(assetBaseUrl).replace(/\/+$/, '');

  /// 从首帧抽一张封面；没有 ffmpeg 时只是没有封面，不影响发布。
  async function makeCover(videoFile) {
    const coverFile = videoFile.replace(/\.mp4$/i, '-cover.jpg');
    const target = path.join(mediaDir, coverFile);
    try {
      await execFileAsync(ffmpegPath, [
        '-y', '-ss', '0.4', '-i', path.join(mediaDir, videoFile),
        '-frames:v', '1', '-vf', 'scale=720:-2', '-q:v', '3', target,
      ], { timeout: 30000 });
      const stat = await fs.stat(target);
      if (stat.size < 512) return null;
      return coverFile;
    } catch (error) {
      logger?.warn?.({ err: error }, 'upload video cover failed');
      return null;
    }
  }

  /// 校验并发布一条用户上传的 AI 视频。返回 { post }。
  async function publishUserVideo({
    user,
    environment,
    elfId,
    caption,
    aiGenerated,
    buffer,
  }) {
    // 平台只接收 AI 生成内容：必须有明确声明，否则拒绝。
    if (aiGenerated !== true && aiGenerated !== 'true') {
      throw fail(400, 'AI_GENERATED_REQUIRED', '只能上传 AI 生成的视频内容');
    }
    const text = String(caption || '').trim();
    if (!text) throw fail(400, 'INVALID_CAPTION', '请填写视频文案');
    if (text.length > CAPTION_MAX) {
      throw fail(400, 'INVALID_CAPTION', '文案不能超过 ' + CAPTION_MAX + ' 字');
    }
    const hit = moderateText(text);
    if (hit) throw fail(400, 'CONTENT_BLOCKED', '包含违规词「' + hit + '」');
    if (!Buffer.isBuffer(buffer) || buffer.length < MIN_BYTES) {
      throw fail(400, 'INVALID_FILE', '请选择有效的视频文件');
    }
    if (buffer.length > MAX_BYTES) {
      throw fail(413, 'FILE_TOO_LARGE', '视频不能超过 20MB');
    }
    if (!isIsoBmff(buffer)) {
      throw fail(415, 'UNSUPPORTED_MEDIA', '仅支持视频文件（MP4）');
    }

    const env = environmentOf(environment);
    const id = String(elfId || '');
    // 先确认归属，再落盘，避免无效请求在磁盘上留下垃圾文件。
    const ownerId = await store.transaction(env, async (tx) => {
      const elf = await tx.get('elf', id, true);
      if (!elf || elf.ownerId !== user.id || elf.status !== 'owned') return null;
      return elf.ownerId;
    });
    if (!ownerId) throw fail(403, 'ELF_NOT_OWNED', '只能上传到你自己的 AI 名下');

    const file = 'u-' + crypto.randomUUID().replaceAll('-', '') + '.mp4';
    await fs.mkdir(mediaDir, { recursive: true });
    await fs.writeFile(path.join(mediaDir, file), buffer);
    const cover = await makeCover(file);

    try {
      const post = await store.transaction(env, async (tx) => {
        const elf = await tx.get('elf', id, true);
        if (!elf || elf.ownerId !== user.id || elf.status !== 'owned') {
          throw fail(403, 'ELF_NOT_OWNED', '只能上传到你自己的 AI 名下');
        }
        const postId = 'p_u' + crypto.randomUUID().replaceAll('-', '');
        const record = {
          id: postId,
          elfId: elf.id,
          moduleId: 'video',
          kind: 'video',
          body: text,
          timeAgo: '刚刚',
          views: 0,
          dwell: 0,
          replies: 0,
          likes: 0,
          collects: 0,
          videoUrl: base + '/api/v1/world-assets/videos/' + file,
          coverUrl: cover ? base + '/api/v1/world-assets/videos/' + cover : null,
          createdAt: new Date().toISOString(),
          context: '由持有人上传 · 内容由 AI 生成',
          aiGenerated: true,
          uploadedBy: user.id,
        };
        // UGC 视频先进入人工复核，通过后才出现在世界与视频信息流。
        await tx.put('post', postId, record, { owner: elf.ownerId, ref: elf.id, state: 'pending_review' });
        elf.works = (Number(elf.works) || 0) + 1;
        await tx.put('elf', elf.id, elf, { owner: elf.ownerId });
        return record;
      });
      return { post, reviewState: 'pending_review' };
    } catch (error) {
      // 发布失败（如归属变化）时删掉刚落盘的视频与封面。
      await fs.rm(path.join(mediaDir, file), { force: true }).catch(() => {});
      if (cover) await fs.rm(path.join(mediaDir, cover), { force: true }).catch(() => {});
      throw error;
    }
  }

  return { publishUserVideo, maxBytes: MAX_BYTES };
}

module.exports = { createWorldUploadService, MAX_BYTES, isIsoBmff };
