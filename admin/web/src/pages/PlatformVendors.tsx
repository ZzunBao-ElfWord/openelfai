import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  errText,
  fetchPlatformVendors,
  saveVendorCredential,
  testVendorCredential,
  type VendorCredential,
  type VendorTestResponse,
  type VendorTestResult,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader } from '../components/ui/primitives';
import ConfirmDialog from '../components/ui/ConfirmDialog';

function fmtTime(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('zh-CN', { hour12: false });
}

const testLabel: Record<VendorTestResult, string> = {
  valid: '连接正常',
  invalid_key: '密钥无效',
  unreachable: '无法连通',
};

const testTone = (r: VendorTestResult): 'green' | 'red' | 'amber' =>
  r === 'valid' ? 'green' : r === 'invalid_key' ? 'red' : 'amber';

const testBoxClass: Record<VendorTestResult, string> = {
  valid: 'bg-green-50 text-green-700',
  invalid_key: 'bg-red-50 text-red-600',
  unreachable: 'bg-amber-50 text-amber-700',
};

type Notice = { tone: 'green' | 'red' | 'amber'; text: string };

const noticeClass: Record<Notice['tone'], string> = {
  green: 'bg-green-50 text-green-700',
  red: 'bg-red-50 text-red-600',
  amber: 'bg-amber-50 text-amber-700',
};

