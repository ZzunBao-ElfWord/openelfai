import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  errText,
  fetchPlatformModels,
  updatePlatformModel,
  type PlatformModel,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader } from '../components/ui/primitives';
import ConfirmDialog from '../components/ui/ConfirmDialog';

const MICRO = 1_000_000;

// 微元 → 元（最多 6 位小数）
function yuan(micro: number): string {
  return (micro / MICRO).toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  });
}

// 微元 → 表单输入值
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

const regionLabel: Record<string, string> = {
  domestic: '国内',
  overseas: '海外',
};

const statusTone = (status: string): 'green' | 'red' | 'gray' =>
  status === 'active' ? 'green' : status === 'disabled' || status === 'inactive' ? 'red' : 'gray';

const statusLabel: Record<string, string> = {
  active: '启用',
  disabled: '停用',
  inactive: '停用',
};

export default function PlatformModels() {
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const isSuper = me?.role === 'super_admin';

  const [editing, setEditing] = useState<PlatformModel | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [vendor, setVendor] = useState('');
  const [region, setRegion] = useState('domestic');
  const [capabilities, setCapabilities] = useState('');
  const [contextTokens, setContextTokens] = useState('');
  const [status, setStatus] = useState('active');
  const [inputPrice, setInputPrice] = useState('');
  const [outputPrice, setOutputPrice] = useState('');
  const [markupPct, setMarkupPct] = useState('');
  const [formError, setFormError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [notice, setNotice] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['platform-models'],
    queryFn: fetchPlatformModels,
  });

  const mutation = useMutation({
    mutationFn: () => {
      if (!editing) {
        return Promise.reject(new Error('no target'));
      }
      return updatePlatformModel({
        model_id: editing.model_id,
        vendor: vendor.trim(),
        display_name: displayName.trim(),
        region,
        capabilities: capabilities.trim(),
        context_tokens: Number(contextTokens),
        status,
        input_micro_per_1m: toMicro(inputPrice),
        output_micro_per_1m: toMicro(outputPrice),
        markup_bp: Math.round(Number(markupPct) * 10),
      });
    },
    onSuccess: () => {
      setConfirmOpen(false);
      setEditing(null);
      setFormError('');
      setNotice('模型配置已保存');
      void queryClient.invalidateQueries({ queryKey: ['platform-models'] });
    },
    onError: (err) => {
      setConfirmOpen(false);
      setFormError(errText(err, '保存失败'));
    },
  });

  function openEdit(m: PlatformModel) {
    setEditing(m);
    setDisplayName(m.display_name);
    setVendor(m.vendor);
    setRegion(m.region || 'domestic');
    setCapabilities(m.capabilities || '');
    setContextTokens(String(m.context_tokens));
    setStatus(m.status || 'active');
    setInputPrice(yuanInput(m.input_micro_per_1m));
    setOutputPrice(yuanInput(m.output_micro_per_1m));
    setMarkupPct(String(m.markup_bp / 10));
    setFormError('');
    setNotice('');
  }

  function validate(): string {
    if (!displayName.trim() || !vendor.trim()) return '展示名与厂商不能为空';
    const ctx = Number(contextTokens);
    if (!Number.isInteger(ctx) || ctx < 0) return '上下文长度必须为非负整数';
    if (inputPrice.trim() === '' || !Number.isFinite(Number(inputPrice)) || Number(inputPrice) < 0) {
      return '输入价必须为非负数字';
    }
    if (outputPrice.trim() === '' || !Number.isFinite(Number(outputPrice)) || Number(outputPrice) < 0) {
      return '输出价必须为非负数字';
    }
    if (markupPct.trim() === '' || !Number.isFinite(Number(markupPct)) || Number(markupPct) < 0) {
      return '加价率必须为非负数字';
    }
    return '';
  }

  return (
    <div>
      <PageHeader
        title="模型与价格"
        desc="对外模型目录与定价；金额单位为元，加价率按百分比展示（115% 表示售价 = 成本 ×1.15）"
      />

      {notice ? (
        <div className="mb-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">{notice}</div>
      ) : null}

      <Card>
        {error ? (
          <div className="p-6 text-sm text-red-600">{errText(error, '模型列表加载失败')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="th">模型 ID</th>
                  <th className="th">厂商</th>
                  <th className="th">展示名</th>
                  <th className="th">区域</th>
                  <th className="th text-right">上下文</th>
                  <th className="th">状态</th>
                  <th className="th text-right">输入价（元/百万 token）</th>
                  <th className="th text-right">输出价（元/百万 token）</th>
                  <th className="th text-right">加价率</th>
                  <th className="th">生效时间</th>
                  {isSuper ? <th className="th text-right">操作</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {isLoading ? (
                  <tr>
                    <td className="td text-gray-400" colSpan={isSuper ? 11 : 10}>
                      加载中…
                    </td>
                  </tr>
                ) : data && data.items.length > 0 ? (
                  data.items.map((m) => (
                    <tr key={m.model_id}>
                      <td className="td max-w-56 truncate font-mono text-xs text-gray-600" title={m.model_id}>
                        {m.model_id}
                      </td>
                      <td className="td text-gray-700">{m.vendor}</td>
                      <td className="td font-medium text-gray-900">{m.display_name}</td>
                      <td className="td">
                        <Badge tone={m.region === 'overseas' ? 'amber' : 'blue'}>
                          {regionLabel[m.region] ?? m.region}
                        </Badge>
                      </td>
                      <td className="td text-right tabular-nums text-gray-700">
                        {m.context_tokens.toLocaleString('zh-CN')}
                      </td>
                      <td className="td">
                        <div className="flex flex-wrap gap-1.5">
                          <Badge tone={statusTone(m.status)}>{statusLabel[m.status] ?? m.status}</Badge>
                          {m.external_only ? <Badge tone="gray">仅外部</Badge> : null}
                        </div>
                      </td>
                      <td className="td text-right tabular-nums text-gray-900">
                        {yuan(m.input_micro_per_1m)}
                      </td>
                      <td className="td text-right tabular-nums text-gray-900">
                        {yuan(m.output_micro_per_1m)}
                      </td>
                      <td className="td text-right tabular-nums text-gray-700">
                        {(m.markup_bp / 10).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}%
                      </td>
                      <td className="td whitespace-nowrap text-xs text-gray-500">
                        {fmtTime(m.effective_from)}
                      </td>
                      {isSuper ? (
                        <td className="td text-right">
                          <Button variant="secondary" onClick={() => openEdit(m)}>
                            编辑
                          </Button>
                        </td>
                      ) : null}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={isSuper ? 11 : 10}>
                      <EmptyState text="模型目录为空" />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={!!editing}
        title={`编辑模型 — ${editing?.model_id ?? ''}`}
        onClose={() => setEditing(null)}
        width="max-w-2xl"
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const msg = validate();
            if (msg) {
              setFormError(msg);
              return;
            }
            setFormError('');
            setConfirmOpen(true);
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">展示名</label>
              <Input className="w-full" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">厂商</label>
              <Input className="w-full" value={vendor} onChange={(e) => setVendor(e.target.value)} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">区域</label>
              <select className="input" value={region} onChange={(e) => setRegion(e.target.value)}>
                <option value="domestic">国内</option>
                <option value="overseas">海外</option>
                {region !== 'domestic' && region !== 'overseas' ? (
                  <option value={region}>{regionLabel[region] ?? region}</option>
                ) : null}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">状态</label>
              <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="active">启用</option>
                <option value="disabled">停用</option>
                {status !== 'active' && status !== 'disabled' ? (
                  <option value={status}>{statusLabel[status] ?? status}</option>
                ) : null}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">上下文（token）</label>
              <Input
                type="number"
                min="0"
                step="1"
                className="w-full"
                value={contextTokens}
                onChange={(e) => setContextTokens(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">能力（逗号分隔）</label>
              <Input
                className="w-full"
                placeholder="chat,vision,tools"
                value={capabilities}
                onChange={(e) => setCapabilities(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                输入价（元/百万 token）
              </label>
              <Input
                type="number"
                min="0"
                step="0.000001"
                className="w-full"
                value={inputPrice}
                onChange={(e) => setInputPrice(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                输出价（元/百万 token）
              </label>
              <Input
                type="number"
                min="0"
                step="0.000001"
                className="w-full"
                value={outputPrice}
                onChange={(e) => setOutputPrice(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                加价率（%）
              </label>
              <Input
                type="number"
                min="0"
                step="0.1"
                className="w-full"
                placeholder="115"
                value={markupPct}
                onChange={(e) => setMarkupPct(e.target.value)}
              />
            </div>
          </div>
          {formError ? <div className="text-sm text-red-600">{formError}</div> : null}
          <div className="flex justify-end gap-3">
            <Button type="button" onClick={() => setEditing(null)}>
              取消
            </Button>
            <Button variant="primary" type="submit" disabled={mutation.isPending}>
              保存
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={confirmOpen}
        title="确认保存模型配置？"
        description={
          editing ? (
            <span>
              模型：<b className="font-mono text-xs">{editing.model_id}</b>
              <br />
              展示名：{displayName}；厂商：{vendor}；区域：{regionLabel[region] ?? region}；状态：
              {statusLabel[status] ?? status}
              <br />
              输入价：<b>{yuan(toMicro(inputPrice))}</b> 元/百万 token；输出价：
              <b>{yuan(toMicro(outputPrice))}</b> 元/百万 token；加价率：
              <b>{Number(markupPct)}%</b>
              <br />
              保存后立即生效并记录审计日志。
            </span>
          ) : null
        }
        confirmText="确认保存"
        danger={false}
        loading={mutation.isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => mutation.mutate()}
      />
    </div>
  );
}
