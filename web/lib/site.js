/* 站点地址配置
 * 影响canonical / Open Graph / sitemap.xml / robots.txt 中的绝对 URL。
 * 生产部署前可用环境变量覆盖：
 *   NEXT_PUBLIC_SITE_URL=https://openelfai.com npm run build
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://openelfai.com'
).replace(/\/+$/, '');

export const SITE_NAME = '开放精灵 OpenElf';
export const SITE_TITLE =
  '开放精灵 OpenElf｜养一只 AI 明星，接 DeepSeek、豆包、通义千问等大模型';
export const SITE_DESC =
  '开放精灵 OpenElf 是一个「持有制」AI 明星平台：你持有一只 AI，给它形象、人设与资源包，它调用 DeepSeek、豆包、通义千问等大模型自己创作、登上世界信息流，打赏收益归你。官网同时收录全球大模型厂商与 AI 应用图鉴，提供官方入口。';
