'use client';

/* OpenElf 开放精灵 · 偏好调节面板（保留原版功能）
 * 三项偏好：显示密度（舒适/紧凑）、排序方式（按知名度/最新收录/按名称）、主色调。
 * 默认值即品牌色定案：主色 #2563EB（精灵蓝）、深蓝 #1D4ED8（悬停/强调）、
 * 浅蓝 #EFF4FF（背景/分区）。
 * 偏好仅存于浏览器 localStorage（键 openelf:prefs:v2），不上传、无账号。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState
} from 'react';
import { usePathname } from 'next/navigation';
import { Icon } from './icons';

const PREFS_KEY = 'openelf:prefs:v2';

const DEFAULTS = {
  density: 'comfort', // comfort | compact
  sort: 'hot', // hot | latest | name
  accent: '#2563EB' // 品牌色：精灵蓝
};

const SORT_MODES = ['hot', 'latest', 'name'];

const ACCENT_PRESETS = ['#2563EB', '#0F172A', '#0E7490'];

/* 品牌默认色用精确值；用户自选色用 color-mix 派生强调/浅色变体 */
function applyAccent(accent) {
  const root = document.documentElement;
  const norm = (accent || '').trim().toLowerCase();
  if (norm === '#2563eb') {
    root.style.setProperty('--elf', '#2563EB');
    root.style.setProperty('--elf-strong', '#1D4ED8');
    root.style.setProperty('--elf-soft', '#EFF4FF');
  } else if (/^#[0-9a-f]{6}$/.test(norm)) {
    root.style.setProperty('--elf', norm);
    root.style.setProperty('--elf-strong', `color-mix(in srgb, ${norm} 78%, #10241B)`);
    root.style.setProperty('--elf-soft', `color-mix(in srgb, ${norm} 10%, #FFFFFF)`);
  }
}

function applyDensity(density) {
  const root = document.documentElement;
  if (density === 'compact') root.setAttribute('data-density', 'compact');
  else root.removeAttribute('data-density');
}

const PrefsContext = createContext(null);

export function usePrefs() {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error('usePrefs must be used within PreferencesProvider');
  return ctx;
}

export function PreferencesProvider({ children }) {
  const [prefs, setPrefs] = useState(DEFAULTS);
  const loaded = useRef(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PREFS_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        setPrefs({
          density: saved.density === 'compact' ? 'compact' : 'comfort',
          sort: SORT_MODES.includes(saved.sort) ? saved.sort : DEFAULTS.sort,
          accent: /^#[0-9A-Fa-f]{6}$/.test(saved.accent || '')
            ? saved.accent
            : DEFAULTS.accent
        });
      }
    } catch (_e) {
      /* 本地存储不可用时使用默认偏好 */
    }
    loaded.current = true;
  }, []);

  useEffect(() => {
    applyAccent(prefs.accent);
    applyDensity(prefs.density);
    if (loaded.current) {
      try {
        window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
      } catch (_e) {
        /* 存储失败时仅本次会话生效 */
      }
    }
  }, [prefs]);

  const setPref = useCallback((key, value) => {
    setPrefs((p) => ({ ...p, [key]: value }));
  }, []);

  const reset = useCallback(() => setPrefs(DEFAULTS), []);

  return (
    <PrefsContext.Provider value={{ ...prefs, setPref, reset }}>
      {children}
      <PreferencePanel prefs={prefs} setPref={setPref} reset={reset} />
    </PrefsContext.Provider>
  );
}

/* ── 偏好调节面板（悬浮按钮 + 抽屉） ─────────────────────── */
function PreferencePanel({ prefs, setPref, reset }) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);
  const pathname = usePathname() || '/';

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // 官网首页与下载页是纯品牌页，不展示图鉴偏好入口
  if (pathname === '/' || pathname === '/download' || pathname === '/download/') return null;
  // 开发者控制台使用独立全屏深色布局，不显示偏好悬浮按钮
  if (pathname === '/console' || pathname.startsWith('/console/')) return null;

  return (
    <>
      <button
        type="button"
        className={'pref-fab' + (open ? ' pref-fab--open' : '')}
        aria-expanded={open ? 'true' : 'false'}
        aria-controls="pref-panel"
        onClick={() => setOpen((v) => !v)}
        title="偏好设置"
      >
        <Icon name={open ? 'close' : 'sliders'} size={18} />
        <span className="pref-fab-label">偏好</span>
      </button>

      {open ? (
        <div className="pref-panel" id="pref-panel" role="dialog"
          aria-label="偏好设置" ref={panelRef}>
          <div className="pref-panel-head">
            <span className="pref-panel-title">偏好设置</span>
            <span className="pref-panel-note">仅保存在本浏览器</span>
          </div>

          <div className="pref-group">
            <div className="pref-group-label">界面 · 显示密度</div>
            <div className="pref-seg" role="radiogroup" aria-label="显示密度">
              <button
                type="button"
                role="radio"
                aria-checked={prefs.density === 'comfort'}
                className={'pref-seg-btn' + (prefs.density === 'comfort' ? ' is-on' : '')}
                onClick={() => setPref('density', 'comfort')}
              >
                舒适
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={prefs.density === 'compact'}
                className={'pref-seg-btn' + (prefs.density === 'compact' ? ' is-on' : '')}
                onClick={() => setPref('density', 'compact')}
              >
                紧凑
              </button>
            </div>
          </div>

          <div className="pref-group">
            <div className="pref-group-label">列表 · 排序方式</div>
            <div className="pref-seg" role="radiogroup" aria-label="排序方式">
              <button
                type="button"
                role="radio"
                aria-checked={prefs.sort === 'hot'}
                className={'pref-seg-btn' + (prefs.sort === 'hot' ? ' is-on' : '')}
                onClick={() => setPref('sort', 'hot')}
              >
                按知名度
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={prefs.sort === 'latest'}
                className={'pref-seg-btn' + (prefs.sort === 'latest' ? ' is-on' : '')}
                onClick={() => setPref('sort', 'latest')}
              >
                最新收录
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={prefs.sort === 'name'}
                className={'pref-seg-btn' + (prefs.sort === 'name' ? ' is-on' : '')}
                onClick={() => setPref('sort', 'name')}
              >
                按名称
              </button>
            </div>
          </div>

          <div className="pref-group">
            <div className="pref-group-label">主题 · 主色调</div>
            <div className="pref-swatches">
              {ACCENT_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={
                    'pref-swatch' +
                    (prefs.accent.toLowerCase() === c.toLowerCase() ? ' is-on' : '')
                  }
                  style={{ background: c }}
                  aria-label={'主题色 ' + c}
                  aria-pressed={prefs.accent.toLowerCase() === c.toLowerCase()}
                  title={c}
                  onClick={() => setPref('accent', c)}
                />
              ))}
              <label className="pref-custom" title="自定义颜色">
                <input
                  type="color"
                  value={prefs.accent}
                  onChange={(e) => setPref('accent', e.target.value)}
                  aria-label="自定义主色调"
                />
                <span>自定义</span>
              </label>
            </div>
            <div className="pref-color-value mono">{prefs.accent}</div>
          </div>

          <button type="button" className="pref-reset" onClick={reset}>
            恢复默认（精灵蓝）
          </button>
        </div>
      ) : null}
    </>
  );
}
