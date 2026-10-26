'use client';

/* 大模型目录探索器：与 AI 工具应用（/tools/）分开的一套筛选
 * 类型（语言大模型 / 生成模型 / 平台与托管）+ 地区 + 关键词，状态写回 URL。
 */
import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import { ToolCard, EmptyState } from './ui';
import {
  MODEL_TYPES,
  MODEL_TYPE_MAP,
  REGION_SHORT,
  matchesQuery,
  sortTools
} from '../lib/tools';
import { usePrefs } from './preferences';

function writeUrl(next) {
  const sp = new URLSearchParams();
  if (next.type) sp.set('type', next.type);
  if (next.region) sp.set('region', next.region);
  if (next.q) sp.set('q', next.q);
  const s = sp.toString();
  window.history.replaceState(null, '', '/models/' + (s ? '?' + s : ''));
}

export default function ModelsExplorer({ models }) {
  const { sort } = usePrefs();
  const [type, setType] = useState('');
  const [region, setRegion] = useState('');
  const [q, setQ] = useState('');
  const [kw, setKw] = useState('');
  const initialized = useRef(false);
  const filtersRef = useRef({ type: '', region: '' });

  useEffect(() => {
    filtersRef.current = { type, region };
  }, [type, region]);

  useEffect(() => {
    const syncFromUrl = () => {
      const sp = new URLSearchParams(window.location.search);
      const t = sp.get('type') || '';
      const r = sp.get('region') || '';
      const qq = (sp.get('q') || '').trim();
      setType(MODEL_TYPE_MAP[t] ? t : '');
      setRegion(r === 'domestic' || r === 'overseas' ? r : '');
      setQ(qq);
      setKw(qq);
    };
    syncFromUrl();
    initialized.current = true;
    window.addEventListener('popstate', syncFromUrl);
    return () => window.removeEventListener('popstate', syncFromUrl);
  }, []);

  useEffect(() => {
    if (!initialized.current || kw === q) return;
    const timer = window.setTimeout(() => {
      const nq = kw.trim();
      setQ(nq);
      writeUrl({ ...filtersRef.current, q: nq });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [kw, q]);

  function match(t, overrides) {
    const f = { type, region, q, ...overrides };
    if (f.type && t.model_type !== f.type) return false;
    if (f.region && t.region !== f.region) return false;
    return matchesQuery(t, f.q);
  }

  function setFilter(key, value) {
    if (key === 'type') setType(value);
    else if (key === 'region') setRegion(value);
    else if (key === 'q') setQ(value);
    writeUrl({ type, region, q, [key]: value });
  }

  function clearAll() {
    setType('');
    setRegion('');
    setQ('');
    setKw('');
    writeUrl({ type: '', region: '', q: '' });
  }

  const baseForType = models.filter((t) => match(t, { type: '' }));
  const baseForRegion = models.filter((t) => match(t, { region: '' }));
  const result = models.filter((t) => match(t, {}));
  const sorted = sortTools(result, sort);

  const typeName = type ? MODEL_TYPE_MAP[type].name : '';
  const activeConds = [];
  if (typeName) activeConds.push(typeName);
  if (region) activeConds.push(REGION_SHORT[region]);
  if (q) activeConds.push('“' + q + '”');

  return (
    <div className="page-tools">
      <header className="tools-head">
        <div className="sec-eyebrow">MODEL DIRECTORY</div>
        <h1 className="tools-title">{typeName || '大模型'}</h1>
        <p className="tools-count">
          共 <b>{result.length}</b> 个模型平台
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
            placeholder="搜索模型厂商、平台或模型"
            aria-label="搜索模型厂商、平台或模型"
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

        <div className="chip-row" role="group" aria-label="模型类型筛选">
          <button
            type="button"
            className={'chip' + (!type ? ' chip--active' : '')}
            aria-pressed={!type ? 'true' : 'false'}
            onClick={() => setFilter('type', '')}
          >
            <span>全部</span>
            <span className="chip-count">{baseForType.length}</span>
          </button>
          {MODEL_TYPES.map((c) => (
            <button
              key={c.code}
              type="button"
              className={'chip' + (type === c.code ? ' chip--active' : '')}
              aria-pressed={type === c.code ? 'true' : 'false'}
              onClick={() => setFilter('type', c.code)}
            >
              <span>{c.name}</span>
              <span className="chip-count">
                {baseForType.filter((t) => t.model_type === c.code).length}
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