export default function PlatformVendors() {
  const { me } = useAuth();
  const isSuper = me?.role === 'super_admin';
  const queryClient = useQueryClient();

  const [target, setTarget] = useState<VendorCredential | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [formError, setFormError] = useState('');
  const [testResult, setTestResult] = useState<VendorTestResponse | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['platform-vendors'],
    queryFn: fetchPlatformVendors,
  });

  const rowTestMutation = useMutation({
    mutationFn: (v: VendorCredential) => testVendorCredential(v.vendor),
    onSuccess: (r, v) => {
      setNotice({
        tone: testTone(r.result),
        text: `${v.display_name || v.vendor}：${testLabel[r.result] ?? r.result}${r.message ? ` — ${r.message}` : ''}`,
      });
      void queryClient.invalidateQueries({ queryKey: ['platform-vendors'] });
    },
    onError: (err, v) => {
      setNotice({
        tone: 'red',
        text: `${v.display_name || v.vendor} 测试失败：${errText(err, '测试请求失败')}`,
      });
    },
  });

  const modalTestMutation = useMutation({
    mutationFn: () => {
      if (!target) {
        return Promise.reject(new Error('no target'));
      }
      return testVendorCredential(target.vendor, apiKey.trim());
    },
    onSuccess: (r) => {
      setTestResult(r);
      setFormError('');
    },
    onError: (err) => {
      setTestResult(null);
      setFormError(errText(err, '测试失败'));
    },
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!target) {
        return Promise.reject(new Error('no target'));
      }
      return saveVendorCredential(target.vendor, apiKey.trim());
    },
    onSuccess: (res) => {
      setConfirmOpen(false);
      setTarget(null);
      setApiKey('');
      setFormError('');
      setTestResult(null);
      setNotice({
        tone: 'green',
        text: `密钥已保存（${res.key_hint}），上游服务已重启并生效`,
      });
      void queryClient.invalidateQueries({ queryKey: ['platform-vendors'] });
    },
    onError: (err) => {
      // 失败时留在弹窗内展示后端 message（如 502 sync_failed），不静默关闭
      setConfirmOpen(false);
      setFormError(errText(err, '保存失败'));
    },
  });

  function openConfig(v: VendorCredential) {
    setTarget(v);
    setApiKey('');
    setFormError('');
    setTestResult(null);
  }

  function closeConfig() {
    setTarget(null);
    setApiKey('');
    setFormError('');
    setTestResult(null);
    setConfirmOpen(false);
  }

  const columns = isSuper ? 8 : 7;
  const rowTestPendingVendor = rowTestMutation.isPending
    ? rowTestMutation.variables?.vendor
    : undefined;

  return (
    <div>
      <PageHeader
        title="上游厂商"
        desc="密钥仅以 AES-256-GCM 密文存库，页面只显示掩码；保存后会重启 LiteLLM 上游代理，期间约 2-3 秒不可用。"
      />

      {notice ? (
        <div className={`mb-4 rounded-lg px-4 py-3 text-sm ${noticeClass[notice.tone]}`}>
          {notice.text}
        </div>
      ) : null}

      <Card>
        {error ? (
          <div className="p-6 text-sm text-red-600">{errText(error, '厂商列表加载失败')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="th">厂商</th>
                  <th className="th">环境变量</th>
                  <th className="th">状态</th>
                  <th className="th">当前密钥</th>
                  <th className="th">更新时间</th>
                  <th className="th">操作人</th>
                  <th className="th">上次测试</th>
                  {isSuper ? <th className="th text-right">操作</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {isLoading ? (
                  <tr>
                    <td className="td text-gray-400" colSpan={columns}>
                      加载中…
                    </td>
                  </tr>
                ) : data && data.items.length > 0 ? (
                  data.items.map((v) => (
                    <tr key={v.vendor}>
                      <td className="td">
                        <div className="font-medium text-gray-900">{v.display_name || v.vendor}</div>
                        <div className="mt-0.5 font-mono text-xs text-gray-400">{v.vendor}</div>
                        {v.base_url ? (
                          <div
                            className="mt-0.5 max-w-72 truncate text-xs text-gray-400"
                            title={v.base_url}
                          >
                            {v.base_url}
                          </div>
                        ) : null}
                      </td>
                      <td className="td whitespace-nowrap font-mono text-xs text-gray-600">
                        {v.env_var}
                      </td>
                      <td className="td">
                        <Badge tone={v.configured ? 'green' : 'gray'}>
                          {v.configured ? '已配置' : '未配置'}
                        </Badge>
                      </td>
                      <td className="td whitespace-nowrap font-mono text-xs text-gray-700">
                        {v.key_hint || '—'}
                      </td>
                      <td className="td whitespace-nowrap text-xs text-gray-500">
                        {fmtTime(v.updated_at)}
                      </td>
                      <td className="td text-gray-700">{v.updated_by || '—'}</td>
                      <td className="td">
                        {v.last_test_result ? (
                          <>
                            <span
                              title={`${v.last_test_message || testLabel[v.last_test_result]}（${fmtTime(v.last_test_at)}）`}
                            >
                              <Badge tone={testTone(v.last_test_result)}>
                                {testLabel[v.last_test_result] ?? v.last_test_result}
                              </Badge>
                            </span>
                            <div className="mt-0.5 whitespace-nowrap text-xs text-gray-400">
                              {fmtTime(v.last_test_at)}
                            </div>
                          </>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                      {isSuper ? (
                        <td className="td text-right">
                          <div className="flex justify-end gap-2">
                            <Button variant="secondary" onClick={() => openConfig(v)}>
                              配置密钥
                            </Button>
                            <Button
                              variant="secondary"
                              disabled={rowTestMutation.isPending}
                              onClick={() => rowTestMutation.mutate(v)}
                            >
                              {rowTestPendingVendor === v.vendor ? '测试中…' : '测试连接'}
                            </Button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={columns}>
                      <EmptyState text="暂无上游厂商" />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={!!target}
        title={`配置密钥 — ${target?.display_name ?? ''}`}
        onClose={closeConfig}
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!apiKey.trim()) {
              setFormError('请粘贴新的 API Key');
              return;
            }
            setFormError('');
            setConfirmOpen(true);
          }}
        >
          <div className="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-600 ring-1 ring-gray-200">
            <div>
              环境变量：<span className="font-mono text-xs text-gray-700">{target?.env_var}</span>
            </div>
            <div className="mt-1">
              当前密钥：<span className="font-mono text-xs text-gray-700">{target?.key_hint || '—'}</span>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">新 API Key</label>
            <Input
              type="password"
              autoComplete="new-password"
              className="w-full font-mono"
              placeholder="直接粘贴厂商控制台的新 Key"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setTestResult(null);
              }}
            />
            <p className="mt-1 text-xs text-gray-400">
              不回填旧值；保存后立即重写 LiteLLM 环境文件并重启上游服务。
            </p>
          </div>

          {testResult ? (
            <div className={`rounded-lg px-4 py-3 text-sm ${testBoxClass[testResult.result]}`}>
              {testLabel[testResult.result] ?? testResult.result}
              {testResult.message ? `：${testResult.message}` : ''}
              <span className="ml-2 text-xs opacity-70">（仅测试，未保存）</span>
            </div>
          ) : null}

          {formError ? <div className="text-sm text-red-600">{formError}</div> : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              type="button"
              variant="secondary"
              disabled={!apiKey.trim() || modalTestMutation.isPending}
              onClick={() => {
                setFormError('');
                modalTestMutation.mutate();
              }}
            >
              {modalTestMutation.isPending ? '测试中…' : '测试连接'}
            </Button>
            <div className="flex gap-3">
              <Button type="button" onClick={closeConfig}>
                取消
              </Button>
              <Button variant="primary" type="submit" disabled={saveMutation.isPending}>
                保存
              </Button>
            </div>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={confirmOpen}
        title="确认保存并重启上游服务？"
        description={
          target ? (
            <span>
              厂商：<b>{target.display_name || target.vendor}</b>（
              <span className="font-mono text-xs">{target.env_var}</span>）
              <br />
              保存后将重写 LiteLLM 环境文件并重启上游服务，
              <b>期间约 2-3 秒不可用</b>。
              <br />
              新密钥仅以 AES-256-GCM 密文存库，页面只显示掩码；该操作记录审计日志。
            </span>
          ) : null
        }
        confirmText="确认保存并重启"
        danger={false}
        loading={saveMutation.isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => saveMutation.mutate()}
      />
    </div>
  );
}
