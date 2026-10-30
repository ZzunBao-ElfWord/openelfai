/* 大模型详情页：MODELS 中的厂商 / 开放平台逐一静态生成。
 * 与应用详情页（/tools/）同构，但分类维度换成模型类型，入口统一为「开放平台」。 */
import { notFound } from 'next/navigation';
import BackButton from '../../../components/back-button';
import { Icon } from '../../../components/icons';
import {
  Seal,
  RegionBadge,
  EntryButton,
  ToolCard,
  SectionHeader
} from '../../../components/ui';
import {
  MODELS,
  MODEL_MAP,
  MODEL_TYPE_MAP,
  formatDate,
  sortTools
} from '../../../lib/tools';
import { SITE_NAME, SITE_URL } from '../../../lib/site';

export const dynamicParams = false;

export function generateStaticParams() {
  return MODELS.map((t) => ({ id: t.id }));
}

function modelHref(filters) {
  const sp = new URLSearchParams();
  if (filters.type) sp.set('type', filters.type);
  if (filters.region) sp.set('region', filters.region);
  const s = sp.toString();
  return '/models/' + (s ? '?' + s : '');
}

export async function generateMetadata({ params }) {
  const { id } = await params;
  const model = MODEL_MAP[id];
  if (!model) return {};
  const type = MODEL_TYPE_MAP[model.model_type];
  const regionText = model.region === 'domestic' ? '国内' : '海外';
  const title = `${model.name}｜模型能力、API 价格与接入方式（2026）`;
  const description = `${model.short_desc}｜${type ? type.name : '大模型'}·${regionText}｜开放精灵大模型图鉴提供官方开放平台入口，以及模型、价格与接入信息。`;
  const ogTitle = `${model.name} · 开放平台与模型介绍 | ${SITE_NAME}`;
  return {
    title,
    description,
    keywords: [
      model.name,
      `${model.name} API`,
      type ? type.name : '',
      ...(model.tags || []),
      '大模型',
      '开放平台',
      '开放精灵',
      'OpenElf'
    ].filter(Boolean),
    alternates: { canonical: `/models/${model.id}/` },
    openGraph: {
      title: ogTitle,
      description: model.short_desc,
      url: `/models/${model.id}/`,
      type: 'website',
      siteName: SITE_NAME,
      locale: 'zh_CN'
    },
    twitter: {
      card: 'summary_large_image',
      title: ogTitle,
      description: model.short_desc
    }
  };
}

export default async function ModelDetailPage({ params }) {
  const { id } = await params;
  const model = MODEL_MAP[id];
  if (!model) notFound();

  const type = MODEL_TYPE_MAP[model.model_type];
  const related = sortTools(
    MODELS.filter((t) => t.model_type === model.model_type && t.id !== model.id),
    'hot'
  ).slice(0, 6);
  const entryUrl = model.region === 'domestic' ? model.download_url : model.official_url;

  const modelJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: model.name,
    description: model.description,
    url: entryUrl,
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Web',
    keywords: (model.tags || []).join(','),
    datePublished: model.listed_at,
    publisher: { '@type': 'Organization', name: '开放精灵 OpenElf' }
  };

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: '首页', item: SITE_URL + '/' },
      { '@type': 'ListItem', position: 2, name: '大模型', item: SITE_URL + '/models/' },
      {
        '@type': 'ListItem',
        position: 3,
        name: type ? type.name : model.model_type,
        item: SITE_URL + modelHref({ type: model.model_type })
      },
      {
        '@type': 'ListItem',
        position: 4,
        name: model.name,
        item: `${SITE_URL}/models/${model.id}/`
      }
    ]
  };

  return (
    <div className="page-detail">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(modelJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />

      <BackButton fallback="/models/" />

      <div className="detail-grid">
        <div className="detail-main">
          <div className="detail-head">
            <Seal tool={model} size={92} />
            <div className="detail-headtext">
              <div className="detail-badges">
                <span className="badge badge--model">{type ? type.name : '大模型'}</span>
                <RegionBadge region={model.region} full />
              </div>
              <h1 className="detail-name">{model.name}</h1>
              <a className="detail-cat" href={modelHref({ type: model.model_type })}>
                {type ? type.name : model.model_type}
                <Icon name="arrowRight" size={13} />
              </a>
            </div>
          </div>

          <p className="detail-desc">{model.description}</p>

          {model.tags && model.tags.length ? (
            <div className="detail-tags">
              {model.tags.map((tag) => (
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
                <dt>类型</dt>
                <dd>{type ? type.name : model.model_type}</dd>
              </div>
              <div className="meta-item">
                <dt>地区</dt>
                <dd>
                  <RegionBadge region={model.region} full />
                </dd>
              </div>
              <div className="meta-item">
                <dt>标签</dt>
                <dd>{model.tags && model.tags.length ? model.tags.join(' · ') : '—'}</dd>
              </div>
              <div className="meta-item">
                <dt>收录时间</dt>
                <dd className="mono">{formatDate(model.listed_at)}</dd>
              </div>
            </dl>
            <EntryButton tool={model} size="lg" />
            <p className="entry-tip">前往官方开放平台，新窗口打开</p>
          </div>
        </aside>
      </div>

      {related.length ? (
        <section className="section detail-related">
          <SectionHeader eyebrow="RELATED" title="同类模型平台">
            <a className="sec-link" href={modelHref({ type: model.model_type })}>
              查看该类型全部
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
