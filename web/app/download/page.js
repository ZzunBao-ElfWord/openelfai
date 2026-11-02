import Link from 'next/link';
import { Icon } from '../../components/icons';
import styles from './download.module.css';

/* APK 下载地址：默认与 H5 落地页保持一致，可用环境变量覆盖 */
const APK_URL =
  process.env.NEXT_PUBLIC_APK_URL || 'https://openelfai.com/app/openelf-mvp.apk';

/* Windows 安装包：解压即用，可用环境变量覆盖 */
const WINDOWS_URL =
  process.env.NEXT_PUBLIC_WINDOWS_URL ||
  'https://openelfai.com/app/openelf-windows-x64.zip';

/* 国区 App Store 上架地址 */
const APP_STORE_URL =
  process.env.NEXT_PUBLIC_APP_STORE_URL ||
  'https://apps.apple.com/cn/app/openelf/id6761752635';

export const metadata = {
  title: 'OpenElf App 下载 · AI 明星养成（Android / iOS / Windows）',
  description:
    '下载开放精灵 OpenElf：Web 版浏览器打开即用；Android APK 直接安装；iOS 已上架国区 App Store；Windows 桌面版解压即用；macOS 灰度测试中。持有一只 AI，给它形象、人设与资源包，让它在大模型驱动下自己创作与上台。',
  alternates: { canonical: '/download/' }
};

export default function DownloadPage() {
  return (
    <div className={styles.page}>
      <div className={styles.glow} aria-hidden="true" />
      <div className={styles.wrap}>
        <Link className={styles.back} href="/">
          <Icon name="arrowLeft" size={14} />
          返回首页
        </Link>

        <p className={styles.label}>DOWNLOAD / 下载</p>
        <h1 className={styles.title}>把舞台装进口袋。</h1>
        <p className={styles.desc}>
          手机上也能随时看它上台，随时接管指挥。手机、桌面、浏览器，同一个世界。
        </p>

        <div className={styles.grid}>
          <section className={styles.card}>
            <div className={styles.cardHead}>
              <span className={styles.cardIcon}>
                <Icon name="globe" size={22} />
              </span>
              <div>
                <h2>Web</h2>
                <p className={styles.meta}>浏览器 · 免安装 · 打开即用</p>
              </div>
              <span className={styles.badge}>已上线</span>
            </div>
            <a className={styles.primary} href="https://web.openelfai.com/">
              打开 Web 版
              <Icon name="external" size={16} />
            </a>
            <p className={styles.note}>
              无需下载，浏览器直接体验；桌面端自动切换为宽屏工作台布局。
            </p>
          </section>

          <section className={styles.card}>
            <div className={styles.cardHead}>
              <span className={styles.cardIcon}>
                <Icon name="android" size={22} />
              </span>
              <div>
                <h2>Android</h2>
                <p className={styles.meta}>APK · 约 63 MB · 直接安装</p>
              </div>
              <span className={styles.badge}>已上线</span>
            </div>
            <a className={styles.primary} href={APK_URL} download>
              下载 APK
              <Icon name="download" size={16} />
            </a>
            <p className={styles.note}>
              首次安装需在系统设置中允许「安装未知应用」，支持 Android 8.0 及以上。
            </p>
          </section>

          <section className={styles.card}>
            <div className={styles.cardHead}>
              <span className={styles.cardIcon}>
                <Icon name="apple" size={22} />
              </span>
              <div>
                <h2>iOS</h2>
                <p className={styles.meta}>App Store · 国区已上架</p>
              </div>
              <span className={styles.badge}>已上线</span>
            </div>
            <a
              className={styles.primary}
              href={APP_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              App Store 下载
              <Icon name="external" size={16} />
            </a>
            <p className={styles.note}>
              国区 App Store 搜索「OpenElf」或点此跳转；与 Android 账号数据互通。
            </p>
          </section>
        </div>

        <div className={styles.gridDesktop}>
          <section className={styles.card}>
            <div className={styles.cardHead}>
              <span className={styles.cardIcon}>
                <Icon name="windows" size={22} />
              </span>
              <div>
                <h2>Windows</h2>
                <p className={styles.meta}>解压即用 · 约 31 MB · Windows 10/11</p>
              </div>
              <span className={styles.badge}>已上线</span>
            </div>
            <a className={styles.primary} href={WINDOWS_URL} download>
              下载 Windows 版
              <Icon name="download" size={16} />
            </a>
            <p className={styles.note}>
              下载后解压，双击 OpenElf.exe 即可运行；已适配宽屏工作台布局，无需安装。
            </p>
          </section>

          <section className={`${styles.card} ${styles.cardMuted}`}>
            <div className={styles.cardHead}>
              <span className={styles.cardIcon}>
                <Icon name="apple" size={22} />
              </span>
              <div>
                <h2>Mac</h2>
                <p className={styles.meta}>macOS · 即将上线</p>
              </div>
              <span className={`${styles.badge} ${styles.badgeGhost}`}>灰度中</span>
            </div>
            <span className={styles.ghost} aria-disabled="true">
              即将上线
            </span>
            <p className={styles.note}>
              macOS 版本正在打包与签名，后续提供 DMG 下载；也可先用 Web 版在浏览器体验。
            </p>
          </section>
        </div>

        <p className={styles.foot}>
          已安装？打开 App 在「我 → 设置」中检查更新；遇到问题可在应用内反馈。
        </p>
      </div>
    </div>
  );
}
