import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  errText,
  fetchAppConfigs,
  updateAppConfig,
  updateAppConfigSwitch,
  type AppConfigRow,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Badge, Button, Card, Input, PageHeader, Textarea } from '../components/ui/primitives';

const groupMeta: Record<string, { title: string; desc: string }> = {
  about: { title: '关于 OpenElf', desc: '设置页「关于 OpenElf」弹窗展示的名称、版本号、标语与简介' },
  brand: { title: '品牌文案', desc: '登录页、首页、分享卡片统一使用的标语' },
  feedback: { title: '反馈入口', desc: '设置页「举报与反馈」的渠道与说明' },
  report: { title: '举报', desc: '站内内容举报的原因列表与入口开关' },
  wallet: { title: '钱包', desc: '钱包页底部的规则说明' },
  identity: { title: '实名认证', desc: '设置页与实名认证页的说明文案' },
  create: { title: '创建 AI', desc: '创建流程必须勾选的合规声明' },
  theme: { title: '外观', desc: '新用户默认主题；不影响用户已手动选择的主题' },
};

const groupOrder = ['about', 'brand', 'feedback', 'report', 'wallet', 'identity', 'create', 'theme'];

type Notice = { tone: 'green' | 'red'; text: string };

export default function AppCopyConfig() {
  const { me } = useAuth();
  const isSuper = me?.role === 'super_admin';
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState<Record<string, string>>({});
  const [localError, setLocalError] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['app-configs'],
    queryFn: fetchAppConfigs,
  });

  // 只补齐尚未载入草稿的 key，避免保存某一项后把其他未保存的编辑覆盖掉
  useEffect(() => {
    if (!data) return;
    setDraft((prev) => {
      const next = { ...prev };
      for (const row of data.items) {
        if (!(row.key in next)) next[row.key] = row.value;
      }
      return next;
    });
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async ({ row, value }: { row: AppConfigRow; value: string }) => {
      if (row.value_type === 'json') {
        try {
          const parsed = JSON.parse(value);
          if (!Array.isArray(parsed) || parsed.length === 0) {
            throw new Error('必须是至少包含一项的 JSON 数组');
          }
        } catch (err) {
          throw new Error(`JSON 格式不正确：${(err as Error).message}`);
        }
      }
      if (row.value_type === 'bool') {
        return updateAppConfigSwitch(row.key, value === 'true');
      }
      return updateAppConfig(row.key, value);
    },
    onSuccess: (_, { row }) => {
      setLocalError((prev) => ({ ...prev, [row.key]: '' }));
      setNotice({ tone: 'green', text: `已保存：${row.label}（App 60 秒内生效）` });
      setPendingKey(null);
      // 丢弃该 key 的草稿，下次以服务端值重新载入
      setDraft((prev) => {
        const next = { ...prev };
        delete next[row.key];
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: ['app-configs'] });
    },
    onError: (err, { row }) => {
      setLocalError((prev) => ({ ...prev, [row.key]: errText(err, '保存失败') }));
      setNotice(null);
      setPendingKey(null);
    },
  });

  function setValue(key: string, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setLocalError((prev) => ({ ...prev, [key]: '' }));
  }

  function dirty(row: AppConfigRow): boolean {
    return (draft[row.key] ?? row.value) !== row.value;
  }

  const items = data?.items ?? [];
  const grouped = new Map<string, AppConfigRow[]>();
  for (const row of items) {
    if (!grouped.has(row.group)) grouped.set(row.group, []);
    grouped.get(row.group)!.push(row);
  }
  const groups = [
    ...groupOrder.filter((g) => grouped.has(g)),
    ...[...grouped.keys()].filter((g) => !groupOrder.includes(g)),
  ];

  return (
    <div>
      <PageHeader
        title="应用文案与开关"
        desc="App 端展示文案与功能开关，保存后 60 秒内生效；App 仅在字段缺失时使用内置兜底文案"
      />

      {notice ? (
        <div
          className={`mb-4 rounded-lg px-4 py-3 text-sm ${
            notice.tone === 'green' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
          }`}
        >
          {notice.text}
        </div>
      ) : null}

      {error ? (
        <Card>
          <div className="p-6 text-sm text-red-600">{errText(error, '配置加载失败')}</div>
        </Card>
      ) : isLoading ? (
        <Card>
          <div className="p-6 text-sm text-gray-400">加载中…</div>
        </Card>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => {
            const meta = groupMeta[group] ?? { title: group, desc: '' };
            return (
              <Card key={group} className="overflow-hidden">
                <div className="border-b border-gray-100 px-5 py-4">
                  <h2 className="text-sm font-semibold text-gray-900">{meta.title}</h2>
                  {meta.desc ? <p className="mt-1 text-xs text-gray-500">{meta.desc}</p> : null}
                </div>
                <div className="divide-y divide-gray-100">
                  {(grouped.get(group) ?? []).map((row) => {
                    const value = draft[row.key] ?? row.value;
                    const isSwitch = row.value_type === 'bool';
                    const switchOn = value === 'true';
                    const canEdit = !isSwitch || isSuper;
                    return (
                      <div key={row.key} className="px-5 py-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-gray-900">{row.label}</span>
                              <span className="font-mono text-[11px] text-gray-400">{row.key}</span>
                              {dirty(row) ? <Badge tone="amber">未保存</Badge> : null}
                            </div>
                            {row.remark ? (
                              <p className="mt-1 text-xs text-gray-500">{row.remark}</p>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-2">
                            {isSwitch ? (
                              <>
                                <Badge tone={switchOn ? 'green' : 'gray'}>
                                  {switchOn ? '已开启' : '已关闭'}
                                </Badge>
                                {isSuper ? (
                                  <Button
                                    variant={switchOn ? 'danger' : 'secondary'}
                                    disabled={saveMutation.isPending && pendingKey === row.key}
                                    onClick={() => {
                                      const next = switchOn ? 'false' : 'true';
                                      setValue(row.key, next);
                                      setPendingKey(row.key);
                                      saveMutation.mutate({ row, value: next });
                                    }}
                                  >
                                    {switchOn ? '关闭' : '开启'}
                                  </Button>
                                ) : (
                                  <span className="text-xs text-gray-400">仅超管可改</span>
                                )}
                              </>
                            ) : (
                              <Button
                                variant="primary"
                                disabled={
                                  !dirty(row) ||
                                  (saveMutation.isPending && pendingKey === row.key)
                                }
                                onClick={() => {
                                  const value = draft[row.key] ?? row.value;
                                  setPendingKey(row.key);
                                  saveMutation.mutate({ row, value });
                                }}
                              >
                                {saveMutation.isPending && pendingKey === row.key ? '保存中…' : '保存'}
                              </Button>
                            )}
                          </div>
                        </div>

                        {row.value_type === 'json' ? (
                          <Textarea
                            className="mt-3 w-full font-mono text-xs"
                            rows={Math.min(8, Math.max(3, value.split('\n').length + 1))}
                            value={value}
                            onChange={(e) => setValue(row.key, e.target.value)}
                          />
                        ) : row.value_type === 'text' ? (
                          <Textarea
                            className="mt-3 w-full"
                            rows={Math.min(6, Math.max(2, Math.ceil(value.length / 60) + 1))}
                            value={value}
                            onChange={(e) => setValue(row.key, e.target.value)}
                          />
                        ) : row.value_type === 'number' ? (
                          <Input
                            className="mt-3 w-40"
                            value={value}
                            onChange={(e) => setValue(row.key, e.target.value)}
                          />
                        ) : null}

                        {row.value_type === 'json' ? (
                          <div className="mt-1 text-xs text-gray-400">
                            JSON 字符串数组，按顺序展示，最多 6 条建议。
                          </div>
                        ) : null}
                        {localError[row.key] ? (
                          <div className="mt-1 text-xs text-red-600">{localError[row.key]}</div>
                        ) : null}
                        {!canEdit ? null : (
                          <div className="mt-1 text-[11px] text-gray-400">
                            最后修改：{row.updated_by || '—'} ·{' '}
                            {row.updated_at
                              ? new Date(row.updated_at).toLocaleString('zh-CN', { hour12: false })
                              : '—'}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
