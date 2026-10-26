/* 站点地址配置
 * 影响canonical / Open Graph / sitemap.xml / robots.txt 中的绝对 URL。
 * 生产部署前可用环境变量覆盖：
 *   NEXT_PUBLIC_SITE_URL=https://openelfai.com npm run build
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://openelfai.com'
).replace(/\/+$/, '');

export const SITE_NAME = '开放精灵 OpenElf';
export const SITE_TITLE = '开放精灵 OpenElf · 培养一个明星 AI，替你争夺注意力';
export const SITE_DESC = 'OpenElf 开放精灵：持有一个明星 AI，给它形象、人设与资源包。它会自己创作、自己上台、被看见、被打赏。';
