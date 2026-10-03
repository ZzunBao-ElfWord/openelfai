/* Openelf 开放精灵 · 共享 UI 组件层
 * Seal（首字印章）/ RegionBadge / EntryButton / ToolCard / SectionHeader / EmptyState
 * 既可在服务端组件（静态生成）中使用，也可在客户端组件中使用。
 */
import Link from 'next/link';
import { Icon } from './icons';
import {
  CATEGORY_MAP,
  REGION_LABEL,
  REGION_SHORT,
  entryOf,
  firstChar,
  formatDate,
  listHref
} from '../lib/tools';

/* ── 首字印章（签名元素：国内朱砂 / 海外靛青） ─────────────── */
export function Seal({ tool, size = 52 }) {
  const style = {
    width: size + 'px',
    height: size + 'px',
    fontSize: Math.round(size * 0.44) + 'px',
    borderRadius: Math.max(8, Math.round(size * 0.22)) + 'px'
  };
  return (
    <div className={'seal seal--' + tool.region} style={style} aria-hidden="true">
      <span>{firstChar(tool.name)}</span>
    </div>
  );
}

/* ── 地区标识（国内工具 / 海外工具） ───────────── */
export function RegionBadge({ region, full }) {
  const label = full ? REGION_LABEL[region] : REGION_SHORT[region];
  return (
    <span className={'badge badge--' + region}>
      <i className="badge-dot"></i>
      {label}
    </span>
  );
}

/* ── EntryButton：核心规则 3.5 的实现载体
 * domestic → 「下载」，href = download_url
 * overseas → 「访问官网」，href = official_url
 * 统一新窗口（target=_blank）+ rel="noopener noreferrer"，纯超链接直达，无中间页。
 * 按品牌色定案：行动按钮使用琥珀金 #F5B841。
 */
export function EntryButton({ tool, size = 'sm' }) {
  const domestic = tool.region === 'domestic';
  const href = entryOf(tool);
  const iconSize = size === 'lg' ? 18 : 15;
  return (
    <a
      className={'entry entry--' + size}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      <Icon name={domestic ? 'download' : 'external'} size={iconSize} />
      <span>{domestic ? '下载' : '访问官网'}</span>
    </a>
  );
}

/* ── 工具卡片（首页精选 / 最新、列表、同类推荐共用） ─────────── */
export function ToolCard({ tool }) {
  const cat = CATEGORY_MAP[tool.category];
  return (
    <article className="card">
      <Link
        className="card-cover"
        href={`/tools/${tool.id}/`}
        aria-label={tool.name + ' 详情'}
      ></Link>
      <div className="card-top">
        <Seal tool={tool} />
        <div className="card-title">
          <h3 className="card-name">{tool.name}</h3>
          <RegionBadge region={tool.region} />
        </div>
        {tool.is_featured ? (
          <span className="featured-star" title="精选推荐">
            <Icon name="star4" size={16} />
          </span>
        ) : null}
      </div>
      <p className="card-desc">{tool.short_desc}</p>
      <div className="card-foot">
        <Link className="cat-tag" href={listHref({ category: tool.category })}>
          {cat ? cat.name : tool.category}
        </Link>
        <span className="card-date">{formatDate(tool.listed_at)}</span>
        <span className="card-foot-spacer"></span>
        <EntryButton tool={tool} />
      </div>
    </article>
  );
}

/* ── 区块标题（眉标 + 标题 + 右侧动作） ───────────────────── */
export function SectionHeader({ eyebrow, title, children }) {
  return (
    <div className="sec-head">
      <div className="sec-head-text">
        {eyebrow ? <div className="sec-eyebrow">{eyebrow}</div> : null}
        <h2 className="sec-title">{title}</h2>
      </div>
      {children}
    </div>
  );
}

/* ── 空状态（明确提示 + 清空筛选入口） ─────────────── */
export function EmptyState({ onClear }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name="searchOff" size={34} />
      </div>
      <h3 className="empty-title">未找到相关工具</h3>
      <p className="empty-desc">换个关键词试试，或放宽分类与地区筛选条件。</p>
      <button type="button" className="btn-ghost" onClick={onClear}>
        清空筛选条件
      </button>
    </div>
  );
}
