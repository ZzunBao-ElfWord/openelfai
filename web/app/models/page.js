/* 大模型目录：与大模型厂商 / 开放平台分属独立目录，不与应用图鉴混排。
 * 页面静态生成，筛选（类型 / 地区 / 关键词）由客户端组件完成。 */
import ModelsExplorer from '../../components/model-explorer';
import { MODELS } from '../../lib/tools';
import { SITE_URL } from '../../lib/site';

export const metadata = {
  title: '大模型图鉴 · 全球大模型厂商与开放平台',
  description:
    '浏览 Openelf 开放精灵收录的全球大模型厂商与开放平台：按语言大模型、生成模型、平台与托管分类，覆盖国内与海外，提供官方开放平台直达入口。',
  alternates: { canonical: '/models/' },
  openGraph: {
    title: '大模型图鉴 · 全球大模型厂商与开放平台 | 开放精灵 Openelf',
    description:
      '全球大模型厂商与开放平台清单：语言大模型、生成模型、平台与托管三类，国内 / 海外分列。',
    url: '/models/'
  }
};

export default function ModelsPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: '大模型图鉴 · 全球大模型厂商与开放平台',
    description:
      'Openelf 开放精灵收录的全球大模型厂商与开放平台，按语言大模型、生成模型、平台与托管分类。',
    url: SITE_URL + '/models/',
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: MODELS.length,
      itemListElement: MODELS.map((t, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: SITE_URL + '/models/' + t.id + '/',
        name: t.name
      }))
    }
  };
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <ModelsExplorer models={MODELS} />
    </>
  );
}
