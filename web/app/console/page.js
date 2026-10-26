'use client';

/* OpenElf 开发者控制台（纯客户端页面）：
 * 登录 → 用量信息 / API Keys / 账单。所有数据来自 api.openelfai.com，
 * 静态导出后为 /console/index.html，不包含任何服务端请求。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

const API_BASE = 'https://api.openelfai.com';
const AUTH_KEY = 'openelf:console:auth';
const DEVICE_KEY = 'openelf:console:device';

const VIEW_META = {
  usage: {
    label: '用量信息',
    title: '用量信息',
    note: '数据按 UTC+8 统计，存在约 5 分钟延迟。'
  },
  keys: {
    label: 'API Keys',
    title: 'API Keys',
    note: '管理默认 API Key，与 App 内「我的 API Key」为同一把。'
  },
  topup: {
    label: '充值',
    title: '充值',
    note: '充值余额实时到账，可用于开放平台 API 调用与 App 内 AI 对话。'
  },
  billing: {
    label: '账单',
    title: '账单',
    note: '余额变动记录，每笔充值、消费与退款都会出现在这里。'
  }
};

const VIEW_ORDER = ['usage', 'keys', 'topup', 'billing'];

const LEDGER_TYPES = {
  topup: '充值',
  charge: '消费',
  refund: '退款',
  adjust: '调整',
  bonus: '赠送',
  freeze: '冻结',
  unfreeze: '解冻'
};

/* ── 格式化与请求工具 ───────────────────────────────────── */

function formatCny(micro) {
  const value = Number(micro || 0) / 1000000;
  return (
    '¥' +
    value.toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
  );
}

function formatSignedCny(micro) {
  const value = Number(micro || 0);
  return (value >= 0 ? '+' : '-') + formatCny(Math.abs(value));
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('zh-CN');
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
    .format(date)
    .replace(/\//g, '-');
}

function maskPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length >= 7) return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
  return phone || '—';
}

function typeLabel(type) {
  return LEDGER_TYPES[type] || type || '—';
}

function walletBalanceText(wallet) {
  if (!wallet) return null;
  if (typeof wallet === 'number') return formatCny(wallet);
  if (typeof wallet.balance_micro === 'number') return formatCny(wallet.balance_micro);
  return null;
}

function errorMessage(status) {
  if (status === 401) return '登录已失效，请重新登录';
  if (status === 402) return '余额不足，请先充值';
  if (status === 403) return '没有权限访问该资源';
  if (status === 404) return '接口不存在或资源已失效';
  if (status === 429) return '请求过于频繁，请稍后再试';
  if (status >= 500) return '服务暂时不可用，请稍后再试';
  return '请求失败，请稍后再试';
}

async function apiRequest(path, { method = 'GET', body, authToken } = {}) {
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (_e) {
    throw new Error('网络异常，请检查网络后重试');
  }

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_e) {
      data = null;
    }
  }

  if (!res.ok) {
    const fromBody =
      (data && data.error && data.error.message) ||
      (typeof data?.error === 'string' ? data.error : '') ||
      data?.message ||
      data?.msg;
    const err = new Error(fromBody || errorMessage(res.status));
    err.status = res.status;
    err.code = data?.error?.code || '';
    err.payload = data;
    throw err;
  }

  return data || {};
}

/* deviceId 规则：^[A-Za-z0-9_-]{8,80}$，本地持久化 */
function ensureDeviceId() {
  try {
    const saved = window.localStorage.getItem(DEVICE_KEY);
    if (saved && /^[A-Za-z0-9_-]{8,80}$/.test(saved)) return saved;
  } catch (_e) {
    /* 本地存储不可用时使用本次生成的 ID */
  }
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = 'web-console-';
  for (let i = 0; i < 16; i += 1) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  try {
    window.localStorage.setItem(DEVICE_KEY, id);
  } catch (_e) {
    /* 忽略存储失败 */
  }
  return id;
}

/* 充值订单操作编号：服务端按 requestId 幂等，重复点击不会重复下单 */
function newRequestId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let suffix = '';
  for (let i = 0; i < 6; i += 1) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `topup-${Date.now()}-${suffix}`;
}

async function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  area.remove();
}

/* ── 登录视图 ───────────────────────────────────────────── */

