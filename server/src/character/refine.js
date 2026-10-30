'use strict';

const { getDefaultKeyPlain } = require('../platform/user_keys');

const REFINE_TIMEOUT_MS = 60_000;

const SKIP = (reason) => ({ skipped: true, reason });

async function readPlatformWallet(db, userId) {
  const [rows] = await db.execute(
    'SELECT balance_micro, frozen_micro FROM platform_wallets WHERE user_id = ?',
    [userId],
  );
  const row = rows[0];
  return {
    balance_micro: Number(row?.balance_micro || 0),
    frozen_micro: Number(row?.frozen_micro || 0),
  };
}

// 精修提示词：要求保结构，只提升质感与光影。
function buildRefinePrompt(card, traits = {}) {
  const style = String(card?.style || 'general');
  const name = String(card?.name || '');
  const description = String(card?.prompt || '').slice(0, 800);
  const persona = String(card?.persona || '').slice(0, 300);
  const partsText = Object.entries(traits)
    .map(([slot, id]) => `${slot}:${id}`)
    .join(', ');
  return [
    `请精修这张${style}风格的角色立绘（角色名：${name || '未命名'}）。`,
    description ? `角色描述：${description}` : '',
    persona ? `人格设定：${persona}` : '',
    partsText ? `形象配件：${partsText}` : '',
    '硬性要求：保持发型、发色、服装、配饰与整体轮廓完全不变，只提升材质、光影与清晰度；',
    '不要改变构图，不要添加文字、水印或额外人物。',
  ].filter(Boolean).join('');
}

// P0 阶段精修不是必须项：未配置、余额不足或上游异常都返回 skipped，绝不阻断生成。
async function refineCharacter({ db, userId, png, prompt, fetchImpl = fetch, env = process.env }) {
  const url = String(env.CHARACTER_REFINE_URL || '').trim();
  const model = String(env.CHARACTER_REFINE_MODEL || '').trim();
  if (!url || !model) return SKIP('not_configured');

  try {
    const apiKey = await getDefaultKeyPlain(db, userId);
    if (!apiKey) return SKIP('no_api_key');
    const wallet = await readPlatformWallet(db, userId);
    if (wallet.balance_micro - wallet.frozen_micro <= 0) return SKIP('insufficient_balance');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REFINE_TIMEOUT_MS);
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          prompt,
          image: `data:image/png;base64,${Buffer.from(png).toString('base64')}`,
          n: 1,
          size: '1024x1536',
          response_format: 'b64_json',
        }),
        signal: controller.signal,
      });
      if (!response.ok) return SKIP(`http_${response.status}`);
      const payload = await response.json().catch(() => null);
      const imageBase64 = payload?.data?.[0]?.b64_json || '';
      if (!imageBase64) return SKIP('empty_image');
      const costMicro = Number(payload?.usage?.cost_micro || payload?.cost_micro || 0);
      return {
        skipped: false,
        imageBase64,
        costMicro: Number.isFinite(costMicro) && costMicro > 0 ? Math.round(costMicro) : 0,
        model: payload?.model || model,
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (_) {
    return SKIP('request_failed');
  }
}

module.exports = { refineCharacter, buildRefinePrompt, REFINE_TIMEOUT_MS };
