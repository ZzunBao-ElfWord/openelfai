import Link from 'next/link';

export const metadata = {
  title: '页面不存在',
  robots: { index: false }
};

export default function NotFound() {
  return (
    <div className="state-screen">
      <p>页面不存在，精灵迷路了。</p>
      <Link className="btn-ghost" href="/">
        回首页
      </Link>
    </div>
  );
}
