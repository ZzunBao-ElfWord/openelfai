import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  errText,
  getReports,
  resolveReport,
  type ModerationAction,
  type ModerationReport,
  type ModerationReportFilter,
} from '../api/client';
import { Badge, Button, Card, EmptyState, PageHeader, Textarea } from '../components/ui/primitives';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import Pagination from '../components/ui/Pagination';

const PAGE_SIZE = 20;

const reasonLabel: Record<string, string> = {
  porn: '色情',
  violence: '暴力',
  minors: '未成年人',
  politics: '政治',
  illegal: '违法',
  harassment: '骚扰',
  fraud: '欺诈',
  privacy: '隐私',
  other: '其他',
};

const targetTypeLabel: Record<string, string> = {
  post: '动态',
  comment: '评论',
  elf: '精灵',
  user: '用户',
  chat: '聊天',
};

const stateLabel: Record<string, string> = {
  open: '待处理',
  resolved: '已处理',
  dismissed: '已忽略',
};

// 这些类型的下架不在举报页执行，需到对应页面处理
const unsupportedTargets = new Set(['elf', 'user', 'chat']);

function stateTone(state: string): 'amber' | 'green' | 'gray' {
  if (state === 'open') return 'amber';
  if (state === 'resolved') return 'green';
  return 'gray';
}

function fmtTime(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString('zh-CN', { hour12: false });
}