function LoginView({ notice, onNoticeClear, onLoggedIn }) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [sending, setSending] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const [debugCode, setDebugCode] = useState('');

  useEffect(() => {
    if (countdown <= 0) return undefined;
    const timer = setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const message = error || notice;

  const handleSend = async () => {
    const value = phone.trim();
    if (!/^\d{6,15}$/.test(value)) {
      setError('请输入正确的手机号');
      return;
    }
    setSending(true);
    setError('');
    setHint('');
    setDebugCode('');
    try {
      const data = await apiRequest('/api/v1/auth/send-code', {
        method: 'POST',
        body: { phone: value }
      });
      const wait = Number(data?.resendAfter);
      setCountdown(Number.isFinite(wait) && wait > 0 ? Math.ceil(wait) : 60);
      if (data?.debugCode) setDebugCode(String(data.debugCode));
      setHint('验证码已发送，请查收');
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const phoneValue = phone.trim();
    const codeValue = code.trim();
    if (!/^\d{6,15}$/.test(phoneValue)) {
      setError('请输入正确的手机号');
      return;
    }
    if (!codeValue) {
      setError('请输入验证码');
      return;
    }
    setLoggingIn(true);
    setError('');
    onNoticeClear();
    try {
      const data = await apiRequest('/api/v1/auth/login-by-code', {
        method: 'POST',
        body: { phone: phoneValue, code: codeValue, deviceId: ensureDeviceId() }
      });
      if (!data?.accessToken) throw new Error('登录响应异常，请稍后再试');
      try {
        window.localStorage.setItem(
          AUTH_KEY,
          JSON.stringify({
            accessToken: data.accessToken,
            refreshToken: data.refreshToken || '',
            user: data.user || null
          })
        );
      } catch (_e) {
        /* 存储失败时仅本次会话有效 */
      }
      onLoggedIn(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoggingIn(false);
    }
  };

  return (
    <div className="console-login">
      <div className="console-login-card">
        <div className="console-login-brand">
          <span className="console-brand-mark">
            <img src="/logo.png" alt="" />
          </span>
          <span>
            <b>OpenElf</b>
            <em>开放平台</em>
          </span>
        </div>

        <h1>登录开发者控制台</h1>
        <p className="console-login-sub">使用 App 同款账号登录</p>

        <form className="console-login-form" onSubmit={handleSubmit}>
          <label className="console-field">
            <span>手机号</span>
            <input
              type="tel"
              name="phone"
              inputMode="numeric"
              autoComplete="tel"
              placeholder="请输入手机号"
              value={phone}
              maxLength={15}
              onChange={(event) => {
                setPhone(event.target.value);
                setError('');
                onNoticeClear();
              }}
            />
          </label>

          <label className="console-field">
            <span>验证码</span>
            <div className="console-code-row">
              <input
                type="text"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="6 位验证码"
                value={code}
                maxLength={8}
                onChange={(event) => {
                  setCode(event.target.value);
                  setError('');
                  onNoticeClear();
                }}
              />
              <button
                type="button"
                className="console-btn console-btn--ghost"
                onClick={handleSend}
                disabled={countdown > 0 || sending || !phone.trim()}
              >
                {countdown > 0 ? `${countdown} 秒后重发` : sending ? '发送中…' : '发送验证码'}
              </button>
            </div>
          </label>

          {message ? (
            <p className="console-form-error" role="alert">
              {message}
            </p>
          ) : null}
          {debugCode ? (
            <p className="console-form-hint">当前为测试环境，验证码：{debugCode}</p>
          ) : hint ? (
            <p className="console-form-hint">{hint}</p>
          ) : null}

          <button
            type="submit"
            className="console-btn console-btn--primary console-btn--block"
            disabled={loggingIn}
          >
            {loggingIn ? '登录中…' : '登录'}
          </button>
        </form>

        <p className="console-login-foot">
          未注册的手机号将自动创建账号；登录即表示同意平台服务条款。
        </p>
      </div>
      <Link className="console-login-back" href="/platform/">
        返回开放平台
      </Link>
    </div>
  );
}

/* ── 用量柱状图（纯 CSS） ───────────────────────────────── */

function UsageChart({ daysData }) {
  const hasUsage = daysData.some(
    (item) => Number(item.requests || 0) > 0 || Number(item.cost_micro || 0) > 0
  );

  if (!hasUsage) {
    return <div className="console-empty">暂无用量</div>;
  }

  const max = Math.max(...daysData.map((item) => Number(item.cost_micro || 0)), 1);
  const step = daysData.length <= 10 ? 1 : daysData.length <= 30 ? 5 : 15;

  return (
    <div className="console-chart-wrap">
      <div className="console-chart" role="img" aria-label="每日消费柱状图">
        {daysData.map((item, index) => {
          const cost = Number(item.cost_micro || 0);
          const height = cost > 0 ? Math.max(3, (cost / max) * 100) : 0;
          return (
            <div className="console-bar-col" key={item.date || index}>
              <div className="console-bar-track">
                <div className="console-bar" style={{ height: `${height}%` }}>
                  <span className="console-bar-tip">
                    {item.date}
                    <br />
                    {formatCny(cost)}
                  </span>
                </div>
              </div>
              <span className="console-bar-label">
                {index % step === 0 || index === daysData.length - 1
                  ? String(item.date || '').slice(5)
                  : ''}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── 用量信息面板 ───────────────────────────────────────── */

function UsagePanel({
  overview,
  overviewLoading,
  overviewError,
  usage,
  usageLoading,
  usageError,
  days,
  onDaysChange,
  onExport
}) {
  const models = [...(usage?.by_model || [])].sort(
    (a, b) => Number(b.cost_micro || 0) - Number(a.cost_micro || 0)
  );
  const stats = overview?.stats30d || {};
  const wallet = overview?.wallet || {};

  return (
    <div className="console-view">
      {overviewError ? <div className="console-alert">{overviewError}</div> : null}

      <div className="console-stat-grid">
        {overviewLoading && !overview
          ? [0, 1, 2].map((index) => (
              <div className="console-stat console-skeleton" key={index} />
            ))
          : [
              {
                label: '可用余额',
                value: overview ? formatCny(wallet.balance_micro) : '—',
                note:
                  Number(wallet.frozen_micro || 0) > 0
                    ? `冻结 ${formatCny(wallet.frozen_micro)}`
                    : '余额预充值，按 token 扣费'
              },
              {
                label: '累计消费',
                value: overview ? formatCny(stats.cost_micro) : '—',
                note: '近 30 天'
              },
              {
                label: '累计充值',
                value: overview ? formatCny(wallet.total_topup_micro) : '—',
                note: '支持支付宝在线充值'
              }
            ].map((item) => (
              <div className="console-stat" key={item.label}>
                <span className="console-stat-label">{item.label}</span>
                <strong className="console-stat-value mono">{item.value}</strong>
                <span className="console-stat-note">{item.note}</span>
              </div>
            ))}
      </div>

      <div className="console-stat-grid console-stat-grid--compact">
        {[
          {
            label: '近 30 天消费',
            value: formatCny(stats.cost_micro)
          },
          {
            label: 'API 请求次数',
            value: formatNumber(stats.requests)
          },
          {
            label: 'Tokens',
            value: formatNumber(stats.tokens)
          }
        ].map((item) => (
          <div className="console-stat console-stat--compact" key={item.label}>
            <span className="console-stat-label">{item.label}</span>
            <strong className="console-stat-value console-stat-value--small mono">
              {overview ? item.value : '—'}
            </strong>
          </div>
        ))}
      </div>

      <section className="console-panel">
        <div className="console-panel-head">
          <div>
            <h2>每日消费</h2>
            <p>近 {days} 天 · 单位人民币</p>
          </div>
          <div className="console-panel-actions">
            <div className="console-seg" role="group" aria-label="时间范围">
              {[7, 30, 90].map((value) => (
                <button
                  type="button"
                  key={value}
                  className={days === value ? 'is-on' : ''}
                  aria-pressed={days === value}
                  onClick={() => onDaysChange(value)}
                >
                  {value} 天
                </button>
              ))}
            </div>
            <button
              type="button"
              className="console-btn console-btn--ghost"
              onClick={onExport}
              disabled={!usage?.days?.length}
            >
              导出 CSV
            </button>
          </div>
        </div>

        {usageError ? (
          <div className="console-alert">{usageError}</div>
        ) : usageLoading && !usage ? (
          <div className="console-loading">加载中…</div>
        ) : (
          <UsageChart daysData={usage?.days || []} />
        )}
      </section>

      <section className="console-panel">
        <div className="console-panel-head">
          <div>
            <h2>按模型明细</h2>
            <p>按消费降序 · 近 {days} 天</p>
          </div>
        </div>

        {models.length ? (
          <div className="console-model-grid">
            {models.map((item) => (
              <article className="console-model-card" key={item.model}>
                <code className="console-model-id">{item.model}</code>
                <dl className="console-model-meta">
                  <div>
                    <dt>请求数</dt>
                    <dd className="mono">{formatNumber(item.requests)}</dd>
                  </div>
                  <div>
                    <dt>Tokens</dt>
                    <dd className="mono">{formatNumber(item.tokens)}</dd>
                  </div>
                  <div>
                    <dt>消费</dt>
                    <dd className="mono">{formatCny(item.cost_micro)}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        ) : (
          <div className="console-empty">暂无模型用量</div>
        )}
      </section>
    </div>
  );
}

/* ── API Keys 面板 ──────────────────────────────────────── */

function KeysPanel({
  keyInfo,
  loading,
  error,
  revealedKey,
  revealing,
  copied,
  onToggleReveal,
  onCopy,
  onOpenReset
}) {
  const balanceText = walletBalanceText(keyInfo?.wallet);
  const revoked = Boolean(keyInfo?.revoked_at);
  const maskedValue =
    keyInfo?.api_key_masked ||
    (keyInfo?.key_prefix ? `${keyInfo.key_prefix}…` : '—');

  return (
    <div className="console-view">
      <section className="console-panel">
        <div className="console-panel-head">
          <div>
            <h2>默认 API Key</h2>
            <p>用于所有模型调用，请妥善保管</p>
          </div>
          {keyInfo ? (
            <span className={revoked ? 'console-badge is-off' : 'console-badge is-on'}>
              {revoked ? '已撤销' : '正常'}
            </span>
          ) : null}
        </div>

        {error ? <div className="console-alert">{error}</div> : null}

        {loading && !keyInfo ? (
          <div className="console-loading">加载中…</div>
        ) : !keyInfo ? (
          <div className="console-empty">暂无 API Key 信息</div>
        ) : (
          <>
            <div className="console-key-row">
              <code className="console-key-value">{revealedKey || maskedValue}</code>
              <div className="console-key-actions">
                <button
                  type="button"
                  className="console-btn console-btn--ghost"
                  onClick={onToggleReveal}
                  disabled={revealing}
                >
                  {revealedKey ? '隐藏' : revealing ? '加载中…' : '显示'}
                </button>
                <button
                  type="button"
                  className="console-btn console-btn--ghost"
                  onClick={onCopy}
                >
                  {copied ? '已复制' : '复制'}
                </button>
                <button
                  type="button"
                  className="console-btn console-btn--danger-ghost"
                  onClick={onOpenReset}
                >
                  重置密钥
                </button>
              </div>
            </div>

            <dl className="console-key-meta">
              <div>
                <dt>创建时间</dt>
                <dd>{formatDateTime(keyInfo.created_at)}</dd>
              </div>
              <div>
                <dt>状态</dt>
                <dd>
                  {revoked
                    ? `已撤销 · ${formatDateTime(keyInfo.revoked_at)}`
                    : '正常'}
                </dd>
              </div>
              {balanceText ? (
                <div>
                  <dt>钱包余额</dt>
                  <dd className="mono">{balanceText}</dd>
                </div>
              ) : null}
            </dl>

            <p className="console-hint">
              Key 与 App 内「我的 API Key」是同一把；余额不足时请求返回 402。请勿把
              Key 写入前端代码或公开仓库。
            </p>
          </>
        )}
      </section>
    </div>
  );
}

/* ── 充值面板 ───────────────────────────────────────────── */

function TopupPanel({
  catalog,
  loading,
  error,
  wallet,
  account,
  tierId,
  customOpen,
  customAmount,
  paying,
  notice,
  onSelectTier,
  onToggleCustom,
  onCustomChange,
  onSubmit
}) {
  const tiers = catalog?.products || [];
  const minYuan = Math.max(1, Math.ceil(Number(catalog?.custom?.min_fen || 100) / 100));
  const maxYuan = Math.max(minYuan, Math.floor(Number(catalog?.custom?.max_fen || 500000) / 100));
  const enabled = Boolean(catalog?.enabled);

  return (
    <div className="console-view">
      <section className="console-panel console-topup">
        <div className="console-topup-balance">
          <div>
            <span className="console-topup-balance-label">当前余额</span>
            <strong className="console-topup-balance-value mono">
              {wallet ? formatCny(wallet.balance_micro) : '—'}
            </strong>
          </div>
          <span className="console-topup-balance-note">充值后立即到账</span>
        </div>

        {error ? <div className="console-alert">{error}</div> : null}

        {loading && !catalog ? (
          <div className="console-loading">加载中…</div>
        ) : (
          <>
            <div className="console-topup-section">
              <span className="console-topup-label">支付金额</span>
              <div className="console-tier-row">
                {tiers.map((tier) => (
                  <button
                    type="button"
                    key={tier.id}
                    className={
                      !customOpen && tierId === tier.id
                        ? 'console-tier is-on'
                        : 'console-tier'
                    }
                    aria-pressed={!customOpen && tierId === tier.id}
                    onClick={() => onSelectTier(tier.id)}
                  >
                    ¥{tier.yuan}
                  </button>
                ))}
                <button
                  type="button"
                  className={customOpen ? 'console-tier is-on' : 'console-tier'}
                  aria-pressed={customOpen}
                  onClick={onToggleCustom}
                >
                  自定义
                </button>
              </div>

              {customOpen ? (
                <label className="console-custom-row">
                  <span>¥</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={minYuan}
                    max={maxYuan}
                    step="1"
                    placeholder={`${minYuan}-${maxYuan} 的整数金额`}
                    value={customAmount}
                    onChange={(event) => onCustomChange(event.target.value)}
                  />
                </label>
              ) : null}
            </div>

            <div className="console-topup-section">
              <span className="console-topup-label">支付方式</span>
              <div className="console-pay-method">
                <span className="console-pay-method-name">支付宝</span>
                <span className="console-pay-method-note">跳转支付宝收银台完成支付</span>
                <span className="console-pay-method-check" aria-hidden="true">
                  ✓
                </span>
              </div>
            </div>

            <button
              type="button"
              className="console-btn console-btn--primary console-btn--block console-topup-submit"
              onClick={onSubmit}
              disabled={!enabled || paying}
            >
              {paying ? '正在处理…' : '去支付'}
            </button>

            <p className="console-topup-account">
              余额将充入当前账户（{maskPhone(account)}）
            </p>

            {!enabled ? (
              <div className="console-topup-notice is-error">
                支付宝充值尚未配置完成，暂时无法在线充值。
              </div>
            ) : null}

            {notice ? (
              <div className={`console-topup-notice is-${notice.kind}`}>{notice.text}</div>
            ) : null}

            <ul className="console-topup-tips">
              <li>余额按 token 计费，可用于开放平台 API 调用与 App 内 AI 对话。</li>
              <li>支付成功后通常几秒内到账；若未到账，请稍后刷新余额或查看账单。</li>
              <li>余额仅用于消费，不可提现、不可转让。</li>
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

/* ── 账单面板 ───────────────────────────────────────────── */

function BillingPanel({ items, loading, error, hasMore, onLoadMore }) {
  return (
    <div className="console-view">
      <section className="console-panel">
        <div className="console-panel-head">
          <div>
            <h2>余额变动</h2>
            <p>每笔充值、消费与退款记录</p>
          </div>
        </div>

        {error ? <div className="console-alert">{error}</div> : null}

        {loading && !items.length ? (
          <div className="console-loading">加载中…</div>
        ) : !items.length ? (
          <div className="console-empty">暂无账单记录</div>
        ) : (
          <div className="console-table-wrap">
            <table className="console-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>类型</th>
                  <th className="is-num">金额</th>
                  <th className="is-num">余额</th>
                  <th>备注</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const delta = Number(item.delta_micro || 0);
                  return (
                    <tr key={item.id}>
                      <td className="mono console-time">{formatDateTime(item.created_at)}</td>
                      <td>
                        <span className={`console-type console-type--${item.type || 'other'}`}>
                          {typeLabel(item.type)}
                        </span>
                      </td>
                      <td
                        className={
                          'is-num mono ' + (delta >= 0 ? 'is-positive' : 'is-negative')
                        }
                      >
                        {formatSignedCny(delta)}
                      </td>
                      <td className="is-num mono">{formatCny(item.balance_after)}</td>
                      <td className="console-note-cell">{item.note || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="console-panel-foot">
          {hasMore ? (
            <button
              type="button"
              className="console-btn console-btn--ghost"
              onClick={onLoadMore}
              disabled={loading}
            >
              {loading ? '加载中…' : '加载更多'}
            </button>
          ) : items.length ? (
            <span className="console-foot-note">已加载全部记录</span>
          ) : null}
        </div>
      </section>
    </div>
  );
}

/* ── 控制台主页面 ───────────────────────────────────────── */

export default function ConsolePage() {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState(null);
  const [account, setAccount] = useState('');
  const [view, setView] = useState('usage');
  const [loginNotice, setLoginNotice] = useState('');

  const [overview, setOverview] = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState('');

  const [days, setDays] = useState(30);
  const [usage, setUsage] = useState(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState('');

  const [keyInfo, setKeyInfo] = useState(null);
  const [keyLoading, setKeyLoading] = useState(false);
  const [keyError, setKeyError] = useState('');
  const [revealedKey, setRevealedKey] = useState('');
  const [revealing, setRevealing] = useState(false);
  const [copied, setCopied] = useState(false);

  const [topupCatalog, setTopupCatalog] = useState(null);
  const [topupLoading, setTopupLoading] = useState(false);
  const [topupError, setTopupError] = useState('');
  const [tierId, setTierId] = useState('');
  const [customOpen, setCustomOpen] = useState(false);
  const [customAmount, setCustomAmount] = useState('');
  const [paying, setPaying] = useState(false);
  const [topupNotice, setTopupNotice] = useState(null);

  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState('');

  const [ledgerItems, setLedgerItems] = useState([]);
  const [ledgerNext, setLedgerNext] = useState(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerError, setLedgerError] = useState('');
  const nextBeforeRef = useRef(null);

  /* 启动时读取本地登录态 */
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(AUTH_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved?.accessToken) {
          setToken(saved.accessToken);
          if (saved?.user?.phone) setAccount(saved.user.phone);
        }
      }
    } catch (_e) {
      /* 本地存储异常时保持未登录态 */
    }
    setReady(true);
  }, []);

  const clearAuth = useCallback((message = '') => {
    try {
      window.localStorage.removeItem(AUTH_KEY);
    } catch (_e) {
      /* 忽略存储失败 */
    }
    setToken(null);
    setOverview(null);
    setUsage(null);
    setKeyInfo(null);
    setRevealedKey('');
    setLedgerItems([]);
    setLedgerNext(null);
    nextBeforeRef.current = null;
    setTopupCatalog(null);
    setTopupNotice(null);
    setPaying(false);
    setLoginNotice(message);
  }, []);

  const fetchAuthed = useCallback(
    async (path, options = {}) => {
      try {
        return await apiRequest(path, { ...options, authToken: token });
      } catch (err) {
        if (err.status === 401) {
          clearAuth('登录已失效，请重新登录');
          const nextError = new Error('登录已失效，请重新登录');
          nextError.status = 401;
          throw nextError;
        }
        throw err;
      }
    },
    [token, clearAuth]
  );

  /* 概览 */
  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    setOverviewError('');
    try {
      const data = await fetchAuthed('/api/v1/platform/console/overview');
      setOverview(data);
      if (data?.user?.phone) setAccount(data.user.phone);
    } catch (err) {
      setOverviewError(err.message);
    } finally {
      setOverviewLoading(false);
    }
  }, [fetchAuthed]);

  useEffect(() => {
    if (!token) return;
    loadOverview();
  }, [token, loadOverview]);

  /* 用量 */
  useEffect(() => {
    if (!token || view !== 'usage') return undefined;
    let alive = true;
    setUsageLoading(true);
    setUsageError('');
    fetchAuthed(`/api/v1/platform/console/usage?days=${days}`)
      .then((data) => {
        if (alive) setUsage(data);
      })
      .catch((err) => {
        if (alive) setUsageError(err.message);
      })
      .finally(() => {
        if (alive) setUsageLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token, view, days, fetchAuthed]);

  /* API Key */
  useEffect(() => {
    if (!token || view !== 'keys') return undefined;
    let alive = true;
    setKeyLoading(true);
    setKeyError('');
    setRevealedKey('');
    fetchAuthed('/api/v1/platform/my-key')
      .then((data) => {
        if (alive) setKeyInfo(data);
      })
      .catch((err) => {
        if (alive) setKeyError(err.message);
      })
      .finally(() => {
        if (alive) setKeyLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token, view, fetchAuthed]);

  /* 账单 */
  const loadLedger = useCallback(
    async (reset) => {
      if (!token) return;
      setLedgerLoading(true);
      setLedgerError('');
      try {
        const before = reset ? null : nextBeforeRef.current;
        const query =
          '/api/v1/platform/console/ledger?limit=50' +
          (before !== null && before !== undefined
            ? `&before_id=${encodeURIComponent(before)}`
            : '');
        const data = await fetchAuthed(query);
        const items = Array.isArray(data?.items) ? data.items : [];
        setLedgerItems((prev) => (reset ? items : [...prev, ...items]));
        const next = data?.next_before_id ?? null;
        nextBeforeRef.current = next;
        setLedgerNext(next);
      } catch (err) {
        setLedgerError(err.message);
      } finally {
        setLedgerLoading(false);
      }
    },
    [token, fetchAuthed]
  );

  useEffect(() => {
    if (!token || view !== 'billing') return;
    nextBeforeRef.current = null;
    setLedgerNext(null);
    loadLedger(true);
  }, [token, view, loadLedger]);

  /* 充值档位 */
  useEffect(() => {
    if (!token || view !== 'topup') return undefined;
    let alive = true;
    setTopupLoading(true);
    setTopupError('');
    fetchAuthed('/api/v1/platform/topup/products')
      .then((data) => {
        if (!alive) return;
        setTopupCatalog(data);
        setTierId((prev) => prev || data?.products?.[0]?.id || '');
      })
      .catch((err) => {
        if (alive) setTopupError(err.message);
      })
      .finally(() => {
        if (alive) setTopupLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token, view, fetchAuthed]);

  /* 支付宝回跳后轮询订单，确认到账并刷新余额 */
  const pollTopupOrder = useCallback(
    async (orderId) => {
      setPaying(true);
      setTopupNotice({ kind: 'info', text: '支付结果确认中，请稍候…' });
      try {
        for (let attempt = 0; attempt < 6; attempt += 1) {
          if (attempt > 0) {
            await new Promise((resolve) => window.setTimeout(resolve, 3000));
          }
          try {
            const data = await fetchAuthed(
              `/api/v1/platform/topup/orders/${encodeURIComponent(orderId)}`
            );
            if (data?.status === 'paid') {
              setTopupNotice({
                kind: 'success',
                text: `充值成功，已到账 ${formatCny(Number(data.amount_fen || 0) * 10000)}`
              });
              await loadOverview();
              return;
            }
            if (data?.status && data.status !== 'pending') {
              setTopupNotice({ kind: 'error', text: '订单未支付或已关闭，请重新发起充值' });
              return;
            }
          } catch (err) {
            if (attempt === 5) {
              setTopupNotice({
                kind: 'error',
                text: err.message || '支付结果暂未确认，请稍后刷新余额'
              });
              return;
            }
          }
        }
        setTopupNotice({ kind: 'error', text: '支付结果仍在确认中，请稍后刷新余额或查看账单' });
      } finally {
        setPaying(false);
      }
    },
    [fetchAuthed, loadOverview]
  );

  useEffect(() => {
    if (!token) return;
    let orderId = '';
    try {
      orderId = new URLSearchParams(window.location.search).get('order') || '';
    } catch (_e) {
      /* URL 解析失败时按普通进入处理 */
    }
    if (!orderId) return;
    setView('topup');
    try {
      window.history.replaceState(null, '', window.location.pathname);
    } catch (_e) {
      /* 历史记录不可写时保留原地址 */
    }
    pollTopupOrder(orderId);
  }, [token, pollTopupOrder]);

  const handleTopupPay = async () => {
    const catalog = topupCatalog;
    if (!catalog?.enabled || paying) {
      if (catalog && !catalog.enabled) {
        setTopupNotice({ kind: 'error', text: '支付宝充值尚未配置完成' });
      }
      return;
    }

    const minYuan = Math.max(1, Math.ceil(Number(catalog.custom?.min_fen || 100) / 100));
    const maxYuan = Math.floor(Number(catalog.custom?.max_fen || 500000) / 100);
    const body = {
      tierId: customOpen ? 'custom' : tierId,
      requestId: newRequestId(),
      channel: 'web'
    };

    if (customOpen) {
      const amount = Number(customAmount);
      if (!Number.isInteger(amount) || amount < minYuan || amount > maxYuan) {
        setTopupNotice({ kind: 'error', text: `请输入 ${minYuan}-${maxYuan} 的整数金额` });
        return;
      }
      body.amountYuan = amount;
    } else if (!body.tierId) {
      setTopupNotice({ kind: 'error', text: '请选择充值金额' });
      return;
    }

    setPaying(true);
    setTopupNotice({ kind: 'info', text: '正在创建充值订单…' });
    try {
      let data;
      try {
        data = await fetchAuthed('/api/v1/platform/topup/orders', {
          method: 'POST',
          body
        });
      } catch (err) {
        const pendingId = err.payload?.error?.order_id || err.payload?.error?.orderId;
        if (err.code === 'TOPUP_PENDING_ORDER' && pendingId) {
          setTopupNotice({ kind: 'info', text: '你有一笔待支付订单，正在继续支付…' });
          data = await fetchAuthed(
            `/api/v1/platform/topup/orders/${encodeURIComponent(pendingId)}/pay`,
            { method: 'POST', body: { channel: 'web' } }
          );
        } else {
          throw err;
        }
      }

      if (data?.status === 'paid') {
        setTopupNotice({ kind: 'success', text: '充值成功，余额已到账' });
        await loadOverview();
        return;
      }
      if (!data?.payUrl) throw new Error('支付链接生成失败，请稍后再试');

      setTopupNotice({ kind: 'info', text: '正在跳转支付宝收银台…' });
      window.location.assign(data.payUrl);
    } catch (err) {
      setTopupNotice({ kind: 'error', text: err.message || '充值下单失败，请稍后重试' });
    } finally {
      setPaying(false);
    }
  };

  /* Escape 关闭重置弹层 */
  useEffect(() => {
    if (!resetOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !resetting) {
        setResetOpen(false);
        setResetError('');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [resetOpen, resetting]);

  const handleLoggedIn = (data) => {
    setToken(data.accessToken);
    setAccount(data?.user?.phone || '');
    setLoginNotice('');
    setView('usage');
  };

  const handleExport = () => {
    const rows = usage?.days || [];
    if (!rows.length) return;
    const lines = ['日期,请求数,Tokens,消费(元)'];
    rows.forEach((item) => {
      lines.push(
        [
          item.date || '',
          Number(item.requests || 0),
          Number(item.tokens || 0),
          (Number(item.cost_micro || 0) / 1000000).toFixed(6)
        ].join(',')
      );
    });
    const blob = new Blob(['\uFEFF' + lines.join('\n')], {
      type: 'text/csv;charset=utf-8'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `openelf-usage-${days}d.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleToggleReveal = async () => {
    if (revealedKey) {
      setRevealedKey('');
      return;
    }
    setRevealing(true);
    setKeyError('');
    try {
      const data = await fetchAuthed('/api/v1/platform/my-key/reveal', {
        method: 'POST'
      });
      if (!data?.api_key) throw new Error('未能获取 Key，请稍后再试');
      setRevealedKey(data.api_key);
    } catch (err) {
      setKeyError(err.message);
    } finally {
      setRevealing(false);
    }
  };

  const handleCopyKey = async () => {
    setKeyError('');
    try {
      let value = revealedKey;
      if (!value) {
        const data = await fetchAuthed('/api/v1/platform/my-key/reveal', {
          method: 'POST'
        });
        value = data?.api_key || '';
        if (value) setRevealedKey(value);
      }
      if (!value) throw new Error('未能获取 Key，请稍后再试');
      await copyText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch (err) {
      setKeyError(err.message);
    }
  };

  const handleResetKey = async () => {
    setResetting(true);
    setResetError('');
    try {
      await fetchAuthed('/api/v1/platform/my-key/reset', { method: 'POST' });
      setResetOpen(false);
      setRevealedKey('');
      const data = await fetchAuthed('/api/v1/platform/my-key');
      setKeyInfo(data);
    } catch (err) {
      setResetError(err.message);
    } finally {
      setResetting(false);
    }
  };

  if (!ready) {
    return (
      <div className="console-root">
        <div className="console-boot">加载中…</div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="console-root console-root--login">
        <LoginView
          notice={loginNotice}
          onNoticeClear={() => setLoginNotice('')}
          onLoggedIn={handleLoggedIn}
        />
      </div>
    );
  }

  const meta = VIEW_META[view] || VIEW_META.usage;
  const hasMore = ledgerNext !== null && ledgerNext !== undefined && Boolean(ledgerItems.length);

  return (
    <div className="console-root">
      <div className="console-shell">
        <aside className="console-side">
          <Link className="console-brand" href="/platform/">
            <span className="console-brand-mark">
              <img src="/logo.png" alt="" />
            </span>
            <span className="console-brand-text">
              <b>OpenElf</b>
              <em>开放平台</em>
            </span>
          </Link>

          <nav className="console-nav" aria-label="控制台导航">
            {VIEW_ORDER.map((key) => (
              <button
                type="button"
                key={key}
                className={view === key ? 'is-active' : ''}
                aria-current={view === key ? 'page' : undefined}
                onClick={() => setView(key)}
              >
                {VIEW_META[key].label}
              </button>
            ))}
          </nav>

          <div className="console-side-bottom">
            <Link className="console-side-link" href="/platform/">
              接口文档
            </Link>
            <button
              type="button"
              className="console-side-link"
              onClick={() => clearAuth('')}
            >
              退出登录
            </button>
            <div className="console-account">
              <span className="console-account-label">当前账号</span>
              <span className="console-account-phone mono">
                {maskPhone(account || overview?.user?.phone)}
              </span>
            </div>
          </div>
        </aside>

        <main className="console-main">
          <div className="console-main-inner">
            <header className="console-head">
              <div>
                <h1>{meta.title}</h1>
                <p>{meta.note}</p>
              </div>
            </header>

            {view === 'usage' ? (
              <UsagePanel
                overview={overview}
                overviewLoading={overviewLoading}
                overviewError={overviewError}
                usage={usage}
                usageLoading={usageLoading}
                usageError={usageError}
                days={days}
                onDaysChange={setDays}
                onExport={handleExport}
              />
            ) : null}

            {view === 'keys' ? (
              <KeysPanel
                keyInfo={keyInfo}
                loading={keyLoading}
                error={keyError}
                revealedKey={revealedKey}
                revealing={revealing}
                copied={copied}
                onToggleReveal={handleToggleReveal}
                onCopy={handleCopyKey}
                onOpenReset={() => {
                  setResetError('');
                  setResetOpen(true);
                }}
              />
            ) : null}

            {view === 'topup' ? (
              <TopupPanel
                catalog={topupCatalog}
                loading={topupLoading}
                error={topupError}
                wallet={overview?.wallet}
                account={account || overview?.user?.phone}
                tierId={tierId}
                customOpen={customOpen}
                customAmount={customAmount}
                paying={paying}
                notice={topupNotice}
                onSelectTier={(id) => {
                  setTierId(id);
                  setCustomOpen(false);
                  setTopupNotice(null);
                }}
                onToggleCustom={() => {
                  setCustomOpen((prev) => !prev);
                  setTopupNotice(null);
                }}
                onCustomChange={(value) => {
                  setCustomAmount(value);
                  setTopupNotice(null);
                }}
                onSubmit={handleTopupPay}
              />
            ) : null}

            {view === 'billing' ? (
              <BillingPanel
                items={ledgerItems}
                loading={ledgerLoading}
                error={ledgerError}
                hasMore={hasMore}
                onLoadMore={() => loadLedger(false)}
              />
            ) : null}
          </div>
        </main>
      </div>

      {resetOpen ? (
        <div
          className="console-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !resetting) {
              setResetOpen(false);
              setResetError('');
            }
          }}
        >
          <div
            className="console-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="console-reset-title"
          >
            <h3 id="console-reset-title">重置默认密钥？</h3>
            <p>重置后旧 Key 立即失效，正在使用旧 Key 的服务需要替换为新 Key。</p>
            {resetError ? <p className="console-modal-error">{resetError}</p> : null}
            <div className="console-modal-actions">
              <button
                type="button"
                className="console-btn console-btn--ghost"
                onClick={() => {
                  setResetOpen(false);
                  setResetError('');
                }}
                disabled={resetting}
              >
                取消
              </button>
              <button
                type="button"
                className="console-btn console-btn--danger"
                onClick={handleResetKey}
                disabled={resetting}
              >
                {resetting ? '重置中…' : '确认重置'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
