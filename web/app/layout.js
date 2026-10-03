import './globals.css';
import Header from '../components/header';
import Footer from '../components/footer';
import { PreferencesProvider } from '../components/preferences';
import { SITE_NAME, SITE_TITLE, SITE_DESC, SITE_URL } from '../lib/site';

export const viewport = {
  width: 'device-width',
  initialScale: 1
};

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: '%s | 开放精灵 Openelf'
  },
  description: SITE_DESC,
  keywords: ['AI工具', 'AI工具大全', 'AI工具导航', '人工智能工具', '全球AI工具', '开放精灵', 'Openelf'],
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    locale: 'zh_CN',
    url: '/',
    title: SITE_TITLE,
    description: SITE_DESC
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESC
  }
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>
        <PreferencesProvider>
          <div className="app">
            <Header />
            <main className="main">{children}</main>
            <Footer />
          </div>
        </PreferencesProvider>
      </body>
    </html>
  );
}
