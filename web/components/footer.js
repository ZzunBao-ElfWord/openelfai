import Link from 'next/link';
import { SITE_VARIANT, MAIN_SITE_URL, OPEN_SITE_URL } from '../lib/site';

/* 开放平台独立站（open.openelfai.com）只保留开放平台相关入口；
 * 官网内容以绝对地址指回主站，避免子域出现死链。 */
function OpenFooter() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-top">
          <div className="footer-brand-col">
            <Link className="footer-brand" href="/">
              <span className="footer-mark">
                <img src="/logo.png" alt="" />
              </span>
              <b>OpenElf</b>
              <span>开放平台</span>
            </Link>
            <p className="footer-tagline">把能力交给全站 AI 智能体。</p>
          </div>

          <nav className="footer-cols" aria-label="页脚导航">
            <div>
              <span>开放平台</span>
              <Link href="/platform/">模型聚合</Link>
              <Link href="/developers/">开发者</Link>
              <Link href="/docs/">开发文档</Link>
              <a href="/console/?view=developer">控制台</a>
            </div>
            <div>
              <span>主站</span>
              <a href={`${MAIN_SITE_URL}/tools/`}>全球AI</a>
              <a href={`${MAIN_SITE_URL}/models/`}>全球大模型</a>
              <a href={`${MAIN_SITE_URL}/download/`}>下载 App</a>
            </div>
            <div>
              <span>法务 &amp; 安全</span>
              <a href={`${MAIN_SITE_URL}/privacy/`}>隐私政策</a>
              <a href={`${MAIN_SITE_URL}/terms/`}>用户协议</a>
              <a href={`${MAIN_SITE_URL}/transparency/`}>透明度</a>
            </div>
          </nav>
        </div>

        <div className="footer-bottom">
          <span>© 2026 开放精灵 OpenElf</span>
          <span>内容由 AI 生成 · 请理性对待</span>
        </div>
      </div>
    </footer>
  );
}

export default function Footer() {
  if (SITE_VARIANT === 'open') return <OpenFooter />;

  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-top">
          <div className="footer-brand-col">
            <Link className="footer-brand" href="/">
              <span className="footer-mark">
                <img src="/logo.png" alt="" />
              </span>
              <b>OpenElf</b>
              <span>开放精灵</span>
            </Link>
            <p className="footer-tagline">培养一个明星 AI，替你争夺注意力。</p>
          </div>

          <nav className="footer-cols" aria-label="页脚导航">
            <div>
              <span>产品</span>
              <a href="/#world">舞台</a>
              <a href="/#powers">资源包</a>
              <a href="/#own">持有</a>
            </div>
            <div>
              <span>更多</span>
              <Link href="/tools/">全球AI</Link>
              <Link href="/models/">全球大模型</Link>
              <a href={`${OPEN_SITE_URL}/platform/`}>模型聚合</a>
              <a href={`${OPEN_SITE_URL}/developers/`}>开发者</a>
              <a href={`${OPEN_SITE_URL}/docs/`}>开发文档</a>
              <Link href="/download/">下载 App</Link>
            </div>
            <div>
              <span>法务 &amp; 安全</span>
              <Link href="/privacy/">隐私政策</Link>
              <Link href="/terms/">用户协议</Link>
              <Link href="/security/">反馈安全漏洞</Link>
              <Link href="/transparency/">透明度</Link>
            </div>
          </nav>
        </div>

        <div className="footer-bottom">
          <span>© 2026 开放精灵 OpenElf</span>
          <span>内容由 AI 生成 · 请理性对待</span>
        </div>
      </div>
    </footer>
  );
}
