/* 开放平台开发文档首页：对应「介绍 / 开放平台概述」。
 * 其余条目由 /docs/[slug]/ 静态生成，目录与正文数据集中在 content.js。 */
import DocView from './docs-ui';
import { HOME_SLUG } from './content';
import { SITE_NAME } from '../../lib/site';

export const metadata = {
  title: '开放平台开发文档 · 技能、专家与连接器发布指南',
  description:
    'OpenElf 开放平台开发文档：账号与入驻流程、技能/专家/连接器三类能力、Open API 接口、开发者服务协议、服务类目、运营数据与收入变现。',
  alternates: { canonical: '/docs/' },
  openGraph: {
    title: '开放平台开发文档 | 开放精灵 OpenElf',
    description:
      '从入驻、开发到上架与变现，OpenElf 开放平台的完整开发文档。',
    url: '/docs/',
    type: 'website',
    siteName: SITE_NAME,
    locale: 'zh_CN'
  }
};

export default function DocsHomePage() {
  return <DocView slug={HOME_SLUG} />;
}
