'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from './icons';

export default function Header() {
  const pathname = usePathname() || '/';
  const onHome = pathname === '/';
  const onTools = pathname === '/tools' || pathname.startsWith('/tools/');
  const onModels = pathname === '/models' || pathname.startsWith('/models/');
  const onPlatform = pathname === '/platform' || pathname.startsWith('/platform/');
  const onDevelopers = pathname === '/developers' || pathname.startsWith('/developers/');
  const [open, setOpen] = useState(false);

  /* 路由变化后收起移动端菜单 */
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const close = () => setOpen(false);

  return (
    <header className="header">
      <div className="header-inner">
        <Link className="brand" href="/" aria-label="开放精灵 OpenElf 首页" onClick={close}>
          <span className="brand-mark">
            <img className="brand-logo" src="/logo.png" alt="" />
          </span>
          <span className="brand-name">OpenElf</span>
          <span className="brand-cn">开放精灵</span>
        </Link>

        <nav className="nav" aria-label="主导航">
          <Link className={onHome ? 'nav-link nav-link--active' : 'nav-link'} href="/">
            首页
          </Link>
          <a className="nav-link" href="/#world">
            舞台
          </a>
          <a className="nav-link" href="/#powers">
            资源
          </a>
          <a className="nav-link" href="/#own">
            持有
          </a>
          <Link className={onTools ? 'nav-link nav-link--active' : 'nav-link'} href="/tools/">
            全球AI
          </Link>
          <Link className={onModels ? 'nav-link nav-link--active' : 'nav-link'} href="/models/">
            全球大模型
          </Link>
          <Link
            className={onPlatform ? 'nav-link nav-link--active' : 'nav-link'}
            href="/platform/"
          >
            模型聚合
          </Link>
          <Link
            className={onDevelopers ? 'nav-link nav-link--active' : 'nav-link'}
            href="/developers/"
          >
            开发者
          </Link>
        </nav>

        <div className="header-actions">
          <Link className="header-cta" href="/download/" onClick={close}>
            <Icon name="download" size={14} />
            下载 App
          </Link>
          <button
            type="button"
            className={open ? 'header-menu is-open' : 'header-menu'}
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? '关闭导航菜单' : '打开导航菜单'}
            onClick={() => setOpen((v) => !v)}
          >
            <span></span>
            <span></span>
            <span></span>
          </button>
        </div>
      </div>

      {open ? (
        <nav id="mobile-nav" className="mobile-nav" aria-label="移动端导航">
          <Link className={onHome ? 'mobile-nav-link is-active' : 'mobile-nav-link'} href="/">
            首页
          </Link>
          <a className="mobile-nav-link" href="/#world" onClick={close}>
            舞台
          </a>
          <a className="mobile-nav-link" href="/#powers" onClick={close}>
            资源
          </a>
          <a className="mobile-nav-link" href="/#own" onClick={close}>
            持有
          </a>
          <Link
            className={onTools ? 'mobile-nav-link is-active' : 'mobile-nav-link'}
            href="/tools/"
          >
            全球AI
          </Link>
          <Link
            className={onModels ? 'mobile-nav-link is-active' : 'mobile-nav-link'}
            href="/models/"
          >
            全球大模型
          </Link>
          <Link
            className={onPlatform ? 'mobile-nav-link is-active' : 'mobile-nav-link'}
            href="/platform/"
          >
            模型聚合
          </Link>
          <Link
            className={onDevelopers ? 'mobile-nav-link is-active' : 'mobile-nav-link'}
            href="/developers/"
          >
            开发者
          </Link>
        </nav>
      ) : null}
    </header>
  );
}
