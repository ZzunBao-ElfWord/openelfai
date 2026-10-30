/* 应用详情页：TOOLS（AI 工具应用）逐一静态生成（generateStaticParams），
 * 页面 title / meta description / OG 标签 / canonical / 结构化数据（JSON-LD）齐备。
 * 文案与链接全部来自 data/tools.json，不新增不臆造。大模型平台走 /models/[id]/。 */
import { notFound } from 'next/navigation';
import BackButton from '../../../components/back-button';
import { Icon } from '../../../components/icons';
import { Seal, RegionBadge, EntryButton, ToolCard, SectionHeader } from '../../../components/ui';
import {
  CATEGORY_MAP,
  REGION_LABEL,
  TOOLS,
  TOOL_MAP,
  formatDate,
  listHref,
  relatedTools
} from '../../../lib/tools';
import { SITE_NAME, SITE_URL } from '../../../lib/site';

export const dynamicParams = false;

export function generateStaticParams() {
  return TOOLS.map((t) => ({ id: t.id }));
}

/* schema.org SoftwareApplication 的 applicationCategory 映射 */
const SCHEMA_CATEGORY = {
  chat_assistant: 'UtilitiesApplication',
  image_gen: 'DesignApplication',
  audio_video: 'MultimediaApplication',
  coding: 'DeveloperApplication',
  office: 'BusinessApplication',
  agent_search: 'UtilitiesApplication'
};

export async function generateMetadata({ params }) {
  const { id } = await params;
  const tool = TOOL_MAP[id];
  if (!tool) return {};
  const cat = CATEGORY_MAP[tool.category];
  const domestic = tool.region === 'domestic';
  const entryWord = domestic ? '官网下载' : '官网入口';
  const title = domestic
    ? `${tool.name}官网下载｜是什么、能做什么（2026）`
    : `${tool.name}官网入口｜是什么、国内怎么访问（2026）`;
  const description = `${tool.short_desc}｜${cat ? cat.name : ''}·${
    REGION_LABEL[tool.region]
  }｜开放精灵 AI 工具图鉴提供${domestic ? '官方下载' : '官网访问'}直达入口。`;
  const ogTitle = `${tool.name} · ${entryWord}与工具介绍 | ${SITE_NAME}`;
  return {
    title,
    description,
    keywords: [
      tool.name,
      `${tool.name} ${domestic ? '下载' : '官网'}`,
      cat ? cat.name : '',
      ...(tool.tags || []),
      'AI工具',
      '开放精灵',
      'OpenElf'
    ].filter(Boolean),
    alternates: { canonical: `/tools/${tool.id}/` },
    openGraph: {
      title: ogTitle,
      description: tool.short_desc,
      url: `/tools/${tool.id}/`,
      type: 'website',
      siteName: SITE_NAME,
      locale: 'zh_CN'
    },
    twitter: {
      card: 'summary_large_image',
      title: ogTitle,
      description: tool.short_desc
    }
  };
}

export default async function ToolDetailPage({ params }) {
  const { id } = await params;
  const tool = TOOL_MAP[id];
  if (!tool) notFound();

  const cat = CATEGORY_MAP[tool.category];
  const domestic = tool.region === 'domestic';
  const related = relatedTools(tool, TOOLS, 6);
  const entryUrl = domestic ? tool.download_url : tool.official_url;

  const softwareJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: tool.name,
    description: tool.description,
    url: entryUrl,
    applicationCategory: SCHEMA_CATEGORY[tool.category] || 'UtilitiesApplication',
    operatingSystem: 'Web',
    keywords: (tool.tags || []).join(','),
    datePublished: tool.listed_at,
    publisher: { '@type': 'Organization', name: '开放精灵 OpenElf' }
  };

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: '首页', item: SITE_URL + '/' },
      { '@type': 'ListItem', position: 2, name: '全部工具', item: SITE_URL + '/tools/' },
      {
        '@type': 'ListItem',
        position: 3,
        name: cat ? cat.name : tool.category,
        item: SITE_URL + listHref({ category: tool.category })
      },
      {
        '@type': 'ListItem',
        position: 4,
        name: tool.name,
        item: `${SITE_URL}/tools/${tool.id}/`
      }
    ]
  };

  return (
    <div className="page-detail">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />

      <BackButton />

      <div className="detail-grid">
        <div className="detail-main">
          <div className="detail-head">
            <Seal tool={tool} size={92} />
            <div className="detail-headtext">
              <div className="detail-badges">
                <RegionBadge region={tool.region} full />
              </div>
              <h1 className="detail-name">{tool.name}</h1>
              <a className="detail-cat" href={listHref({ category: tool.category })}>
                {cat ? cat.name : tool.category}
                <Icon name="arrowRight" size={13} />
              </a>
            </div>
          </div>

          <p className="detail-desc">{tool.description}</p>

          {tool.tags && tool.tags.length ? (
            <div className="detail-tags">
              {tool.tags.map((tag) => (
                <span key={tag} className="tag">
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <aside className="detail-side">
          <div className="meta-card">
            <dl className="meta-list">
              <div className="meta-item">
                <dt>分类</dt>
                <dd>{cat ? cat.name : tool.category}</dd>
              </div>
              <div className="meta-item">
                <dt>地区</dt>
                <dd>
                  <RegionBadge region={tool.region} full />
                </dd>
              </div>
              <div className="meta-item">
                <dt>标签</dt>
                <dd>{tool.tags && tool.tags.length ? tool.tags.join(' · ') : '—'}</dd>
              </div>
              <div className="meta-item">
                <dt>收录时间</dt>
                <dd className="mono">{formatDate(tool.listed_at)}</dd>
              </div>
            </dl>
            <EntryButton tool={tool} size="lg" />
            <p className="entry-tip">
              {domestic ? '前往官方下载渠道，新窗口打开' : '前往工具官方网站，新窗口打开'}
            </p>
          </div>
        </aside>
      </div>

      {related.length ? (
        <section className="section detail-related">
          <SectionHeader eyebrow="RELATED" title="同类工具推荐">
            <a className="sec-link" href={listHref({ category: tool.category })}>
              查看分类全部
              <Icon name="arrowRight" size={15} />
            </a>
          </SectionHeader>
          <div className="grid">
            {related.map((t) => (
              <ToolCard key={t.id} tool={t} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
