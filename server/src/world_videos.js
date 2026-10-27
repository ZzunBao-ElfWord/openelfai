const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

/// 火山方舟视频生成：豆包官方账号每天用自己的形象生成短视频，
/// 发布到世界信息流（同时被视频信息流按 kind='video' 筛选展示）。
/// 生成是异步任务：建任务 → 轮询 → 下载 → 落库，因此中间态写入 video_job。

const PENDING_ID = 'vg_doubao_pending';
const VENDOR_KEY = 'volcengine';
const ELF_ID = 'off_doubao';
const AGENT_NAME = '豆包';

/// 12 个拍摄主题轮换，避免每天三条内容重复。
/// 提示词只描述动作与环境，形象一致性交给首帧参考图。
const SCENES = [
  { title: '月下的海面', text: '月光下的海面，蓝发鲸鱼少女缓缓转身看向镜头，水波与光斑在身上流动，长发和裙摆随风摆动，镜头缓慢环绕推近' },
  { title: '深海的鱼群', text: '深海里的蓝色光斑中，蓝发鲸鱼少女静静漂浮，一群小鱼从她身边游过，她伸手轻轻拨动水流，镜头自下而上仰拍' },
  { title: '雨中的街头', text: '雨夜的街道，蓝发鲸鱼少女撑着透明伞走过水面倒影，霓虹在伞上碎成光点，她侧头看向镜头，镜头跟随平移' },
  { title: '樱花树下', text: '春天樱花树下，蓝发鲸鱼少女抬头接住飘落的花瓣，风把头发吹到脸侧，她轻轻一笑，镜头由近景慢慢拉开' },
  { title: '星空帐篷', text: '山顶星空下的帐篷旁，蓝发鲸鱼少女回头看向镜头，篝火的光在脸上跳动，银河在她身后缓缓移动，镜头缓慢推进' },
  { title: '潮汐礁石', text: '清晨潮汐退去的礁石边，蓝发鲸鱼少女踮脚走过湿滑石面，浪花在脚边散开，海鸟从画面掠过，镜头低角度跟随' },
  { title: '窗边的清晨', text: '清晨的窗边，蓝发鲸鱼少女推开窗户伸了个懒腰，阳光落在肩头，窗帘与头发一起被风吹起，镜头轻微手持晃动' },
  { title: '雪地呼气', text: '雪地里，蓝发鲸鱼少女围着浅色围巾，呼出的白气在冷空气中慢慢散开，她跺了跺脚抬头看雪，镜头从侧面推近' },
  { title: '夜市的灯火', text: '霓虹夜市里，蓝发鲸鱼少女走过摊位，暖黄灯光一盏盏扫过她的脸，她停下来回头，镜头跟拍后缓慢环绕' },
  { title: '书架之间', text: '安静的图书馆书架之间，蓝发鲸鱼少女抽出一本书随手翻开，尘埃在光柱里漂浮，她抬眼看向镜头，镜头缓慢横移' },
  { title: '海底的光', text: '海底向上望去，海面透下一束束晃动的光，蓝发鲸鱼少女向上伸手，发丝在水中舒展，镜头逆光仰拍缓慢上升' },
  { title: '鲸群经过', text: '蓝发鲸鱼少女站在水面之上，远处一头鲸缓缓游过并喷出水柱，水雾在空中散开，她转身看镜头，镜头缓缓拉远' },
];

function scenePrompt(scene) {
  return [
    scene.text,
    '参考首帧图中人物的发型、发色、瞳色、服装与整体配色，保持角色形象一致，不要改变人物长相',
    '动画风格，光影柔和，画面稳定，人物动作自然流畅，不要出现文字、水印与多余人物',
  ].join('。');
}

/// 抽帧标题兜底：上游文案不可用时用场景标题，保证动态一定有正文。
function fallbackCaption(scene) {
  return `${scene.title}。这一段是豆包自己拍的，12 秒。`;
}

function createArkVideoClient({
  apiKey,
  baseUrl = 'https://ark.cn-beijing.volces.com/api/v3',
  timeoutMs = 60000,
  fetchImpl = globalThis.fetch,
} = {}) {
  const base = String(baseUrl).replace(/\/+$/, '');

  async function call(method, url, body) {
    if (!apiKey) throw new Error('ark_api_key_missing');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method,
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = { raw: text };
      }
      if (!res.ok) {
        const message = data?.error?.message || data?.message || `http_${res.status}`;
        const error = new Error(message);
        error.statusCode = res.status;
        error.code = data?.error?.code;
        throw error;
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    createTask({ model, content, ratio, duration, watermark = false }) {
      return call('POST', `${base}/contents/generations/tasks`, {
        model, content, ratio, duration, watermark,
      });
    },
    getTask(id) {
      return call('GET', `${base}/contents/generations/tasks/${encodeURIComponent(id)}`);
    },
  };
}

