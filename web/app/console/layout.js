/* 开发者控制台使用独立全屏布局（见 components/site-chrome.js），
 * 这里只补充页面级 metadata。 */
export const metadata = {
  title: '开发者控制台',
  description:
    'OpenElf 开放平台开发者控制台：查看余额、用量、API Key 与账单明细。',
  robots: { index: false, follow: false },
  alternates: { canonical: '/console/' }
};

export default function ConsoleLayout({ children }) {
  return children;
}
