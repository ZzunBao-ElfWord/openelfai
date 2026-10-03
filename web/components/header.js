'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from './icons';

export default function Header() {
  const pathname = usePathname() || '/';
  const onHome = pathname === '/';
  const onTools = pathname === '/tools' || pathname.startsWith('/tools/');
  return (
    <header className="header">
      <div className="header-inner">
        <Link className="brand" href="/">
          <span className="brand-mark">
            <Icon name="star4" size={19} />
          </span>
          <span className="brand-name">开放精灵</span>
          <span className="brand-en">OPENELF</span>
        </Link>
        <nav className="nav" aria-label="主导航">
          <Link className={onHome ? 'nav-link nav-link--active' : 'nav-link'} href="/">
            首页
          </Link>
          <Link className={onTools ? 'nav-link nav-link--active' : 'nav-link'} href="/tools/">
            全部工具
          </Link>
        </nav>
      </div>
    </header>
  );
}
