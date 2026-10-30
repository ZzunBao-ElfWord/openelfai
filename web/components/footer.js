import Link from 'next/link';

export default function Footer() {
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
              <Link href="/platform/">模型聚合</Link>
              <Link href="/developers/">开发者</Link>
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
