'use client';

/* Openelf 开放精灵 · 列表页探索器（客户端组件）
 * 保留原版交互：分类 / 地区 / 关键词三条件可叠加筛选，chip 显示动态计数，
 * 搜索输入 350ms 防抖后提交；筛选状态存 URL query（唯一事实源）：
 *   - 变更筛选/搜索 → history.replaceState 写回 query，不产生多余历史记录；
 *   - 前进/后退（popstate）→ 从 URL 重新同步；
 *   - 排序方式读取偏好面板设置。
 * 页面本身为静态生成，不依赖服务器。
 */
import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import { ToolCard, EmptyState } from './ui';
import {
  CATEGORIES,
  CATEGORY_MAP,
  REGION_SHORT,
  queryTools,
  sortTools
} from '../lib/tools';
import { usePrefs } from './preferences';

function writeUrl(next) {
  const sp = new URLSearchParams();
  if (next.category) sp.set('category', next.category);
  if (next.region) sp.set('region', next.region);
  if (next.q) sp.set('q', next.q);
  const s = sp.toString();
  window.history.replaceState(null, '', '/tools/' + (s ? '?' + s : ''));
}

export default function ToolsExplorer({ tools }) {
  const { sort } = usePrefs();
  const [category, setCategory] = useState('');
  const [region, setRegion] = useState('');
  const [q, setQ] = useState('');
  const [kw, setKw] = useState('');
  const initialized = useRef(false);
  const filtersRef = useRef({ category: '', region: '' });

  useEffect(() => {
    filtersRef.current = { category, region };
  }, [category, region]);

  /* 初始与前进/后退时从 URL 同步筛选状态 */
  useEffect(() => {
    const syncFromUrl = () => {
      const sp = new URLSearchParams(window.location.search);
      const c = sp.get('category') || '';
      const r = sp.get('region') || '';
      const qq = (sp.get('q') || '').trim();
      setCategory(CATEGORY_MAP[c] ? c : '');
      setRegion(r === 'domestic' || r === 'overseas' ? r : '');
      setQ(qq);
      setKw(qq);
    };
    syncFromUrl();
    initialized.current = true;
    window.addEventListener('popstate', syncFromUrl);
    return () => window.removeEventListener('popstate', syncFromUrl);
  }, []);

  /* 搜索输入防抖 350ms 后提交并写回 URL */
  useEffect(() => {
    if (!initialized.current || kw === q) return;
    const timer = window.setTimeout(() => {
      const nq = kw.trim();
      setQ(nq);
      writeUrl({ ...filtersRef.current, q: nq });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [kw, q]);

  function setFilter(key, value) {
    if (key === 'category') setCategory(value);
    else if (key === 'region') setRegion(value);
    else if (key === 'q') setQ(value);
    writeUrl({ category, region, q, [key]: value });
  }

  function clearAll() {
    setCategory('');
    setRegion('');
    setQ('');
    setKw('');
    writeUrl({ category: '', region: '', q: '' });
  }

  /* chip 计数 = 在其余两条件下的结果数（与原版一致） */
  const baseForCat = queryTools(tools, { region, q });
  const baseForRegion = queryTools(tools, { category, q });
  const result = queryTools(tools, { category, region, q });
  const sorted = sortTools(result, sort);

  const catName = category ? CATEGORY_MAP[category].name : '';
  const activeConds = [];
  if (catName) activeConds.push(catName);
  if (region) activeConds.push(REGION_SHORT[region]);
  if (q) activeConds.push('“' + q + '”');

  return (
    <div className="page-tools">
      <header className="tools-head">
        <div className="sec-eyebrow">DIRECTORY</div>
        <h1 className="tools-title">{catName || '全部应用'}</h1>
        <p className="tools-count">
          共 <b>{result.length}</b> 个应用
          {activeConds.length ? ' · ' + activeConds.join(' · ') : ''}
        </p>
      </header>

      <div className="filterbar">
        <form
          className="searchbox"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            setFilter('q', (kw || '').trim());
          }}
        >
          <span className="searchbox-icon">
            <Icon name="search" size={17} />
          </span>
          <input
            type="text"
            className="searchbox-input"
            placeholder="搜索 AI 应用名称或关键词"
            aria-label="搜索 AI 应用名称或关键词"
            autoComplete="off"
            value={kw}
            onChange={(e) => setKw(e.target.value)}
          />
          {kw ? (
            <button
              type="button"
              className="searchbox-clear"
              aria-label="清空搜索词"
              onClick={() => {
                setKw('');
                setFilter('q', '');
              }}
            >
              <Icon name="searchOff" size={15} />
            </button>
          ) : null}
        </form>

        <div className="chip-row" role="group" aria-label="分类筛选">
          <button
            type="button"
            className={'chip' + (!category ? ' chip--active' : '')}
            aria-pressed={!category ? 'true' : 'false'}
            onClick={() => setFilter('category', '')}
          >
            <span>全部</span>
            <span className="chip-count">{baseForCat.length}</span>
          </button>
          {CATEGORIES.map((c) => (
            <button
              key={c.code}
              type="button"
              className={'chip' + (category === c.code ? ' chip--active' : '')}
              aria-pressed={category === c.code ? 'true' : 'false'}
              onClick={() => setFilter('category', c.code)}
            >
              <span>{c.name}</span>
              <span className="chip-count">
                {baseForCat.filter((t) => t.category === c.code).length}
              </span>
            </button>
          ))}
        </div>

        <div className="chip-row" role="group" aria-label="地区筛选">
          <button
            type="button"
            className={'chip' + (!region ? ' chip--active' : '')}
            aria-pressed={!region ? 'true' : 'false'}
            onClick={() => setFilter('region', '')}
          >
            <span>全部地区</span>
            <span className="chip-count">{baseForRegion.length}</span>
          </button>
          <button
            type="button"
            className={'chip' + (region === 'domestic' ? ' chip--active' : '')}
            aria-pressed={region === 'domestic' ? 'true' : 'false'}
            onClick={() => setFilter('region', 'domestic')}
          >
            <span>国内</span>
            <span className="chip-count">
              {baseForRegion.filter((t) => t.region === 'domestic').length}
            </span>
          </button>
          <button
            type="button"
            className={'chip' + (region === 'overseas' ? ' chip--active' : '')}
            aria-pressed={region === 'overseas' ? 'true' : 'false'}
            onClick={() => setFilter('region', 'overseas')}
          >
            <span>海外</span>
            <span className="chip-count">
              {baseForRegion.filter((t) => t.region === 'overseas').length}
            </span>
          </button>
        </div>
      </div>

      {sorted.length ? (
        <div className="grid">
          {sorted.map((t) => (
            <ToolCard key={t.id} tool={t} />
          ))}
        </div>
      ) : (
        <EmptyState onClear={clearAll} />
      )}
    </div>
  );
}
