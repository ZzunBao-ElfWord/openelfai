/* 列表页：分类 / 地区 / 关键词三条件叠加筛选（客户端），页面静态生成 */
import ToolsExplorer from '../../components/explorer';
import { TOOLS } from '../../lib/tools';
import { SITE_URL } from '../../lib/site';

export const metadata = {
  title: 'AI 应用图鉴 · 全球 AI 工具应用',
  description:
    '浏览 Openelf 开放精灵收录的 AI 工具应用：支持按对话助手、图像生成、音视频、编程开发、办公效率、智能体与搜索六大分类与国内 / 海外地区筛选，并可关键词检索。大模型厂商与开放平台另见大模型图鉴。',
  alternates: { canonical: '/tools/' },
  openGraph: {
    title: 'AI 应用图鉴 · 全球 AI 工具应用 | 开放精灵 Openelf',
    description:
      '浏览开放精灵收录的 AI 工具应用：六大门类 × 国内 / 海外地区筛选与关键词检索。',
    url: '/tools/'
  }
};

export default function ToolsPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'AI 应用图鉴 · 全部应用',
    description:
      'Openelf 开放精灵收录的 AI 工具应用，支持六大分类与国内 / 海外地区筛选及关键词检索。',
    url: SITE_URL + '/tools/',
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: TOOLS.length,
      itemListElement: TOOLS.map((t, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: SITE_URL + '/tools/' + t.id + '/',
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
      <ToolsExplorer tools={TOOLS} />
    </>
  );
}