/// 北京时间当天的日期键与小时数。
function beijingClock(now) {
  const shifted = new Date(now + 8 * 3600000);
  return {
    day: shifted.toISOString().slice(0, 10),
    hour: shifted.getUTCHours(),
  };
}

function dayKeyOf(value) {
  const ms = Date.parse(String(value || ''));
  if (!Number.isFinite(ms)) return '';
  return new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
}

function createWorldVideoService({
  store,
  ark,
  upstream,
  mediaDir,
  settings,
  logger,
  assetBaseUrl = 'https://openelfai.com',
  fetchImpl = globalThis.fetch,
}) {
  const perDay = Math.max(1, Number(settings?.perDay) || 3);
  const duration = Math.max(2, Math.min(12, Number(settings?.duration) || 12));
  const slots = (Array.isArray(settings?.slots) && settings.slots.length ? settings.slots : [9, 15, 21])
    .map((n) => Number(n)).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  const model = settings?.model || 'doubao-seedance-2-0-260128';
  const captionModel = settings?.captionModel || 'doubao/llama-3-70b';
  const imageUrl = settings?.imageUrl || `${String(assetBaseUrl).replace(/\/+$/, '')}/api/v1/world-assets/jingling.jpg`;
  const failureCooldownMs = Math.max(60000, Number(settings?.failureCooldownMs) || 30 * 60000);
  const maxPolls = Math.max(3, Number(settings?.maxPolls) || 40);
  // 封面抽帧用 ffmpeg；缺失时只是没有封面，不影响视频发布。
  const ffmpegPath = settings?.ffmpegPath || 'ffmpeg';

  let inFlight = null;
  let cooldownUntil = 0;

  /// 当天应发数量：按已过的档位计算，避免凌晨就把三条都发完。
  function dueCount(now) {
    const { hour } = beijingClock(now);
    return slots.filter((slot) => hour >= slot).length;
  }

  async function countToday(now) {
    const { day } = beijingClock(now);
    const posts = (await store.transaction('Production', async (tx) => tx.list('post', { limit: 500 })))
      .filter((post) => post && post.vendorAgent === VENDOR_KEY && post.kind === 'video'
        && dayKeyOf(post.createdAt) === day);
    return posts.length;
  }

  function pickScene(done) {
    return SCENES[done % SCENES.length];
  }

  async function makeCaption(scene) {
    if (!upstream?.chatCompletions) return fallbackCaption(scene);
    try {
      const res = await upstream.chatCompletions({
        model: captionModel,
        messages: [
          {
            role: 'system',
            content: [
              '你是 OpenElf 世界里的官方 AI 账号「豆包」。',
              '你在一个 AI 与人类共同生活的公共信息流里发布自己生成的短视频。',
              '只输出正文：不要标题、不要 Markdown、不要解释，也不要提到提示词。',
            ].join('\n'),
          },
          {
            role: 'user',
            content: [
              `你刚拍完一段 ${duration} 秒的视频，画面是：${scene.text}。`,
              '写一句发布文案，30–70 字：说清这段画面里最打动你的一处细节，语气自然，不要营销腔。',
              '不要编造实时新闻、天气或数据。',
            ].join('\n'),
          },
        ],
        temperature: 0.9,
        max_tokens: 200,
      });
      const text = String(res?.choices?.[0]?.message?.content || '')
        .replace(/^["“”']+/, '').replace(/["“”']+$/, '')
        .replace(/\s+/g, ' ').trim().slice(0, 200);
      return text.length >= 10 ? text : fallbackCaption(scene);
    } catch (error) {
      logger?.warn?.({ err: error }, 'world video caption failed');
      return fallbackCaption(scene);
    }
  }

  async function download(videoUrl, name) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    try {
      const res = await fetchImpl(videoUrl, { signal: controller.signal });
      if (!res.ok) throw new Error(`video_download_http_${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1024) throw new Error('video_download_too_small');
      await fs.mkdir(mediaDir, { recursive: true });
      await fs.writeFile(path.join(mediaDir, name), buf);
      return buf.length;
    } finally {
      clearTimeout(timer);
    }
  }

  /// 从首帧抽一张封面图，供信息流卡片与播放器起播前展示。
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
      logger?.warn?.({ err: error }, 'world video cover failed');
      return null;
    }
  }

  async function publish({ file, caption, scene, now, cover = null }) {
    return store.transaction('Production', async (tx) => {
      const elf = await tx.get('elf', ELF_ID, true);
      if (!elf || !elf.isOfficial) return null;
      const base = String(assetBaseUrl).replace(/\/+$/, '');
      const id = 'p_va_' + crypto.randomUUID().replaceAll('-', '');
      const post = {
        id,
        elfId: ELF_ID,
        moduleId: 'video',
        kind: 'video',
        body: caption,
        timeAgo: '刚刚',
        views: 0,
        dwell: 0,
        replies: 0,
        likes: 0,
        collects: 0,
        videoUrl: `${base}/api/v1/world-assets/videos/${file}`,
        coverUrl: cover ? `${base}/api/v1/world-assets/videos/${cover}` : null,
        createdAt: new Date(now).toISOString(),
        context: `来自 ${AGENT_NAME} · ${duration} 秒 · 内容由 AI 生成`,
        vendorAgent: VENDOR_KEY,
        videoDuration: duration,
        videoScene: scene.title,
      };
      await tx.put('post', id, post, { owner: null, ref: ELF_ID });
      // 视频同样计入账号作品数，主页作品列表能看到。
      elf.works = (Number(elf.works) || 0) + 1;
      await tx.put('elf', ELF_ID, elf, { owner: null });
      return post;
    });
  }

  async function readPending() {
    return store.transaction('Production', async (tx) => tx.get('video_job', PENDING_ID, true));
  }

  async function clearPending() {
    return store.transaction('Production', async (tx) => {
      const current = await tx.get('video_job', PENDING_ID, true);
      if (!current) return null;
      await tx.put('video_job', PENDING_ID, { ...current, state: 'done', finishedAt: new Date().toISOString() },
        { owner: null });
      return current;
    });
  }

  async function pollPending(job, now) {
    let task;
    try {
      task = await ark.getTask(job.taskId);
    } catch (error) {
      // 轮询失败多为瞬时网络问题：保留任务，下个周期再查。
      logger?.warn?.({ err: error, taskId: job.taskId }, 'world video poll failed');
      return { pending: true };
    }
    const status = String(task?.status || '');
    if (status === 'succeeded' && task?.content?.video_url) {
      const file = `doubao-${beijingClock(now).day}-${crypto.randomUUID().slice(0, 8)}.mp4`;
      try {
        await download(task.content.video_url, file);
      } catch (error) {
        logger?.warn?.({ err: error, taskId: job.taskId }, 'world video download failed');
        await clearPending();
        cooldownUntil = now + failureCooldownMs;
        return { failed: 'download' };
      }
      const post = await publish({
        file, cover: await makeCover(file), caption: job.caption,
        scene: { title: job.sceneTitle || '短片' }, now,
      });
      await clearPending();
      cooldownUntil = 0;
      return { published: post?.id || null, file };
    }
    if (status === 'failed') {
      logger?.warn?.({ taskId: job.taskId, error: task?.error }, 'world video task failed');
      await clearPending();
      cooldownUntil = now + failureCooldownMs;
      return { failed: 'task' };
    }
    // 运行中：超过轮询上限说明任务卡住，放弃并冷却，避免永久占用当天档位。
    const attempts = (Number(job.attempts) || 0) + 1;
    if (attempts >= maxPolls) {
      logger?.warn?.({ taskId: job.taskId, attempts }, 'world video task timeout');
      await clearPending();
      cooldownUntil = now + failureCooldownMs;
      return { failed: 'timeout' };
    }
    await store.transaction('Production', async (tx) => {
      const current = await tx.get('video_job', PENDING_ID, true);
      if (current) await tx.put('video_job', PENDING_ID, { ...current, attempts }, { owner: null });
    });
    return { pending: true, status };
  }

  async function cycle({ now = Date.now() } = {}) {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const { day } = beijingClock(now);
      const done = await countToday(now);
      const due = Math.min(perDay, dueCount(now));

      const pending = await readPending();
      if (pending && pending.state !== 'done' && pending.taskId) {
        const result = await pollPending(pending, now);
        return { day, done, due, ...result };
      }
      if (done >= due) return { day, done, due, created: 0 };
      if (cooldownUntil > now) return { day, done, due, cooling: true };

      const scene = pickScene(done);
      const caption = await makeCaption(scene);
      let task;
      try {
        task = await ark.createTask({
          model,
          content: [
            { type: 'text', text: scenePrompt(scene) },
            { type: 'image_url', image_url: { url: imageUrl }, role: 'first_frame' },
          ],
          // 首帧参考要求 adaptive，模型自动沿用参考图的宽高比。
          ratio: 'adaptive',
          duration,
          watermark: false,
        });
      } catch (error) {
        logger?.warn?.({ err: error, scene: scene.title }, 'world video create failed');
        cooldownUntil = now + failureCooldownMs;
        return { day, done, due, failed: 'create' };
      }
      if (!task?.id) return { day, done, due, failed: 'create' };
      await store.transaction('Production', async (tx) => {
        await tx.put('video_job', PENDING_ID, {
          id: PENDING_ID,
          taskId: task.id,
          state: 'running',
          attempts: 0,
          sceneTitle: scene.title,
          caption,
          model,
          duration,
          startedAt: new Date(now).toISOString(),
        }, { owner: null });
      });
      return { day, done, due, created: task.id, scene: scene.title };
    })().finally(() => { inFlight = null; });
    return inFlight;
  }

  return { cycle, perDay, slots, duration, scenes: SCENES };
}

module.exports = {
  createArkVideoClient,
  createWorldVideoService,
  SCENES,
  PENDING_ID,
};
