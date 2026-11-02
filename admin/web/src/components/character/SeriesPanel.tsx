import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  authorizeCharacterSeries,
  createCharacterSeries,
  errCode,
  errText,
  fetchCharacterSeries,
  fetchCharacterSeriesDetail,
  mintCharacterSeries,
  renderCharacterSeries,
  retryCharacterSeries,
  type SeriesDetail,
  type SeriesItem,
  type SeriesSummary,
} from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Badge, Button, Card, EmptyState, Input } from '../ui/primitives';
import ConfirmDialog from '../ui/ConfirmDialog';

type Tone = 'gray' | 'red' | 'amber' | 'green' | 'blue';
type Notice = { tone: 'green' | 'red'; text: string };

const noticeClass: Record<Notice['tone'], string> = {
  green: 'bg-green-50 text-green-700',
  red: 'bg-red-50 text-red-600',
};

const renderBatch = 200;
const mintBatch = 50;

const statusTone = (status: string): Tone => {
  const v = (status || '').toLowerCase();
  if (v.includes('fail') || v.includes('error') || v.includes('invalid')) return 'red';
  if (v.includes('ready') || v.includes('mint') || v.includes('done') || v.includes('complete')) {
    return 'green';
  }
  if (v.includes('render') || v.includes('process') || v.includes('progress')) return 'blue';
  return 'gray';
};

const authTone = (status: string): Tone => {
  const v = (status || '').toLowerCase();
  if (v.includes('invalid') || v.includes('expire') || v.includes('reject')) return 'red';
  if (v.includes('author') || v.includes('valid') || v.includes('active')) return 'green';
  if (v.includes('pending') || v.includes('wait')) return 'amber';
  return 'gray';
};

// 上游错误码 → 中文可操作提示
function seriesErr(err: unknown): string {
  switch (errCode(err)) {
    case 'CHAIN_DISABLED':
      return '链服务未启用（CHAIN_DISABLED）：请在服务端配置链 RPC 与合约地址后重试';
    case 'TREASURY_NOT_CONFIGURED':
      return '金库未配置（TREASURY_NOT_CONFIGURED）：请先配置平台金库地址与签名密钥';
    case 'AUTH_INVALID':
      return '授权无效（AUTH_INVALID）：请核对 IP 方地址、合同号、授权有效期，且最大铸造数必须 ≥ 系列总数';
    case 'OPS_DISABLED':
      return '运营接口未启用（OPS_DISABLED）：BFF 未配置 OPS_TOKEN';
    default:
      return errText(err, '请求失败');
  }
}

function absoluteUrl(raw: string): string {
  if (!raw) return '';
  try {
    return new URL(raw, window.location.origin).href;
  } catch {
    return raw;
  }
}

