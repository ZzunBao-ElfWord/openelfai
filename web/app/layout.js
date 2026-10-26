import './globals.css';
import SiteChrome from '../components/site-chrome';
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
  keywords: ['AI明星', 'AI网红', 'AI养成', 'AI创作', 'AI精灵', '开放精灵', 'Openelf'],
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
        {/* 注销旧版 Flutter 网页注册的 Service Worker，避免旧缓存拦截新官网 */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "if('serviceWorker' in navigator){navigator.serviceWorker.getRegistrations().then(function(rs){rs.forEach(function(r){r.unregister()})})}"
          }}
        />
        <PreferencesProvider>
          <SiteChrome>{children}</SiteChrome>
        </PreferencesProvider>
      </body>
    </html>
  );
}
