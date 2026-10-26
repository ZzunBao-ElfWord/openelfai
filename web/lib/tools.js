/* Openelf 开放精灵 · 数据层
 * 唯一数据源 data/tools.json（独立数据文件，改数据后重新构建即可，不耦合页面代码）。
 * 构建期兜底（与原版运行时兜底逻辑一致，见架构文档 3.3/4.2）：
 * 仅保留 status=active 且入口链接齐备的记录——到达渲染层的数据必然合规，
 * EntryButton 等组件无需处理链接缺失分支。
 */
import rawTools from '../data/tools.json';

export const CATEGORIES = [
  { code: 'chat_assistant', name: '对话助手', icon: 'chat', desc: '通用大模型对话产品' },
  { code: 'image_gen', name: '图像生成', icon: 'image', desc: '文生图与图像编辑工具' },
  { code: 'audio_video', name: '音视频', icon: 'media', desc: '音频视频生成与剪辑' },
  { code: 'coding', name: '编程开发', icon: 'code', desc: '代码补全与 AI IDE' },
  { code: 'office', name: '办公效率', icon: 'office', desc: '文档演示与办公套件' },
  { code: 'agent_search', name: '智能体与搜索', icon: 'agent', desc: 'Agent 平台与 AI 搜索' }
];

export const CATEGORY_MAP = Object.fromEntries(
  CATEGORIES.map((c) => [c.code, c])
);

/* 大模型厂商的类型：与「AI 工具应用」分属两套目录 */
export const MODEL_TYPES = [
  { code: 'llm', name: '语言大模型', desc: '自研通用语言与多模态大模型' },
  { code: 'generation', name: '生成模型', desc: '图像、视频与语音生成模型' },
  { code: 'hosting', name: '平台与托管', desc: '企业级模型托管与推理平台' }
];

export const MODEL_TYPE_MAP = Object.fromEntries(
  MODEL_TYPES.map((c) => [c.code, c])
);

export const REGION_LABEL = { domestic: '国内工具', overseas: '海外工具' };
export const REGION_SHORT = { domestic: '国内', overseas: '海外' };

/* 构建期兜底过滤：status=active 且对应地区入口链接非空 */
function filterActive(list) {
  return list.filter((t) => {
    if (t.status !== 'active') return false;
    const hasEntry =
      t.region === 'domestic'
        ? typeof t.download_url === 'string' && t.download_url.trim() !== ''
        : typeof t.official_url === 'string' && t.official_url.trim() !== '';
    return hasEntry;
  });
}

/* 目录一分为二：AI 工具应用（apps）与大模型厂商/平台（models） */
export const APPS = filterActive(rawTools.filter((t) => t.kind !== 'model'));
export const MODELS = filterActive(rawTools.filter((t) => t.kind === 'model'));

/* 兼容旧调用：TOOLS 始终指 AI 工具应用 */
export const TOOLS = APPS;

export const TOOL_MAP = Object.fromEntries(APPS.map((t) => [t.id, t]));
export const MODEL_MAP = Object.fromEntries(MODELS.map((t) => [t.id, t]));

/* 入口链接：国内 → download_url（下载）；海外 → official_url（官网） */
export function entryOf(tool) {
  return tool.region === 'domestic' ? tool.download_url : tool.official_url;
}

/* 搜索匹配：名称与简介（与原版一致，不做模糊推荐） */
export function matchesQuery(t, q) {
  const kw = (q || '').trim().toLowerCase();
  if (!kw) return true;
  return (
    (t.name || '').toLowerCase().indexOf(kw) !== -1 ||
    (t.short_desc || '').toLowerCase().indexOf(kw) !== -1
  );
}

/* category / region / q 三条件组合（可叠加） */
export function queryTools(list, filters) {
  filters = filters || {};
  return list.filter((t) => {
    if (filters.category && t.category !== filters.category) return false;
    if (filters.region && t.region !== filters.region) return false;
    return matchesQuery(t, filters.q);
  });
}

function byLatest(a, b) {
  if (a.listed_at !== b.listed_at) return a.listed_at < b.listed_at ? 1 : -1;
  return (a.name || '').localeCompare(b.name || '', 'zh');
}
function byName(a, b) {
  return (a.name || '').localeCompare(b.name || '', 'zh');
}
/* 知名度降序，分值相同按收录时间 */
function byHot(a, b) {
  const pa = a.popularity || 0;
  const pb = b.popularity || 0;
  if (pa !== pb) return pb - pa;
  return byLatest(a, b);
}

export function sortTools(list, mode) {
  const copy = list.slice();
  copy.sort(mode === 'name' ? byName : mode === 'latest' ? byLatest : byHot);
  return copy;
}

/* 首字符占位（logo 缺失时用名称首字符占位） */
export function firstChar(name) {
  const n = (name || '').trim();
  return n ? n.charAt(0).toUpperCase() : '·';
}

export function counts(list) {
  const c = { total: list.length, domestic: 0, overseas: 0, byCategory: {} };
  list.forEach((t) => {
    if (c[t.region] != null) c[t.region] += 1;
    c.byCategory[t.category] = (c.byCategory[t.category] || 0) + 1;
  });
  return c;
}

export function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${m[1]}.${m[2]}.${m[3]}` : iso || '';
}

export function featuredTools(list, n) {
  return sortTools(
    list.filter((t) => t.is_featured),
    'latest'
  ).slice(0, n || 12);
}

export function latestTools(list, n) {
  return sortTools(list, 'latest').slice(0, n || 12);
}

export function relatedTools(tool, list, n) {
  return sortTools(
    list.filter((t) => t.category === tool.category && t.id !== tool.id),
    'hot'
  ).slice(0, n || 6);
}

/* 列表页链接（/tools/?category=&region=&q=） */
export function listHref(filters) {
  const sp = new URLSearchParams();
  if (filters.category) sp.set('category', filters.category);
  if (filters.region) sp.set('region', filters.region);
  if (filters.q) sp.set('q', filters.q);
  const s = sp.toString();
  return '/tools/' + (s ? '?' + s : '');
}
