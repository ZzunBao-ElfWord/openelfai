/* 首页：Hero（搜索 + 收录统计）· 六大门类 · 精选推荐 · 最新收录
 * 静态生成，收录数字来自 data/tools.json 构建期实算。 */
import Link from 'next/link';
import { Icon } from '../components/icons';
import { ToolCard, SectionHeader } from '../components/ui';
import {
  CATEGORIES,
  TOOLS,
  counts,
  featuredTools,
  latestTools,
  listHref
} from '../lib/tools';
import { SITE_TITLE, SITE_DESC, SITE_URL } from '../lib/site';

export const metadata = {
  title: SITE_TITLE,
  description: SITE_DESC,
  alternates: { canonical: '/' },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESC,
    url: '/'
  }
};

export default function HomePage() {
  const stats = counts(TOOLS);
  const featured = featuredTools(TOOLS, 12);
  const latest = latestTools(TOOLS, 12);

  const catRows = CATEGORIES.map((c) => {
    const items = TOOLS.filter((t) => t.category === c.code);
    return {
      cat: c,
      total: items.length,
      domestic: items.filter((t) => t.region === 'domestic').length,
      overseas: items.filter((t) => t.region === 'overseas').length
    };
  });

  const websiteJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_TITLE,
    url: SITE_URL + '/',
    description: SITE_DESC,
    inLanguage: 'zh-CN',
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: SITE_URL + '/tools/?q={search_term_string}'
      },
      'query-input': 'required name=search_term_string'
    }
  };

  return (
    <div className="page-home">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
      />

      <section className="hero">
        <div className="hero-inner">
          <div className="hero-eyebrow">OPENELF · AI FIELD GUIDE</div>
          <h1 className="hero-title">全球 AI 工具图鉴</h1>
          <p className="hero-sub">
            开放精灵为你整理了全球主流 AI 工具——国内工具直达下载入口，海外工具一键访问官网。
          </p>

          {/* 原生 GET 表单：无 JS 也可搜索（SEO / 渐进增强友好） */}
          <form className="searchbox searchbox--lg" role="search" action="/tools/" method="get">
            <span className="searchbox-icon">
              <Icon name="search" size={20} />
            </span>
            <input
              type="text"
              className="searchbox-input"
              name="q"
              placeholder="搜索 AI 工具名称或关键词"
              aria-label="搜索 AI 工具名称或关键词"
              autoComplete="off"
            />
          </form>

          <div className="hero-stats" role="group" aria-label="收录统计">
            <div className="stat">
              <div className="stat-num">{stats.total}</div>
              <div className="stat-label">收录工具</div>
            </div>
            <div className="stat">
              <div className="stat-num stat-num--domestic">{stats.domestic}</div>
              <div className="stat-label">国内工具</div>
            </div>
            <div className="stat">
              <div className="stat-num stat-num--overseas">{stats.overseas}</div>
              <div className="stat-label">海外工具</div>
            </div>
            <div className="stat">
              <div className="stat-num">{CATEGORIES.length}</div>
              <div className="stat-label">覆盖分类</div>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <SectionHeader eyebrow="CATEGORIES" title="六大门类">
          <Link className="sec-link" href="/tools/">
            浏览全部工具
            <Icon name="arrowRight" size={15} />
          </Link>
        </SectionHeader>
        <div className="cat-grid">
          {catRows.map((r) => (
            <Link
              key={r.cat.code}
              className="cat-card"
              href={listHref({ category: r.cat.code })}
            >
              <span className="cat-icon">
                <Icon name={r.cat.icon} size={22} />
              </span>
              <span className="cat-name">{r.cat.name}</span>
              <span className="cat-desc">{r.cat.desc}</span>
              <span className="cat-meta">
                <span className="cat-total">{r.total} 款</span>
                <span className="cat-split">
                  <em className="cat-split--domestic">国内 {r.domestic}</em>
                  <em className="cat-split--overseas">海外 {r.overseas}</em>
                </span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="section">
        <SectionHeader eyebrow="FEATURED" title="精选推荐">
          <span className="sec-note">由开放精灵逐款甄选</span>
        </SectionHeader>
        <div className="grid">
          {featured.map((t) => (
            <ToolCard key={t.id} tool={t} />
          ))}
        </div>
      </section>

      <section className="section">
        <SectionHeader eyebrow="LATEST" title="最新收录">
          <Link className="sec-link" href="/tools/">
            查看全部
            <Icon name="arrowRight" size={15} />
          </Link>
        </SectionHeader>
        <div className="grid">
          {latest.map((t) => (
            <ToolCard key={t.id} tool={t} />
          ))}
        </div>
      </section>
    </div>
  );
}
