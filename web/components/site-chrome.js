'use client';

/* 站点外壳：控制台（/console）使用独立全屏深色布局，不渲染官网 Header/Footer；
 * 其余页面保持原有页头 / 页脚结构。 */
import { usePathname } from 'next/navigation';
import Header from './header';
import Footer from './footer';

export default function SiteChrome({ children }) {
  const pathname = usePathname() || '/';
  const bare = pathname === '/console' || pathname.startsWith('/console/');

  if (bare) return children;

  return (
    <div className="app">
      <Header />
      <main className="main">{children}</main>
      <Footer />
    </div>
  );
}
