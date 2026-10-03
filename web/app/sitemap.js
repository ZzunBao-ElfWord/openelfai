import { TOOLS } from '../lib/tools';
import { SITE_URL } from '../lib/site';

export const dynamic = 'force-static';

export default function sitemap() {
  return [
    {
      url: SITE_URL + '/',
      changeFrequency: 'daily',
      priority: 1
    },
    {
      url: SITE_URL + '/tools/',
      changeFrequency: 'daily',
      priority: 0.9
    },
    ...TOOLS.map((t) => ({
      url: `${SITE_URL}/tools/${t.id}/`,
      lastModified: t.listed_at,
      changeFrequency: 'weekly',
      priority: 0.8
    }))
  ];
}