// 生成可粘贴到「官方 AI 建档」页的 payload（字段与 OfficialElfFields 对齐）
function officialPayload(detail: SeriesDetail, item: SeriesItem) {
  const image = absoluteUrl(item.imageUrl ?? '');
  return {
    name: `${detail.name} #${item.idx}`,
    nickname: detail.name,
    intro: `${detail.name} 系列第 ${item.idx} 号，链上 Token #${item.tokenId ?? '—'}。`,
    persona: `官方系列「${detail.name}」铸造个体，保留原始形象与人格设定。`,
    generation: 1,
    edition: '官方首发 · 限定',
    baseCapacity: 3,
    avatarUrl: image,
    portraitUrl: image,
    officialNote: `官方系列发行「${detail.name}」第 ${item.idx} 号${
      item.tokenId !== undefined && item.tokenId !== null ? `，Token #${item.tokenId}` : ''
    }。`,
    series: [{ name: detail.name, index: item.idx, tokenId: item.tokenId ?? null }],
  };
}

function progressOf(detail: SeriesDetail) {
  return (
    detail.progress ?? {
      pending: detail.pending,
      minted: detail.minted,
      failed: detail.failed,
    }
  );
}

interface PendingAction {
  title: string;
  description: ReactNode;
  confirmText: string;
  danger: boolean;
  action: () => void;
}

export default function SeriesPanel() {
  const { me } = useAuth();
  const isSuper = me?.role === 'super_admin';
  const queryClient = useQueryClient();

  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirm, setConfirm] = useState<PendingAction | null>(null);

  const [name, setName] = useState('');
  const [total, setTotal] = useState('100');
  const [style, setStyle] = useState('anime');
  const [seedStart, setSeedStart] = useState('');
  const [formError, setFormError] = useState('');

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [ipOwner, setIpOwner] = useState('');
  const [contractNo, setContractNo] = useState('');
  const [scope, setScope] = useState<'0' | '1' | '2'>('0');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [maxMint, setMaxMint] = useState('');
  const [authError, setAuthError] = useState('');

  const listQuery = useQuery({
    queryKey: ['character-series'],
    queryFn: () => fetchCharacterSeries(20),
  });

  const detailQuery = useQuery({
    queryKey: ['character-series-detail', selectedId],
    queryFn: () => fetchCharacterSeriesDetail(selectedId as string),
    enabled: !!selectedId,
  });

  const detail = detailQuery.data ?? null;

  function invalidate(id?: string | null) {
    void queryClient.invalidateQueries({ queryKey: ['character-series'] });
    if (id) {
      void queryClient.invalidateQueries({ queryKey: ['character-series-detail', id] });
    }
  }

  const createMutation = useMutation({
    mutationFn: createCharacterSeries,
    onSuccess: (series) => {
      setSelectedId(series.id);
      setFormError('');
      setNotice({ tone: 'green', text: `系列「${series.name}」已创建，共 ${series.total} 版` });
      invalidate(series.id);
    },
    onError: (err) => setNotice({ tone: 'red', text: `创建失败：${seriesErr(err)}` }),
  });

  const renderMutation = useMutation({
    mutationFn: (id: string) => renderCharacterSeries(id, renderBatch),
    onSuccess: (progress, id) => {
      setNotice({
        tone: 'green',
        text: `本批渲染完成：待渲染 ${progress.pending} / 已铸 ${progress.minted} / 失败 ${progress.failed}`,
      });
      invalidate(id);
    },
    onError: (err) => setNotice({ tone: 'red', text: `渲染失败：${seriesErr(err)}` }),
  });

  const authorizeMutation = useMutation({
    mutationFn: (vars: { id: string; body: Parameters<typeof authorizeCharacterSeries>[1] }) =>
      authorizeCharacterSeries(vars.id, vars.body),
    onSuccess: (res, vars) => {
      setNotice({ tone: 'green', text: `授权登记成功：${res.authId}（${res.authStatus}）` });
      invalidate(vars.id);
    },
    onError: (err) => setNotice({ tone: 'red', text: `授权登记失败：${seriesErr(err)}` }),
  });

  const mintMutation = useMutation({
    mutationFn: (id: string) => mintCharacterSeries(id, mintBatch),
    onSuccess: (progress, id) => {
      setNotice({
        tone: 'green',
        text: `本批铸造完成：已铸 ${progress.minted} / 待铸 ${progress.pending} / 失败 ${progress.failed}`,
      });
      invalidate(id);
    },
    onError: (err) => setNotice({ tone: 'red', text: `铸造失败：${seriesErr(err)}` }),
  });

  const retryMutation = useMutation({
    mutationFn: (id: string) => retryCharacterSeries(id, mintBatch),
    onSuccess: (progress, id) => {
      setNotice({
        tone: 'green',
        text: `本批重铸完成：已铸 ${progress.minted} / 待铸 ${progress.pending} / 失败 ${progress.failed}`,
      });
      invalidate(id);
    },
    onError: (err) => setNotice({ tone: 'red', text: `重铸失败：${seriesErr(err)}` }),
  });

  const busy =
    renderMutation.isPending ||
    mintMutation.isPending ||
    retryMutation.isPending ||
    authorizeMutation.isPending;

  function ask(action: PendingAction) {
    setNotice(null);
    setConfirm(action);
  }

  function runConfirmed() {
    const action = confirm;
    setConfirm(null);
    if (action) action.action();
  }

  function submitCreate() {
    const n = Number(total);
    if (!name.trim()) {
      setFormError('系列名称不能为空');
      return;
    }
    if (name.trim().length > 64) {
      setFormError('系列名称不能超过 64 个字符');
      return;
    }
    if (!Number.isInteger(n) || n < 1 || n > 10000) {
      setFormError('总数必须是 1-10000 的整数');
      return;
    }
    const styleValue = style.trim();
    if (!/^[a-z0-9_-]{1,24}$/i.test(styleValue)) {
      setFormError('风格只能由字母、数字、下划线或短横线组成（1-24 位）');
      return;
    }
    let seed: number | undefined;
    if (seedStart.trim() !== '') {
      seed = Number(seedStart);
      if (!Number.isSafeInteger(seed) || seed < 0) {
        setFormError('起始 seed 必须是非负整数');
        return;
      }
    }
    setFormError('');
    ask({
      title: '确认创建系列？',
      description: (
        <span>
          系列：<b>{name.trim()}</b>
          <br />
          总数：<b>{n}</b> 版 · 风格：<b>{styleValue}</b>
          {seed !== undefined ? ` · 起始 seed ${seed}` : ''}
          <br />
          创建后需依次渲染、授权登记、分批铸造，全部写操作均由 openelf-api 执行。
        </span>
      ),
      confirmText: '创建系列',
      danger: false,
      action: () =>
        createMutation.mutate({
          name: name.trim(),
          total: n,
          style: styleValue,
          seedStart: seed,
        }),
    });
  }

  function submitAuthorize() {
    if (!detail) return;
    if (!ipOwner.trim()) {
      setAuthError('IP 方地址不能为空');
      return;
    }
    if (!contractNo.trim()) {
      setAuthError('合同号不能为空');
      return;
    }
    const start = startAt ? new Date(startAt).getTime() : NaN;
    const end = endAt ? new Date(endAt).getTime() : NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      setAuthError('请填写生效时间与到期时间');
      return;
    }
    if (end <= start) {
      setAuthError('到期时间必须晚于生效时间');
      return;
    }
    const max = Number(maxMint);
    if (!Number.isInteger(max) || max < detail.total) {
      setAuthError(`最大铸造数必须是 ≥ ${detail.total}（系列总数）的整数`);
      return;
    }
    setAuthError('');
    const body = {
      ipOwner: ipOwner.trim(),
      contractNo: contractNo.trim(),
      scope: Number(scope) as 0 | 1 | 2,
      startTime: start,
      endTime: end,
      maxMint: max,
    };
    ask({
      title: '确认登记授权？',
      description: (
        <span>
          IP 方：<b className="break-all">{body.ipOwner}</b>
          <br />
          合同号：<b>{body.contractNo}</b> · 范围：{body.scope} · 最大铸造：{body.maxMint}
          <br />
          有效期：{new Date(body.startTime).toLocaleString('zh-CN', { hour12: false })} 至{' '}
          {new Date(body.endTime).toLocaleString('zh-CN', { hour12: false })}
          <br />
          授权登记后不可撤回，请与线下合同逐项核对后再提交。
        </span>
      ),
      confirmText: '确认登记',
      danger: true,
      action: () => authorizeMutation.mutate({ id: detail.id, body }),
    });
  }

  function askRender() {
    if (!detail) return;
    ask({
      title: `确认渲染本批 ${renderBatch} 条？`,
      description: (
        <span>
          系列：<b>{detail.name}</b>，当前待渲染 <b>{progressOf(detail).pending}</b> 条。
          <br />
          渲染为串行合成，单批最多 {renderBatch} 条；完成后若仍未 ready，需再次点击继续。
        </span>
      ),
      confirmText: '开始渲染',
      danger: false,
      action: () => renderMutation.mutate(detail.id),
    });
  }

  function askMint() {
    if (!detail) return;
    ask({
      title: `确认铸造本批 ${mintBatch} 条？`,
      description: (
        <span>
          系列：<b>{detail.name}</b>，授权状态 <b>{detail.authStatus || '未知'}</b>。
          <br />
          铸造会产生真实链上交易与 gas 消耗，单批最多 {mintBatch} 条；请确认已取得有效授权。
        </span>
      ),
      confirmText: '开始铸造',
      danger: true,
      action: () => mintMutation.mutate(detail.id),
    });
  }

  function askRetry() {
    if (!detail) return;
    ask({
      title: `确认重铸本批 ${mintBatch} 条？`,
      description: (
        <span>
          系列：<b>{detail.name}</b>，当前失败 <b>{progressOf(detail).failed}</b> 条。
          <br />
          重铸会为失败条目重新发起链上交易，可能产生额外 gas 消耗。
        </span>
      ),
      confirmText: '开始重铸',
      danger: true,
      action: () => retryMutation.mutate(detail.id),
    });
  }

  async function copyPayload(target: SeriesDetail, item: SeriesItem) {
    const text = JSON.stringify(officialPayload(target, item), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setNotice({ tone: 'green', text: `已复制「${target.name} #${item.idx}」官方建档 payload` });
    } catch {
      setNotice({ tone: 'red', text: '复制失败，请检查浏览器剪贴板权限' });
    }
  }

  function openDetail(id: string) {
    setNotice(null);
    setAuthError('');
    setSelectedId(id);
  }

  const progress = detail ? progressOf(detail) : null;
  const items = detail?.items ? [...detail.items].sort((a, b) => a.idx - b.idx) : [];

  return (
    <div>
      {notice ? (
        <div className={`mb-4 rounded-lg px-4 py-3 text-sm ${noticeClass[notice.tone]}`}>
          {notice.text}
        </div>
      ) : null}

      <h2 className="mb-3 text-base font-semibold text-gray-900">系列发行</h2>
      <p className="mb-4 text-xs text-gray-400">
        千人千面 B2B 系列：渲染 → 授权登记 → 分批铸造 → 失败重铸；写操作全部由 openelf-api 内部运营接口执行。
        {!isSuper ? ' 当前角色只读，写操作仅 super_admin 可执行。' : ''}
      </p>

      <Card className="mb-4">
        <form
          className="space-y-4 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            submitCreate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">系列名称</label>
              <Input
                value={name}
                maxLength={64}
                placeholder="如：鲸凌限定系列"
                disabled={!isSuper}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">总数（1-10000）</label>
              <Input
                type="number"
                min="1"
                max="10000"
                step="1"
                value={total}
                disabled={!isSuper}
                onChange={(e) => setTotal(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">风格</label>
              <Input
                value={style}
                placeholder="anime"
                disabled={!isSuper}
                onChange={(e) => setStyle(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                起始 seed（可选）
              </label>
              <Input
                type="number"
                min="0"
                step="1"
                value={seedStart}
                placeholder="留空则随机"
                disabled={!isSuper}
                onChange={(e) => setSeedStart(e.target.value)}
              />
            </div>
          </div>

          {formError ? <div className="text-sm text-red-600">{formError}</div> : null}

          <div className="flex items-center justify-end">
            <Button variant="primary" type="submit" disabled={!isSuper || createMutation.isPending}>
              {createMutation.isPending ? '创建中…' : '新建系列'}
            </Button>
          </div>
        </form>
      </Card>

      {detail ? (
        <Card className="mb-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                {detail.name}
                <Badge tone={statusTone(detail.status)}>{detail.status || '—'}</Badge>
                <Badge tone={authTone(detail.authStatus)}>
                  授权 {detail.authStatus || '未登记'}
                </Badge>
              </div>
              <div className="mt-1 text-xs text-gray-400">
                共 {detail.total} 版 · 风格 {detail.style || '—'} · 创建于{' '}
                {detail.createdAt
                  ? new Date(detail.createdAt).toLocaleString('zh-CN', { hour12: false })
                  : '—'}
              </div>
            </div>
            <Button variant="secondary" onClick={() => setSelectedId(null)}>
              返回列表
            </Button>
          </div>

          {detailQuery.isLoading ? (
            <div className="p-6 text-sm text-gray-400">系列详情加载中…</div>
          ) : detailQuery.error ? (
            <div className="p-4 text-sm text-red-600">
              {errText(detailQuery.error, '系列详情加载失败')}
            </div>
          ) : (
            <>
              <div className="grid gap-3 border-b border-gray-100 px-4 py-3 sm:grid-cols-3">
                {[
                  { label: '待渲染/待铸', value: progress?.pending ?? 0 },
                  { label: '已铸造', value: progress?.minted ?? 0 },
                  { label: '失败', value: progress?.failed ?? 0 },
                ].map((p) => (
                  <div key={p.label} className="rounded-lg bg-gray-50 px-3 py-2">
                    <div className="text-xs text-gray-500">{p.label}</div>
                    <div className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900">
                      {p.value}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3">
                <Button
                  variant="primary"
                  disabled={!isSuper || busy || (progress?.pending ?? 0) === 0}
                  onClick={askRender}
                >
                  分批渲染（本批 {renderBatch} 条）
                </Button>
                <Button
                  variant="primary"
                  disabled={!isSuper || busy || (progress?.pending ?? 0) === 0}
                  onClick={askMint}
                >
                  分批铸造（本批 {mintBatch} 条）
                </Button>
                <Button
                  variant="danger"
                  disabled={!isSuper || busy || (progress?.failed ?? 0) === 0}
                  onClick={askRetry}
                >
                  失败重铸（本批 {mintBatch} 条）
                </Button>
                {busy ? (
                  <span className="animate-pulse text-sm text-blue-600">
                    批处理执行中，请勿关闭页面…
                  </span>
                ) : null}
              </div>
              <div className="border-b border-gray-100 px-4 py-2 text-xs text-gray-400">
                分批执行：渲染每批 {renderBatch} 条、铸造/重铸每批 {mintBatch} 条；每次完成后按进度继续点击，直到状态 ready。
              </div>

              <div className="px-4 py-4">
                <h3 className="mb-3 text-sm font-semibold text-gray-900">授权登记</h3>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-gray-700">IP 方地址</label>
                    <Input
                      value={ipOwner}
                      placeholder="0x… 或 IP 方钱包地址"
                      disabled={!isSuper}
                      onChange={(e) => setIpOwner(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-gray-700">合同号</label>
                    <Input
                      value={contractNo}
                      placeholder="线下合同编号"
                      disabled={!isSuper}
                      onChange={(e) => setContractNo(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-gray-700">
                      授权范围（0-2）
                    </label>
                    <select
                      className="input"
                      value={scope}
                      disabled={!isSuper}
                      onChange={(e) => setScope(e.target.value as '0' | '1' | '2')}
                    >
                      <option value="0">范围 0</option>
                      <option value="1">范围 1</option>
                      <option value="2">范围 2</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-gray-700">生效时间</label>
                    <Input
                      type="datetime-local"
                      value={startAt}
                      disabled={!isSuper}
                      onChange={(e) => setStartAt(e.target.value)}
                    />
                    <p className="mt-1 text-xs text-gray-400">按本地时间选择，提交时转为毫秒时间戳</p>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-gray-700">到期时间</label>
                    <Input
                      type="datetime-local"
                      value={endAt}
                      disabled={!isSuper}
                      onChange={(e) => setEndAt(e.target.value)}
                    />
                    <p className="mt-1 text-xs text-gray-400">按本地时间选择，提交时转为毫秒时间戳</p>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-gray-700">
                      最大铸造数（须 ≥ 总数 {detail.total}）
                    </label>
                    <Input
                      type="number"
                      min={detail.total}
                      step="1"
                      value={maxMint}
                      placeholder={String(detail.total)}
                      disabled={!isSuper}
                      onChange={(e) => setMaxMint(e.target.value)}
                    />
                  </div>
                </div>
                {authError ? <div className="mt-3 text-sm text-red-600">{authError}</div> : null}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-gray-400">
                    startTime / endTime 以毫秒时间戳提交；maxMint 必须 ≥ 系列总数，否则上游返回 AUTH_INVALID。
                  </p>
                  <Button variant="primary" disabled={!isSuper || busy} onClick={submitAuthorize}>
                    提交授权登记
                  </Button>
                </div>
              </div>
            </>
          )}
        </Card>
      ) : null}

      {detail && items.length > 0 ? (
        <Card className="mb-4">
          <div className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-900">
            系列条目（{items.length}）
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="th">缩略图</th>
                  <th className="th">IDX</th>
                  <th className="th">Token ID</th>
                  <th className="th">Tx Hash</th>
                  <th className="th">稀有度</th>
                  <th className="th">状态</th>
                  <th className="th text-right">官方建档</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((item) => (
                  <tr key={`${item.idx}-${item.compositionHash}`}>
                    <td className="td">
                      {item.imageUrl ? (
                        <a href={item.imageUrl} target="_blank" rel="noreferrer">
                          <img
                            src={item.thumbUrl ?? item.imageUrl}
                            alt={`#${item.idx}`}
                            loading="lazy"
                            className="h-12 w-12 rounded bg-gray-50 object-contain"
                          />
                        </a>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="td tabular-nums text-gray-700">{item.idx}</td>
                    <td className="td font-mono text-xs text-gray-600">
                      {item.tokenId !== undefined && item.tokenId !== null ? item.tokenId : '—'}
                    </td>
                    <td className="td font-mono text-xs text-gray-500">
                      {item.txHash ? `${item.txHash.slice(0, 12)}…` : '—'}
                    </td>
                    <td className="td">
                      <Badge tone={statusTone(item.rarityTier ?? '')}>
                        {item.rarityTier ?? '—'}
                      </Badge>
                    </td>
                    <td className="td">
                      {item.error ? (
                        <span className="text-xs text-red-600">{item.error}</span>
                      ) : (
                        <Badge tone={statusTone(item.status)}>{item.status || '—'}</Badge>
                      )}
                    </td>
                    <td className="td text-right">
                      <Button variant="ghost" onClick={() => void copyPayload(detail, item)}>
                        复制官方建档 payload
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 text-xs text-gray-400">
            「复制官方建档 payload」生成官方 AI 建档字段，粘贴到「官方 AI 运营 → 创建官方建档」页提交；
            不走一键建档，确保每条上架前都经人工审核。
          </div>
        </Card>
      ) : null}

      <h3 className="mb-3 text-sm font-semibold text-gray-900">最近系列</h3>
      <Card>
        {listQuery.error ? (
          <div className="p-6 text-sm text-red-600">
            {errText(listQuery.error, '系列列表加载失败')}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="th">系列</th>
                  <th className="th">状态</th>
                  <th className="th">授权</th>
                  <th className="th text-right">总数</th>
                  <th className="th text-right">已铸</th>
                  <th className="th text-right">失败</th>
                  <th className="th text-right">待处理</th>
                  <th className="th">创建时间</th>
                  <th className="th text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {listQuery.isLoading ? (
                  <tr>
                    <td className="td text-gray-400" colSpan={9}>
                      加载中…
                    </td>
                  </tr>
                ) : listQuery.data && listQuery.data.length > 0 ? (
                  listQuery.data.map((series: SeriesSummary) => (
                    <tr key={series.id}>
                      <td className="td">
                        <div className="flex items-center gap-2">
                          {series.coverUrl ? (
                            <img
                              src={series.coverUrl}
                              alt={series.name}
                              className="h-8 w-8 rounded object-cover"
                            />
                          ) : null}
                          <div>
                            <div className="font-medium text-gray-900">{series.name}</div>
                            <div className="mt-0.5 font-mono text-xs text-gray-400">{series.id}</div>
                          </div>
                        </div>
                      </td>
                      <td className="td">
                        <Badge tone={statusTone(series.status)}>{series.status || '—'}</Badge>
                      </td>
                      <td className="td">
                        <Badge tone={authTone(series.authStatus)}>
                          {series.authStatus || '未登记'}
                        </Badge>
                      </td>
                      <td className="td text-right tabular-nums text-gray-700">{series.total}</td>
                      <td className="td text-right tabular-nums text-gray-700">{series.minted}</td>
                      <td className="td text-right tabular-nums text-gray-700">{series.failed}</td>
                      <td className="td text-right tabular-nums text-gray-700">{series.pending}</td>
                      <td className="td whitespace-nowrap text-xs text-gray-500">
                        {series.createdAt
                          ? new Date(series.createdAt).toLocaleString('zh-CN', { hour12: false })
                          : '—'}
                      </td>
                      <td className="td text-right">
                        <Button variant="secondary" onClick={() => openDetail(series.id)}>
                          查看详情
                        </Button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={9}>
                      <EmptyState text="暂无系列" />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title ?? ''}
        description={confirm?.description}
        confirmText={confirm?.confirmText}
        danger={confirm?.danger}
        loading={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={runConfirmed}
      />
    </div>
  );
}
