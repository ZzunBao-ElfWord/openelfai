/* 开发文档的共享渲染层：左侧固定目录 + 右侧正文。
 * 内容全部来自 content.js，本文件只负责结构与排版。 */
import Link from 'next/link';
import { DOC_GROUPS, DOCS, DOC_ORDER, docGroupLabel, docHref } from './content';

/* 支持用反引号包裹行内代码，例如 `stream: true` */
function renderInline(text) {
  const parts = String(text).split(/`([^`]+)`/g);
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <code key={index} className="doc-inline-code">
        {part}
      </code>
    ) : (
      part
    )
  );
}

function DocBlock({ block }) {
  switch (block.type) {
    case 'h2':
      return <h2>{renderInline(block.text)}</h2>;
    case 'h3':
      return <h3>{renderInline(block.text)}</h3>;
    case 'p':
      return <p>{renderInline(block.text)}</p>;
    case 'ul':
      return (
        <ul>
          {block.items.map((item, index) => {
            const entry = typeof item === 'string' ? { text: item } : item;
            return (
              <li key={index}>
                {entry.href ? (
                  <Link href={entry.href}>{renderInline(entry.text)}</Link>
                ) : (
                  renderInline(entry.text)
                )}
              </li>
            );
          })}
        </ul>
      );
    case 'code':
      return (
        <div className="doc-code">
          <div className="doc-code-head">
            <span>{block.title}</span>
            <span>{block.lang}</span>
          </div>
          <pre>
            <code>{block.code}</code>
          </pre>
        </div>
      );
    case 'table':
      return (
        <div className="doc-table-wrap">
          <table className="doc-table">
            <thead>
              <tr>
                {block.head.map((cell) => (
                  <th key={cell}>{cell}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row) => (
                <tr key={row.join('|')}>
                  {row.map((cell, index) => (
                    <td key={index}>{renderInline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'steps':
      return (
        <div className="doc-steps">
          {block.items.map((item, index) => (
            <article className="doc-step" key={item.title}>
              <span className="doc-step-index mono">
                {String(index + 1).padStart(2, '0')}
              </span>
              <h4>{item.title}</h4>
              <p>{renderInline(item.desc)}</p>
            </article>
          ))}
        </div>
      );
    case 'note':
      return <div className="doc-note">{renderInline(block.text)}</div>;
    default:
      return null;
  }
}

function DocPager({ slug }) {
  const index = DOC_ORDER.indexOf(slug);
  const prevSlug = index > 0 ? DOC_ORDER[index - 1] : null;
  const nextSlug =
    index >= 0 && index < DOC_ORDER.length - 1 ? DOC_ORDER[index + 1] : null;

  if (!prevSlug && !nextSlug) return null;

  return (
    <nav className="doc-pager" aria-label="上一篇与下一篇">
      {prevSlug ? (
        <Link className="doc-pager-link" href={docHref(prevSlug)}>
          <span className="doc-pager-label">← 上一篇</span>
          <span className="doc-pager-title">{DOCS[prevSlug].title}</span>
        </Link>
      ) : (
        <span className="doc-pager-empty" />
      )}
      {nextSlug ? (
        <Link className="doc-pager-link doc-pager-next" href={docHref(nextSlug)}>
          <span className="doc-pager-label">下一篇 →</span>
          <span className="doc-pager-title">{DOCS[nextSlug].title}</span>
        </Link>
      ) : (
        <span className="doc-pager-empty" />
      )}
    </nav>
  );
}

export default function DocView({ slug }) {
  const doc = DOCS[slug];

  return (
    <div className="doc-page">
      <div className="doc-shell">
        <aside className="doc-side" aria-label="文档目录">
          <div className="doc-side-top">
            <Link className="doc-back" href="/developers/">
              <span aria-hidden="true">←</span>
              返回开放平台
            </Link>
            <p className="doc-side-title">开放平台开发文档</p>
          </div>

          <nav className="doc-nav" aria-label="文档导航">
            {DOC_GROUPS.map((group) => (
              <div className="doc-nav-group" key={group.label}>
                <span className="doc-nav-label">{group.label}</span>
                {group.items.map((item) => (
                  <Link
                    key={item}
                    className={
                      item === slug ? 'doc-nav-link is-active' : 'doc-nav-link'
                    }
                    href={docHref(item)}
                  >
                    {DOCS[item].title}
                  </Link>
                ))}
              </div>
            ))}
          </nav>
        </aside>

        <div className="doc-main">
          <header className="doc-head">
            <p className="doc-eyebrow">{docGroupLabel(slug)} / DOCS</p>
            <h1 className="doc-title">{doc.title}</h1>
            <p className="doc-lead">{doc.summary}</p>
          </header>

          <div className="doc-body">
            {doc.blocks.map((block, index) => (
              <DocBlock block={block} key={index} />
            ))}
          </div>

          <DocPager slug={slug} />
        </div>
      </div>
    </div>
  );
}
