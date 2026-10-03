/* 站点地址配置
 * 影响canonical / Open Graph / sitemap.xml / robots.txt 中的绝对 URL。
 * 生产部署前可用环境变量覆盖：
 *   NEXT_PUBLIC_SITE_URL=https://openelf.com npm run build
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://openelf.com'
).replace(/\/+$/, '');

export const SITE_NAME = '开放精灵 Openelf';
export const SITE_TITLE = '开放精灵 Openelf · 全球 AI 工具图鉴';
export const SITE_DESC =
  'Openelf 开放精灵：全球主流 AI 工具图鉴——国内工具直达下载，海外工具一键访问官网。';