export default function ModerationReports() {
  const queryClient = useQueryClient();

  const [state, setState] = useState('open');
  const [targetType, setTargetType] = useState('');
  const [environment, setEnvironment] = useState('');
  const [submitted, setSubmitted] = useState<ModerationReportFilter>({ state: 'open' });
  const [page, setPage] = useState(1);

  const [pending, setPending] = useState<{
    report: ModerationReport;
    action: ModerationAction;
  } | null>(null);
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['moderation-reports', submitted, page],
    queryFn: () => getReports(submitted, page),
  });

  const mutation = useMutation({
    mutationFn: () => {
      if (!pending) {
        return Promise.reject(new Error('no target'));
      }
      return resolveReport(pending.report.id, {
        action: pending.action,
        note: note.trim() || undefined,
      });
    },
    onSuccess: () => {
      setPending(null);
      setNote('');
      setFormError('');
      void queryClient.invalidateQueries({ queryKey: ['moderation-reports'] });
    },
    onError: (err) => setFormError(errText(err, '处置失败')),
  });

  function openAction(report: ModerationReport, action: ModerationAction) {
    setPending({ report, action });
    setNote('');
    setFormError('');
  }

  function closeDialog() {
    setPending(null);
    setNote('');
    setFormError('');
  }

  return (
    <div>
      <PageHeader
        title="举报审核"
        desc="用户举报队列；忽略仅关闭举报，下架内容会软删动态/评论并同步关闭举报，所有处置记录审计日志"
      />

      <form
        className="mb-4 flex flex-wrap items-center gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setSubmitted({
            state: state || undefined,
            target_type: targetType || undefined,
            environment: environment || undefined,
          });
        }}
      >
        <select
          className="input max-w-36"
          value={state}
          onChange={(e) => {
            setState(e.target.value);
            setPage(1);
          }}
        >
          <option value="open">待处理</option>
          <option value="resolved">已处理</option>
          <option value="dismissed">已忽略</option>
          <option value="all">全部状态</option>
        </select>
        <select
          className="input max-w-36"
          value={targetType}
          onChange={(e) => {
            setTargetType(e.target.value);
            setPage(1);
          }}
        >
          <option value="">全部目标</option>
          <option value="post">动态</option>
          <option value="comment">评论</option>
          <option value="elf">精灵</option>
          <option value="user">用户</option>
          <option value="chat">聊天</option>
        </select>
        <select
          className="input max-w-36"
          value={environment}
          onChange={(e) => {
            setEnvironment(e.target.value);
            setPage(1);
          }}
        >
          <option value="">全部环境</option>
          <option value="Production">生产环境</option>
          <option value="Sandbox">沙箱环境</option>
        </select>
        <Button variant="primary" type="submit">
          筛选
        </Button>
        <Button
          variant="ghost"
          type="button"
          onClick={() => {
            setState('open');
            setTargetType('');
            setEnvironment('');
            setPage(1);
            setSubmitted({ state: 'open' });
          }}
        >
          重置
        </Button>
      </form>

      <Card>
        {error ? (
          <div className="p-6 text-sm text-red-600">{errText(error, '举报列表加载失败')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="th">举报 ID</th>
                  <th className="th">目标</th>
                  <th className="th">原因</th>
                  <th className="th">环境</th>
                  <th className="th">举报时间</th>
                  <th className="th">状态</th>
                  <th className="th">处理人</th>
                  <th className="th">备注</th>
                  <th className="th text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {isLoading ? (
                  <tr>
                    <td className="td text-gray-400" colSpan={9}>
                      加载中…
                    </td>
                  </tr>
                ) : data && data.items.length > 0 ? (
                  data.items.map((r) => {
                    const unsupported = unsupportedTargets.has(r.target_type);
                    return (
                      <tr key={r.id}>
                        <td className="td max-w-32 truncate font-mono text-xs text-gray-500" title={r.id}>
                          {r.id}
                        </td>
                        <td className="td">
                          <div className="text-gray-900">
                            {targetTypeLabel[r.target_type] ?? r.target_type}
                          </div>
                          <div
                            className="max-w-48 truncate font-mono text-xs text-gray-400"
                            title={r.target_id}
                          >
                            {r.target_id}
                          </div>
                        </td>
                        <td className="td">
                          <Badge tone="red">{reasonLabel[r.reason] ?? r.reason}</Badge>
                          {r.detail ? (
                            <div
                              className="mt-1 max-w-56 truncate text-xs text-gray-500"
                              title={r.detail}
                            >
                              {r.detail}
                            </div>
                          ) : null}
                        </td>
                        <td className="td">
                          <Badge tone={r.environment === 'Sandbox' ? 'amber' : 'blue'}>
                            {r.environment === 'Sandbox' ? '沙箱' : '生产'}
                          </Badge>
                        </td>
                        <td className="td whitespace-nowrap text-xs text-gray-500">
                          {fmtTime(r.created_at)}
                        </td>
                        <td className="td">
                          <Badge tone={stateTone(r.state)}>
                            {stateLabel[r.state] ?? r.state}
                          </Badge>
                        </td>
                        <td className="td whitespace-nowrap text-xs text-gray-500">
                          {r.resolved_by || '—'}
                          {r.resolved_at ? (
                            <div className="text-[11px] text-gray-400">{fmtTime(r.resolved_at)}</div>
                          ) : null}
                        </td>
                        <td className="td max-w-56 truncate text-xs text-gray-500" title={r.note ?? ''}>
                          {r.note || '—'}
                        </td>
                        <td className="td">
                          {r.state === 'open' ? (
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="secondary"
                                onClick={() => openAction(r, 'dismiss')}
                              >
                                忽略
                              </Button>
                              <Button
                                variant="danger"
                                disabled={unsupported}
                                title={
                                  unsupported
                                    ? '精灵/用户/聊天不支持在举报页下架，请前往对应页面处理'
                                    : undefined
                                }
                                onClick={() => openAction(r, 'remove_content')}
                              >
                                下架内容
                              </Button>
                            </div>
                          ) : (
                            <span className="block text-right text-xs text-gray-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={9}>
                      <EmptyState text="没有匹配的举报" />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {data ? (
        <Pagination page={page} total={data.total} pageSize={PAGE_SIZE} onChange={setPage} />
      ) : null}

      <ConfirmDialog
        open={!!pending}
        title={pending?.action === 'dismiss' ? '确认忽略该举报？' : '确认下架该内容？'}
        description={
          pending ? (
            <span>
              举报 ID：<b className="font-mono text-xs">{pending.report.id}</b>
              <br />
              目标：<b>{targetTypeLabel[pending.report.target_type] ?? pending.report.target_type}</b>
              （<span className="font-mono text-xs">{pending.report.target_id}</span>）
              <br />
              原因：{reasonLabel[pending.report.reason] ?? pending.report.reason}
              <br />
              {pending.action === 'dismiss'
                ? '忽略后该举报关闭，内容保持原样。'
                : '下架后内容将从线上移除（软删），该举报标记为已处理。'}
              该操作立即生效并记录审计日志。
            </span>
          ) : null
        }
        confirmText={pending?.action === 'dismiss' ? '确认忽略' : '确认下架'}
        danger={pending?.action === 'remove_content'}
        loading={mutation.isPending}
        onCancel={closeDialog}
        onConfirm={() => mutation.mutate()}
      >
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            处置备注（可选，最多 500 字）
          </label>
          <Textarea
            className="w-full"
            maxLength={500}
            placeholder="填写处置依据或补充说明"
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              setFormError('');
            }}
          />
          <div className="mt-1 text-right text-xs text-gray-400">{note.length}/500</div>
          {formError ? <div className="mt-1 text-sm text-red-600">{formError}</div> : null}
        </div>
      </ConfirmDialog>
    </div>
  );
}
