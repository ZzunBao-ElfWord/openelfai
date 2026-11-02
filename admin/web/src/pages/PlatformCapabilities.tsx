import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  errText,
  fetchPlatformCapabilities,
  reviewPlatformCapability,
  type PlatformCapability,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  PageHeader,
  Textarea,
} from '../components/ui/primitives';
import Pagination from '../components/ui/Pagination';

const PAGE_SIZE = 20;

function fmtTime(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'number' ? v : Number(v);
  const d = new Date(Number.isFinite(n) ? n : v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('zh-CN', { hour12: false });
}

const kindLabel: Record<string, string> = {
  skill: '技能',
  expert: '专家',
  connector: '连接器',
};

const trackLabel: Record<string, string> = {
  writing: '写作',
  visual: '视觉',
  video: '视频',
  voice: '语音',
  knowledge: '知识',
  social: '社交',
};

const statusTone = (status: string): 'green' | 'red' | 'amber' | 'blue' | 'gray' =>
  status === 'approved' ? 'green' : status === 'rejected' ? 'red'
    : status === 'submitted' ? 'amber' : status === 'offline' ? 'gray' : 'blue';

const statusLabel: Record<string, string> = {
  draft: '草稿',
  submitted: '待审核',
  approved: '已上架',
  rejected: '已拒绝',
  offline: '已下架',
};

export default function PlatformCapabilities() {
  const { me } = useAuth();
  const isSuper = me?.role === 'super_admin';
  const queryClient = useQueryClient();

  const [status, setStatus] = useState('submitted');
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState<PlatformCapability | null>(null);
  const [action, setAction] = useState<'approve' | 'reject'>('approve');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');

  const listQuery = useQuery({
    queryKey: ['platform-capabilities', status, kind, page],
    queryFn: () => fetchPlatformCapabilities({ status, kind }, page),
  });

  const reviewMutation = useMutation({
    mutationFn: () => {
      if (!target) return Promise.reject(new Error('no target'));
      return reviewPlatformCapability(target.id, { action, note: note.trim() });
    },
    onSuccess: () => {
      setNotice(action === 'approve' ? '能力已通过审核并上架' : '能力已退回开发者修改');
      setTarget(null);
      setNote('');
      setFormError('');
      void queryClient.invalidateQueries({ queryKey: ['platform-capabilities'] });
    },
    onError: (err) => setFormError(errText(err, '审核失败')),
  });

  function openReview(item: PlatformCapability, next: 'approve' | 'reject') {
    setTarget(item);
    setAction(next);
    setNote('');
    setFormError('');
    setNotice('');
  }

  return (
    <div>
      <PageHeader
        title="能力审核"
        desc="开发者提交的技能 / 专家 / 连接器在此审核；通过即上架进入市场与学习入口，拒绝需填写退回说明"
      />

      {notice ? (
        <div className="mb-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">{notice}</div>
      ) : null}

      <form className="mb-4 flex flex-wrap gap-3" onSubmit={(e) => e.preventDefault()}>
        <select
          className="input max-w-40"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">全部状态</option>
          <option value="submitted">待审核</option>
          <option value="approved">已上架</option>
          <option value="rejected">已拒绝</option>
          <option value="draft">草稿</option>
          <option value="offline">已下架</option>
        </select>
        <select
          className="input max-w-40"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setPage(1);
          }}
        >
          <option value="">全部类型</option>
          <option value="skill">技能</option>
          <option value="expert">专家</option>
          <option value="connector">连接器</option>
        </select>
      </form>

      <Card>
        {listQuery.error ? (
          <div className="p-6 text-sm text-red-600">{errText(listQuery.error, '能力列表加载失败')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="th">能力</th>
                  <th className="th">开发者</th>
                  <th className="th">类型</th>
                  <th className="th">赛道</th>
                  <th className="th text-right">定价（钻石）</th>
                  <th className="th">状态</th>
                  <th className="th text-right">安装 / 售出</th>
                  <th className="th">更新时间</th>
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
                ) : listQuery.data && listQuery.data.items.length > 0 ? (
                  listQuery.data.items.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="td">
                        <div className="font-medium text-gray-900">{item.name}</div>
                        <div className="mt-0.5 max-w-80 truncate text-xs text-gray-500" title={item.summary}>
                          {item.summary}
                        </div>
                      </td>
                      <td className="td text-gray-700">{item.developer_name || '—'}</td>
                      <td className="td">
                        <Badge tone="blue">{kindLabel[item.kind] ?? item.kind}</Badge>
                      </td>
                      <td className="td text-gray-600">{trackLabel[item.track] ?? item.track}</td>
                      <td className="td text-right tabular-nums text-gray-900">{item.price_diamonds}</td>
                      <td className="td">
                        <Badge tone={statusTone(item.status)}>
                          {statusLabel[item.status] ?? item.status}
                        </Badge>
                        {item.review_note ? (
                          <div className="mt-1 max-w-56 truncate text-xs text-red-500" title={item.review_note}>
                            {item.review_note}
                          </div>
                        ) : null}
                      </td>
                      <td className="td text-right tabular-nums text-gray-700">
                        {item.install_count} / {item.sales_count}
                      </td>
                      <td className="td whitespace-nowrap text-xs text-gray-500">
                        {fmtTime(item.updated_at)}
                      </td>
                      <td className="td text-right">
                        {isSuper && item.status !== 'approved' ? (
                          <div className="flex justify-end gap-2">
                            <Button variant="primary" onClick={() => openReview(item, 'approve')}>
                              通过
                            </Button>
                            <Button variant="danger" onClick={() => openReview(item, 'reject')}>
                              拒绝
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={9}>
                      <EmptyState text="没有匹配的能力" />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {listQuery.data ? (
        <Pagination page={page} total={listQuery.data.total} pageSize={PAGE_SIZE} onChange={setPage} />
      ) : null}

      <Modal
        open={!!target}
        title={`${action === 'approve' ? '通过并上架' : '拒绝'} — ${target?.name ?? ''}`}
        onClose={() => setTarget(null)}
      >
        <div className="space-y-4">
          <div className="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-600">
            <div>
              类型：<b>{kindLabel[target?.kind ?? ''] ?? target?.kind}</b>；赛道：
              <b>{trackLabel[target?.track ?? ''] ?? target?.track}</b>；定价：
              <b>{target?.price_diamonds}</b> 钻石
            </div>
            <div className="mt-1">{target?.summary}</div>
          </div>
          {action === 'approve' ? (
            <div className="text-sm text-gray-600">
              通过后该能力立刻出现在 App 市场与学习入口，按 70% 分成结算给开发者。
            </div>
          ) : (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">退回原因</label>
              <Textarea
                className="w-full"
                placeholder="如：技能调试样例不足，请补充后再提交"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          )}
          {formError ? <div className="text-sm text-red-600">{formError}</div> : null}
          <div className="flex justify-end gap-3">
            <Button type="button" onClick={() => setTarget(null)}>
              取消
            </Button>
            <Button
              variant={action === 'reject' ? 'danger' : 'primary'}
              disabled={reviewMutation.isPending || (action === 'reject' && !note.trim())}
              onClick={() => reviewMutation.mutate()}
            >
              {action === 'reject' ? '确认拒绝' : '确认通过'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
