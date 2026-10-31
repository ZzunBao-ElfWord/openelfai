'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from './icons';
import { SITE_VARIANT, OPEN_SITE_URL } from '../lib/site';

export default function Header() {
  const pathname = usePathname() || '/';
  const isOpen = SITE_VARIANT === 'open';
  const onHome = pathname === '/';
  const onTools = pathname === '/tools' || pathname.startsWith('/tools/');
  const onModels = pathname === '/models' || pathname.startsWith('/models/');
  const onPlatform = pathname === '/platform' || pathname.startsWith('/platform/');
  const onDevelopers = pathname === '/developers' || pathname.startsWith('/developers/');
  const onDocs = pathname === '/docs' || pathname.startsWith('/docs/');
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
          <span className="brand-cn">{isOpen ? '开放平台' : '开放精灵'}</span>
        </Link>

        <nav className="nav" aria-label="主导航">
          {isOpen ? (
            <>
              <Link className={onHome ? 'nav-link nav-link--active' : 'nav-link'} href="/">
                首页
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
              <Link
                className={onDocs ? 'nav-link nav-link--active' : 'nav-link'}
                href="/docs/"
              >
                开发文档
              </Link>
              <a className="nav-link" href="/console/?view=developer">
                控制台
              </a>
            </>
          ) : (
            <>
          <Link className={onHome ? 'nav-link nav-link--active' : 'nav-link'} href="/">
            首页
          </Link>
          <Link className={onTools ? 'nav-link nav-link--active' : 'nav-link'} href="/tools/">
            全球AI
          </Link>
          <Link className={onModels ? 'nav-link nav-link--active' : 'nav-link'} href="/models/">
            全球大模型
          </Link>
          <div className="nav-group">
            <button
              type="button"
              className={
                onPlatform || onDevelopers || onDocs
                  ? 'nav-link nav-link--active nav-group-btn'
                  : 'nav-link nav-group-btn'
              }
              aria-haspopup="true"
            >
              开放平台
              <span className="nav-caret" aria-hidden="true" />
            </button>
            <div className="nav-menu" role="menu" aria-label="开放平台">
              <a className="nav-menu-link" href={`${OPEN_SITE_URL}/platform/`}>
                <b>模型聚合</b>
                <span>OpenAI 兼容接口，一个 Key 调所有模型</span>
              </a>
              <a className="nav-menu-link" href={`${OPEN_SITE_URL}/developers/`}>
                <b>开发者</b>
                <span>发布技能、专家与连接器</span>
              </a>
              <a className="nav-menu-link" href={`${OPEN_SITE_URL}/docs/`}>
                <b>开发文档</b>
                <span>入驻、规范与接口说明</span>
              </a>
            </div>
          </div>
            </>
          )}
        </nav>

        <div className="header-actions">
          {isOpen ? (
            <a className="header-cta" href="/console/?view=developer" onClick={close}>
              立即入驻
            </a>
          ) : (
            <Link className="header-cta" href="/download/" onClick={close}>
              <Icon name="download" size={14} />
              下载 App
            </Link>
          )}
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
          {isOpen ? (
            <>
              <Link className={onHome ? 'mobile-nav-link is-active' : 'mobile-nav-link'} href="/">
                首页
              </Link>
              <Link
                className={onPlatform ? 'mobile-nav-link is-active' : 'mobile-nav-link'}
                href="/platform/"
              >
                模型聚合
              </Link>
              <Link
                className={onDocs ? 'mobile-nav-link is-active' : 'mobile-nav-link'}
                href="/docs/"
              >
                开发文档
              </Link>
              <Link
                className={onDevelopers ? 'mobile-nav-link is-active' : 'mobile-nav-link'}
                href="/developers/"
              >
                开发者
              </Link>
              <a className="mobile-nav-link" href="/console/?view=developer" onClick={close}>
                控制台
              </a>
            </>
          ) : (
            <>
          <Link className={onHome ? 'mobile-nav-link is-active' : 'mobile-nav-link'} href="/">
            首页
          </Link>
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
          <a
            className={onPlatform ? 'mobile-nav-link is-active' : 'mobile-nav-link'}
            href={`${OPEN_SITE_URL}/platform/`}
            onClick={close}
          >
            模型聚合
          </a>
          <a
            className={onDevelopers ? 'mobile-nav-link is-active' : 'mobile-nav-link'}
            href={`${OPEN_SITE_URL}/developers/`}
            onClick={close}
          >
            开发者
          </a>
          <a
            className={onDocs ? 'mobile-nav-link is-active' : 'mobile-nav-link'}
            href={`${OPEN_SITE_URL}/docs/`}
            onClick={close}
          >
            开发文档
          </a>
            </>
          )}
        </nav>
      ) : null}
    </header>
  );
}
