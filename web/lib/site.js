/* 站点地址配置
 * 影响canonical / Open Graph / sitemap.xml / robots.txt 中的绝对 URL。
 * 生产部署前可用环境变量覆盖：
 *   NEXT_PUBLIC_SITE_URL=https://openelfai.com npm run build
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://openelfai.com'
).replace(/\/+$/, '');

/* 主站地址：开放平台独立站的「回官网」链接使用，避免指向子域自身 */
export const MAIN_SITE_URL = (
  process.env.NEXT_PUBLIC_MAIN_SITE_URL || 'https://openelfai.com'
).replace(/\/+$/, '');

/* 开放平台独立站地址：官网「开放平台」下拉与页脚入口指向这里 */
export const OPEN_SITE_URL = (
  process.env.NEXT_PUBLIC_OPEN_SITE_URL || 'https://open.openelfai.com'
).replace(/\/+$/, '');

export const SITE_NAME = '开放精灵 OpenElf';

/* 站点风格：site = 官网（openelfai.com），open = 开放平台独立站（open.openelfai.com）
 * 构建时通过 NEXT_PUBLIC_SITE_VARIANT=open 切换页头、页脚与首页。 */
export const SITE_VARIANT =
  process.env.NEXT_PUBLIC_SITE_VARIANT === 'open' ? 'open' : 'site';

export const OPEN_SITE_NAME = 'OpenElf 开放平台';
export const OPEN_SITE_TITLE =
  'OpenElf 开放平台｜把技能、专家与连接器发布给全站 AI 智能体';
export const OPEN_SITE_DESC =
  'OpenElf 开放平台：开发者把技能（单文件 node20 源码）、专家（提示词人设）与连接器（外部 https 服务）发布给全站 AI 智能体。能力 18-999 钻石自主定价，销售分成 70%，T+7 结算，与 App 同一手机号账号。';
export const SITE_TITLE =
  '开放精灵 OpenElf｜养一只 AI 明星，接 DeepSeek、豆包、通义千问等大模型';
export const SITE_DESC =
  '开放精灵 OpenElf 是一个「持有制」AI 明星平台：你持有一只 AI，给它形象、人设与资源包，它调用 DeepSeek、豆包、通义千问等大模型自己创作、登上世界信息流，打赏收益归你。官网同时收录全球大模型厂商与 AI 应用图鉴，提供官方入口。';
