import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  errText,
  fetchPlatformDevelopers,
  fetchPlatformKeys,
  fetchPlatformWallet,
  revokePlatformKey,
  topupPlatformWallet,
  updatePlatformKey,
  type PlatformDeveloper,
  type PlatformKey,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Modal,
  PageHeader,
  Textarea,
} from '../components/ui/primitives';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import Pagination from '../components/ui/Pagination';

const PAGE_SIZE = 20;
const MICRO = 1_000_000;

function yuan(micro: number): string {
  return (micro / MICRO).toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  });
}

function yuanInput(micro: number): string {
  return String(micro / MICRO);
}

function toMicro(value: string): number {
  return Math.round(Number(value) * MICRO);
}

function fmtTime(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'number' ? v : Number(v);
  const d = new Date(Number.isFinite(n) ? n : v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('zh-CN', { hour12: false });
}

const devStatusTone = (status: string): 'green' | 'red' | 'amber' | 'gray' =>
  status === 'active' ? 'green' : status === 'suspended' ? 'red' : status === 'pending' ? 'amber' : 'gray';

const devStatusLabel: Record<string, string> = {
  pending: '待审核',
  active: '正常',
  suspended: '已停用',
  rejected: '已拒绝',
};

const ledgerTone = (type: string): 'green' | 'red' | 'amber' | 'blue' | 'gray' =>
  type === 'topup' ? 'green' : type === 'charge' ? 'red' : type === 'refund' ? 'blue' : type === 'adjust' ? 'amber' : 'gray';

export default function PlatformDevelopers() {
  const { me } = useAuth();
  const isSuper = me?.role === 'super_admin';
  const queryClient = useQueryClient();

  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<PlatformDeveloper | null>(null);
  const [keyPage, setKeyPage] = useState(1);
  const [notice, setNotice] = useState('');
  const [detailError, setDetailError] = useState('');

  // Key 编辑
  const [editKey, setEditKey] = useState<PlatformKey | null>(null);
  const [keyName, setKeyName] = useState('');
  const [keyQps, setKeyQps] = useState('');
  const [keyBudget, setKeyBudget] = useState('');
  const [keyModels, setKeyModels] = useState('');
  const [keyIps, setKeyIps] = useState('');
  const [keyFormError, setKeyFormError] = useState('');
  const [keyConfirm, setKeyConfirm] = useState(false);

  // Key 吊销
  const [revokeTarget, setRevokeTarget] = useState<PlatformKey | null>(null);

  // 钱包充值
  const [topupOpen, setTopupOpen] = useState(false);
  const [topupAmount, setTopupAmount] = useState('');
  const [topupNote, setTopupNote] = useState('');
  const [topupError, setTopupError] = useState('');
  const [topupConfirm, setTopupConfirm] = useState(false);

  const devQuery = useQuery({
    queryKey: ['platform-developers', status, page],
    queryFn: () => fetchPlatformDevelopers(status, page),
  });

  const userId = selected?.user_id ?? '';
  const keysQuery = useQuery({
    queryKey: ['platform-keys', userId, keyPage],
    queryFn: () => fetchPlatformKeys(userId, keyPage),
    enabled: !!userId,
  });
  const walletQuery = useQuery({
    queryKey: ['platform-wallet', userId],
    queryFn: () => fetchPlatformWallet(userId),
    enabled: !!userId,
  });

  const saveKeyMutation = useMutation({
    mutationFn: () => {
      if (!editKey) {
        return Promise.reject(new Error('no target'));
      }
      return updatePlatformKey(editKey.id, {
        name: keyName.trim(),
        allowed_models: keyModels.trim(),
        monthly_budget_micro: toMicro(keyBudget),
        qps_limit: Number(keyQps),
        ip_allowlist: keyIps.trim(),
      });
    },
    onSuccess: () => {
      setKeyConfirm(false);
      setEditKey(null);
      setKeyFormError('');
      setNotice('Key 配置已更新');
      void queryClient.invalidateQueries({ queryKey: ['platform-keys', userId] });
    },
    onError: (err) => {
      setKeyConfirm(false);
      setKeyFormError(errText(err, '保存失败'));
    },
  });

  const revokeMutation = useMutation({
    mutationFn: () => {
      if (!revokeTarget) {
        return Promise.reject(new Error('no target'));
      }
      return revokePlatformKey(revokeTarget.id);
    },
    onSuccess: () => {
      setRevokeTarget(null);
      setDetailError('');
      setNotice('Key 已吊销');
      void queryClient.invalidateQueries({ queryKey: ['platform-keys', userId] });
      void queryClient.invalidateQueries({ queryKey: ['platform-developers'] });
    },
    onError: (err) => {
      setRevokeTarget(null);
      setDetailError(errText(err, '吊销失败'));
    },
  });

  const topupMutation = useMutation({
    mutationFn: () =>
      topupPlatformWallet(userId, {
        amount_micro: toMicro(topupAmount),
        note: topupNote.trim(),
      }),
    onSuccess: () => {
      setTopupConfirm(false);
      setTopupOpen(false);
      setTopupAmount('');
      setTopupNote('');
      setTopupError('');
      setDetailError('');
      setNotice('充值成功，余额已更新');
      void queryClient.invalidateQueries({ queryKey: ['platform-wallet', userId] });
      void queryClient.invalidateQueries({ queryKey: ['platform-developers'] });
    },
    onError: (err) => {
      setTopupConfirm(false);
      setTopupError(errText(err, '充值失败'));
    },
  });

  function openDetail(d: PlatformDeveloper) {
    setSelected(d);
    setKeyPage(1);
    setNotice('');
    setDetailError('');
  }

  function closeDetail() {
    setSelected(null);
    setNotice('');
    setDetailError('');
    setEditKey(null);
    setKeyConfirm(false);
    setRevokeTarget(null);
    setTopupOpen(false);
    setTopupConfirm(false);
  }

  function openKeyEdit(k: PlatformKey) {
    setEditKey(k);
    setKeyName(k.name);
    setKeyQps(String(k.qps_limit));
    setKeyBudget(yuanInput(k.monthly_budget_micro));
    setKeyModels(k.allowed_models ?? '');
    setKeyIps(k.ip_allowlist ?? '');
    setKeyFormError('');
  }

  function openTopup() {
    setTopupAmount('');
    setTopupNote('');
    setTopupError('');
    setTopupOpen(true);
  }

  const wallet = walletQuery.data;
  const ledger = (wallet?.ledger ?? []).slice(0, 20);

  const topupAmountNum = Number(topupAmount);
  const topupValid =
    topupAmount.trim() !== '' && Number.isFinite(topupAmountNum) && topupAmountNum > 0 && !!topupNote.trim();

  return (
    <div>
      <PageHeader
        title="开发者与 Key"
        desc="开放平台开发者、API Key 与钱包；金额单位为元。吊销 Key 与充值均记录审计日志"
      />

      <form
        className="mb-4 flex flex-wrap gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
        }}
      >
        <select
          className="input max-w-40"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">全部状态</option>
          <option value="pending">待审核</option>
          <option value="active">正常</option>
          <option value="suspended">已停用</option>
        </select>
      </form>

      <Card>
        {devQuery.error ? (
          <div className="p-6 text-sm text-red-600">{errText(devQuery.error, '开发者列表加载失败')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="th">用户 ID</th>
                  <th className="th">姓名</th>
                  <th className="th">用途</th>
                  <th className="th">状态</th>
                  <th className="th">等级</th>
                  <th className="th text-right">余额（元）</th>
                  <th className="th text-right">冻结（元）</th>
                  <th className="th text-right">Key 数量</th>
                  <th className="th">创建时间</th>
                  <th className="th text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {devQuery.isLoading ? (
                  <tr>
                    <td className="td text-gray-400" colSpan={10}>
                      加载中…
                    </td>
                  </tr>
                ) : devQuery.data && devQuery.data.items.length > 0 ? (
                  devQuery.data.items.map((d) => (
                    <tr
                      key={d.user_id}
                      className="cursor-pointer hover:bg-gray-50"
                      onClick={() => openDetail(d)}
                    >
                      <td className="td font-mono text-xs text-gray-500" title={d.user_id}>
                        {d.user_id.slice(0, 12)}…
                      </td>
                      <td className="td font-medium text-gray-900">{d.real_name || '(未填写)'}</td>
                      <td className="td max-w-64 truncate text-xs text-gray-600" title={d.purpose}>
                        {d.purpose || '—'}
                      </td>
                      <td className="td">
                        <Badge tone={devStatusTone(d.status)}>
                          {devStatusLabel[d.status] ?? d.status}
                        </Badge>
                      </td>
                      <td className="td">
                        <Badge tone="blue">{d.tier || '—'}</Badge>
                      </td>
                      <td className="td text-right tabular-nums text-gray-900">{yuan(d.balance_micro)}</td>
                      <td
                        className={`td text-right tabular-nums ${
                          d.frozen_micro > 0 ? 'text-amber-600' : 'text-gray-500'
                        }`}
                      >
                        {yuan(d.frozen_micro)}
                      </td>
                      <td className="td text-right tabular-nums text-gray-700">{d.key_count}</td>
                      <td className="td whitespace-nowrap text-xs text-gray-500">
                        {fmtTime(d.created_at)}
                      </td>
                      <td className="td text-right">
                        <Button variant="secondary" onClick={() => openDetail(d)}>
                          查看
                        </Button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={10}>
                      <EmptyState text="没有匹配的开发者" />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {devQuery.data ? (
        <Pagination
          page={page}
          total={devQuery.data.total}
          pageSize={PAGE_SIZE}
          onChange={setPage}
        />
      ) : null}

      <Modal
        open={!!selected}
        title={`开发者 — ${selected?.real_name || selected?.user_id || ''}`}
        onClose={closeDetail}
        width="max-w-5xl"
      >
        {notice ? (
          <div className="mb-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">{notice}</div>
        ) : null}
        {detailError ? (
          <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{detailError}</div>
        ) : null}

        <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <div className="text-xs text-gray-400">用户 ID</div>
            <div className="break-all font-mono text-xs text-gray-600">{selected?.user_id}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400">状态</div>
            <div className="mt-0.5">
              {selected ? (
                <Badge tone={devStatusTone(selected.status)}>
                  {devStatusLabel[selected.status] ?? selected.status}
                </Badge>
              ) : null}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-400">等级</div>
            <div className="mt-0.5 text-gray-700">{selected?.tier || '—'}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400">创建时间</div>
            <div className="mt-0.5 text-xs text-gray-600">{fmtTime(selected?.created_at)}</div>
          </div>
          <div className="col-span-2">
            <div className="text-xs text-gray-400">用途</div>
            <div className="mt-0.5 text-gray-700">{selected?.purpose || '—'}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400">审核通过</div>
            <div className="mt-0.5 text-xs text-gray-600">{fmtTime(selected?.approved_at)}</div>
          </div>
        </div>

        <div className="mb-4 rounded-xl bg-gray-50 p-4 ring-1 ring-gray-200">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">钱包</h3>
            {isSuper ? (
              <Button variant="primary" onClick={openTopup}>
                充值
              </Button>
            ) : null}
          </div>
          {walletQuery.isLoading ? (
            <div className="py-2 text-sm text-gray-400">加载中…</div>
          ) : walletQuery.error ? (
            <div className="py-2 text-sm text-red-600">
              {errText(walletQuery.error, '钱包加载失败')}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <div className="text-xs text-gray-400">余额（元）</div>
                <div className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900">
                  {yuan(wallet?.balance_micro ?? selected?.balance_micro ?? 0)}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-400">冻结（元）</div>
                <div className="mt-0.5 text-lg font-semibold tabular-nums text-amber-600">
                  {yuan(wallet?.frozen_micro ?? selected?.frozen_micro ?? 0)}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-400">累计充值（元）</div>
                <div className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900">
                  {yuan(wallet?.total_topup_micro ?? selected?.total_topup_micro ?? 0)}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mb-4">
          <h3 className="mb-2 text-sm font-semibold text-gray-900">API Key（{keysQuery.data?.total ?? 0}）</h3>
          {keysQuery.error ? (
            <div className="py-2 text-sm text-red-600">{errText(keysQuery.error, 'Key 列表加载失败')}</div>
          ) : (
            <div className="overflow-x-auto rounded-lg ring-1 ring-gray-200">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="th">Key 前缀</th>
                    <th className="th">名称</th>
                    <th className="th text-right">QPS</th>
                    <th className="th text-right">月预算（元）</th>
                    <th className="th">允许模型</th>
                    <th className="th">最近使用</th>
                    <th className="th">状态</th>
                    {isSuper ? <th className="th text-right">操作</th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {keysQuery.isLoading ? (
                    <tr>
                      <td className="td text-gray-400" colSpan={isSuper ? 8 : 7}>
                        加载中…
                      </td>
                    </tr>
                  ) : keysQuery.data && keysQuery.data.items.length > 0 ? (
                    keysQuery.data.items.map((k) => (
                      <tr key={k.id}>
                        <td className="td whitespace-nowrap font-mono text-xs text-gray-700">
                          {k.key_prefix}…
                        </td>
                        <td className="td text-gray-900">{k.name}</td>
                        <td className="td text-right tabular-nums text-gray-700">{k.qps_limit}</td>
                        <td className="td text-right tabular-nums text-gray-700">
                          {yuan(k.monthly_budget_micro)}
                        </td>
                        <td className="td">
                          {k.allowed_models ? (
                            <div className="flex flex-wrap gap-1">
                              {k.allowed_models
                                .split(',')
                                .map((m) => m.trim())
                                .filter(Boolean)
                                .map((m) => (
                                  <Badge key={m} tone="gray">
                                    {m}
                                  </Badge>
                                ))}
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400">全部</span>
                          )}
                        </td>
                        <td className="td whitespace-nowrap text-xs text-gray-500">
                          {fmtTime(k.last_used_at)}
                        </td>
                        <td className="td">
                          {k.revoked_at ? (
                            <Badge tone="red">已吊销</Badge>
                          ) : (
                            <Badge tone="green">正常</Badge>
                          )}
                        </td>
                        {isSuper ? (
                          <td className="td text-right">
                            <div className="flex justify-end gap-2">
                              <Button variant="secondary" onClick={() => openKeyEdit(k)}>
                                编辑
                              </Button>
                              {k.revoked_at ? null : (
                                <Button variant="danger" onClick={() => setRevokeTarget(k)}>
                                  吊销
                                </Button>
                              )}
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={isSuper ? 8 : 7}>
                        <EmptyState text="该开发者暂无 Key" />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          {keysQuery.data ? (
            <Pagination
              page={keyPage}
              total={keysQuery.data.total}
              pageSize={PAGE_SIZE}
              onChange={setKeyPage}
            />
          ) : null}
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-900">钱包账本（最近 20 条）</h3>
          {walletQuery.error ? (
            <div className="py-2 text-sm text-red-600">{errText(walletQuery.error, '账本加载失败')}</div>
          ) : ledger.length === 0 ? (
            <EmptyState text="暂无账本记录" />
          ) : (
            <div className="overflow-x-auto rounded-lg ring-1 ring-gray-200">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="th">时间</th>
                    <th className="th">类型</th>
                    <th className="th text-right">金额（元）</th>
                    <th className="th text-right">余额（元）</th>
                    <th className="th">备注</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {ledger.map((l, i) => (
                    <tr key={l.id ?? i}>
                      <td className="td whitespace-nowrap text-xs text-gray-500">
                        {fmtTime(l.created_at)}
                      </td>
                      <td className="td">
                        <Badge tone={ledgerTone(l.type)}>{l.type}</Badge>
                      </td>
                      <td
                        className={`td text-right tabular-nums ${
                          l.delta_micro >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}
                      >
                        {l.delta_micro >= 0 ? `+${yuan(l.delta_micro)}` : yuan(l.delta_micro)}
                      </td>
                      <td className="td text-right tabular-nums text-gray-700">
                        {yuan(l.balance_after)}
                      </td>
                      <td className="td max-w-64 truncate text-xs text-gray-500" title={l.note ?? ''}>
                        {l.note || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={!!editKey}
        title={`编辑 Key — ${editKey?.name ?? ''}`}
        onClose={() => setEditKey(null)}
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!keyName.trim()) {
              setKeyFormError('名称不能为空');
              return;
            }
            if (!Number.isInteger(Number(keyQps)) || Number(keyQps) < 1) {
              setKeyFormError('QPS 必须为不小于 1 的整数');
              return;
            }
            if (keyBudget.trim() === '' || !Number.isFinite(Number(keyBudget)) || Number(keyBudget) < 0) {
              setKeyFormError('月预算必须为非负数字');
              return;
            }
            setKeyFormError('');
            setKeyConfirm(true);
          }}
        >
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">名称</label>
            <Input className="w-full" value={keyName} onChange={(e) => setKeyName(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">QPS 上限</label>
              <Input
                type="number"
                min="1"
                step="1"
                className="w-full"
                value={keyQps}
                onChange={(e) => setKeyQps(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">月预算（元）</label>
              <Input
                type="number"
                min="0"
                step="0.000001"
                className="w-full"
                value={keyBudget}
                onChange={(e) => setKeyBudget(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">允许模型（逗号分隔）</label>
            <Input
              className="w-full"
              placeholder="留空表示允许全部"
              value={keyModels}
              onChange={(e) => setKeyModels(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">IP 白名单（逗号分隔）</label>
            <Input
              className="w-full"
              placeholder="留空表示不限制"
              value={keyIps}
              onChange={(e) => setKeyIps(e.target.value)}
            />
          </div>
          {keyFormError ? <div className="text-sm text-red-600">{keyFormError}</div> : null}
          <div className="flex justify-end gap-3">
            <Button type="button" onClick={() => setEditKey(null)}>
              取消
            </Button>
            <Button variant="primary" type="submit" disabled={saveKeyMutation.isPending}>
              保存
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={keyConfirm}
        title="确认保存 Key 配置？"
        description={
          <span>
            Key：<b>{keyName}</b>
            <br />
            QPS：<b>{keyQps}</b>；月预算：<b>{yuan(toMicro(keyBudget))}</b> 元
            <br />
            允许模型：{keyModels.trim() || '全部'}；IP 白名单：{keyIps.trim() || '不限制'}
            <br />
            保存后立即生效并记录审计日志。
          </span>
        }
        confirmText="确认保存"
        danger={false}
        loading={saveKeyMutation.isPending}
        onCancel={() => setKeyConfirm(false)}
        onConfirm={() => saveKeyMutation.mutate()}
      />

      <ConfirmDialog
        open={!!revokeTarget}
        title="确认吊销该 Key？"
        description={
          revokeTarget ? (
            <span>
              Key：<b>{revokeTarget.name}</b>（{revokeTarget.key_prefix}…）
              <br />
              吊销后使用该 Key 的调用会立即失败，且无法恢复。该操作记录审计日志。
            </span>
          ) : null
        }
        confirmText="确认吊销"
        loading={revokeMutation.isPending}
        onCancel={() => setRevokeTarget(null)}
        onConfirm={() => revokeMutation.mutate()}
      />

      <Modal open={topupOpen} title="开发者钱包充值" onClose={() => setTopupOpen(false)}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!topupValid) {
              setTopupError('充值金额必须大于 0，且备注必填');
              return;
            }
            setTopupError('');
            setTopupConfirm(true);
          }}
        >
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">充值金额（元）</label>
            <Input
              type="number"
              min="0.000001"
              step="0.000001"
              className="w-full"
              placeholder="如 100"
              value={topupAmount}
              onChange={(e) => setTopupAmount(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">备注（必填）</label>
            <Textarea
              className="w-full"
              placeholder="充值原因，将写入账本与审计日志"
              value={topupNote}
              onChange={(e) => setTopupNote(e.target.value)}
            />
          </div>
          {topupError ? <div className="text-sm text-red-600">{topupError}</div> : null}
          <div className="flex justify-end gap-3">
            <Button type="button" onClick={() => setTopupOpen(false)}>
              取消
            </Button>
            <Button variant="primary" type="submit" disabled={topupMutation.isPending}>
              提交充值
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={topupConfirm}
        title="确认充值？"
        description={
          <span>
            用户：<b className="font-mono text-xs">{userId}</b>
            <br />
            充值金额：<b>{yuan(toMicro(topupAmount))}</b> 元
            <br />
            备注：{topupNote.trim() || '—'}
            <br />
            该操作立即入账并记录审计日志。
          </span>
        }
        confirmText="确认充值"
        danger={false}
        loading={topupMutation.isPending}
        onCancel={() => setTopupConfirm(false)}
        onConfirm={() => topupMutation.mutate()}
      />
    </div>
  );
}
