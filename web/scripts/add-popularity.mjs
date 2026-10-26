/* 为 data/tools.json 每条记录写入 popularity 知名度分值（1-100）。
 * 评分依据产品公众知名度与用户量级的人工判断，仅用于默认排序。
 * 用法：node scripts/add-popularity.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataPath = join(root, 'data', 'tools.json');

const SCORES = {
  /* ── 国内应用 ── */
  doubao: 98, deepseek: 99, kimi: 90, wenxin: 86, 'tongyi-qianwen': 87,
  chatglm: 82, xinghuo: 85, yuanbao: 90, sensechat: 68, yuewen: 66,
  jimeng: 85, wanxiang: 78, 'wenxin-yige': 68, liblib: 72, tusiart: 66,
  whee: 64, kolors: 72, klingai: 90, hailuoai: 82, vidu: 74, tingwu: 70,
  jianying: 95, xfzhizuo: 64, zenvideo: 66, lingma: 72, comate: 68,
  codegeex: 62, trae: 76, 'tencent-copilot': 60, 'wps-ai': 85, feishu: 92,
  dingtalk: 92, 'tencent-docs': 86, iflyrec: 72, wenku: 80, xiezuocat: 68,
  mindshow: 55, xmind: 75, 'canva-cn': 74, coze: 85, metaso: 78,
  tiangong: 72, 'nano-ai': 70, bocha: 50, baixiaoying: 55,
  'internlm-chat': 58, cogvideo: 72, moyin: 60, skyreels: 60,
  pixverse: 70,

  /* ── 海外应用 ── */
  chatgpt: 100, claude: 95, gemini: 95, copilot: 88, grok: 85, lechat: 70,
  'meta-ai': 85, poe: 75, 'character-ai': 80, huggingchat: 65, pi: 60,
  midjourney: 95, firefly: 80, ideogram: 72, leonardo: 75, stability: 78,
  flux: 72, recraft: 60, playground: 58, krea: 65, dalle: 85, runway: 85,
  pika: 75, sora: 90, suno: 85, udio: 75, elevenlabs: 85, heygen: 80,
  synthesia: 78, descript: 72, luma: 78, capcut: 92, murf: 62, tavus: 55,
  captions: 60, playht: 55, cursor: 92, 'github-copilot': 90, windsurf: 78,
  replit: 78, v0: 80, bolt: 72, lovable: 78, devin: 72, tabnine: 62,
  'amazon-q': 68, 'jetbrains-ai': 65, ollama: 85, notion: 90, gamma: 75,
  'm365-copilot': 85, grammarly: 82, otter: 70, canva: 95,
  'beautiful-ai': 60, slidesai: 55, quillbot: 75, jasper: 68,
  fireflies: 65, figma: 92, perplexity: 88, notebooklm: 80,
  'coze-com': 70, you: 65, phind: 58, zapier: 80, felo: 55,

  /* ── 大模型厂商 / 平台 ── */
  'openai-platform': 100, 'deepseek-platform': 95, 'anthropic-api': 92,
  'google-ai-studio': 92, 'vertex-ai': 85, 'xai-api': 85,
  'mistral-platform': 80, 'cohere-platform': 72, 'ai21-platform': 60,
  'perplexity-api': 70, 'meta-llama': 90, 'aliyun-bailian': 88,
  'volcengine-ark': 88, 'zhipu-open': 85, 'moonshot-open': 85,
  'minimax-open': 82, 'baidu-qianfan': 85, 'iflytek-open': 80,
  'tencent-hunyuan': 82, 'huawei-pangu': 80, 'stepfun-platform': 78,
  'baichuan-platform': 78, 'yi-platform': 78, 'sensenova-platform': 75,
  openbmb: 65, 'stability-platform': 75, bfl: 70, 'elevenlabs-api': 82,
  deepgram: 70, 'runway-api': 72, 'luma-api': 70, 'nvidia-nim': 80,
  'aws-bedrock': 85, 'azure-ai-foundry': 85, 'ibm-watsonx': 78, reka: 55,
  'aleph-alpha': 55, inworld: 60, hume: 60
};

const tools = JSON.parse(readFileSync(dataPath, 'utf8'));
const missing = tools.filter((t) => !(t.id in SCORES)).map((t) => t.id);
const extra = Object.keys(SCORES).filter((id) => !tools.some((t) => t.id === id));
if (missing.length || extra.length) {
  console.error('分值表与数据不匹配。缺失:', missing, '多余:', extra);
  process.exit(1);
}
tools.forEach((t) => {
  t.popularity = SCORES[t.id];
});
writeFileSync(dataPath, JSON.stringify(tools, null, 2) + '\n');
console.log('已为', tools.length, '条记录写入 popularity 分值');
