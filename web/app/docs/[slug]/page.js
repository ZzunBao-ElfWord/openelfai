/* 开发文档详情页：按 content.js 的条目逐一静态生成。
 * 静态导出（output: 'export'）依赖 generateStaticParams 提供全部 slug。 */
import { notFound } from 'next/navigation';
import DocView from '../docs-ui';
import { DOCS, DOC_PARAM_SLUGS, HOME_SLUG } from '../content';
import { SITE_NAME } from '../../../lib/site';

export const dynamicParams = false;

export function generateStaticParams() {
  return DOC_PARAM_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const doc = DOCS[slug];
  if (!doc || slug === HOME_SLUG) return {};

  return {
    title: `${doc.title} · 开放平台开发文档`,
    description: doc.summary,
    alternates: { canonical: `/docs/${slug}/` },
    openGraph: {
      title: `${doc.title} · 开放平台开发文档 | ${SITE_NAME}`,
      description: doc.summary,
      url: `/docs/${slug}/`,
      type: 'article',
      siteName: SITE_NAME,
      locale: 'zh_CN'
    }
  };
}

export default async function DocDetailPage({ params }) {
  const { slug } = await params;
  const doc = DOCS[slug];
  if (!doc) notFound();

  return <DocView slug={slug} />;
}
