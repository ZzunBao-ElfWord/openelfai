import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errText, fetchUsers, setUserStatus, type UserRow } from '../api/client';
import { Badge, Button, Card, EmptyState, Input, PageHeader } from '../components/ui/primitives';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import Pagination from '../components/ui/Pagination';

const PAGE_SIZE = 20;

export default function Users() {
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const [submittedQ, setSubmittedQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState<{ user: UserRow; next: 'active' | 'banned' } | null>(null);

  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['users', submittedQ, status, page],
    queryFn: () => fetchUsers(submittedQ, status, page),
  });

  const mutation = useMutation({
    mutationFn: () => {
      if (!pending) {
        return Promise.reject(new Error('no target'));
      }
      return setUserStatus(pending.user.id, pending.next);
    },
    onSuccess: () => {
      setPending(null);
      void queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  return (
    <div>
      <PageHeader title="用户管理" desc="封禁会写入 users.status，所有操作记录审计日志" />

      <form
        className="mb-4 flex flex-wrap gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setSubmittedQ(keyword.trim());
        }}
      >
        <Input
          className="max-w-xs"
          placeholder="手机号 / 昵称 / 用户 ID"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <select
          className="input max-w-32"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">全部状态</option>
          <option value="active">正常</option>
          <option value="banned">已封禁</option>
        </select>
        <Button variant="primary" type="submit">
          搜索
        </Button>
      </form>

      <Card>
        {error ? (
          <div className="p-6 text-sm text-red-600">{errText(error, '用户列表加载失败')}</div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="th">用户</th>
                <th className="th">手机号</th>
                <th className="th">状态</th>
                <th className="th text-right">钻石</th>
                <th className="th">注册时间</th>
                <th className="th">最后登录</th>
                <th className="th text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr>
                  <td className="td text-gray-400" colSpan={7}>
                    加载中…
                  </td>
                </tr>
              ) : data && data.items.length > 0 ? (
                data.items.map((u) => (
                  <tr key={u.id}>
                    <td className="td">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-medium text-blue-700">
                          {u.avatar_initial || u.nickname?.slice(0, 1) || '?'}
                        </span>
                        <div>
                          <div className="font-medium text-gray-900">{u.nickname || '(未命名)'}</div>
                          <div className="font-mono text-xs text-gray-400" title={u.id}>
                            {u.id.slice(0, 12)}…
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="td text-gray-600">{u.phone || '—'}</td>
                    <td className="td">
                      {u.status === 'banned' ? (
                        <Badge tone="red">已封禁</Badge>
                      ) : (
                        <Badge tone="green">正常</Badge>
                      )}
                    </td>
                    <td className="td text-right tabular-nums text-gray-900">{u.diamonds}</td>
                    <td className="td whitespace-nowrap text-xs text-gray-500">
                      {u.created_at
                        ? new Date(u.created_at).toLocaleString('zh-CN', { hour12: false })
                        : '—'}
                    </td>
                    <td className="td whitespace-nowrap text-xs text-gray-500">
                      {u.last_login_at
                        ? new Date(u.last_login_at).toLocaleString('zh-CN', { hour12: false })
                        : '—'}
                    </td>
                    <td className="td">
                      <div className="flex justify-end gap-2">
                        <Button variant="secondary" onClick={() => navigate(`/users/${u.id}`)}>
                          详情
                        </Button>
                        {u.status === 'banned' ? (
                          <Button
                            variant="secondary"
                            onClick={() => setPending({ user: u, next: 'active' })}
                          >
                            解封
                          </Button>
                        ) : (
                          <Button
                            variant="danger"
                            onClick={() => setPending({ user: u, next: 'banned' })}
                          >
                            封禁
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7}>
                    <EmptyState text="没有匹配的用户" />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </Card>

      {data ? (
        <Pagination page={page} total={data.total} pageSize={PAGE_SIZE} onChange={setPage} />
      ) : null}

      <ConfirmDialog
        open={!!pending}
        title={pending?.next === 'banned' ? '确认封禁该用户？' : '确认解封该用户？'}
        description={
          pending ? (
            <span>
              用户：<b>{pending.user.nickname || pending.user.id}</b>
              {pending.user.phone ? <span className="text-gray-400">（{pending.user.phone}）</span> : null}
              <br />
              {pending.next === 'banned'
                ? '封禁后该账号无法正常使用 App，历史数据保留，可随时解封。该操作立即生效并记录审计日志。'
                : '解封后该账号恢复正常使用。该操作记录审计日志。'}
            </span>
          ) : null
        }
        confirmText={pending?.next === 'banned' ? '确认封禁' : '确认解封'}
        danger={pending?.next === 'banned'}
        loading={mutation.isPending}
        onCancel={() => setPending(null)}
        onConfirm={() => mutation.mutate()}
      />
      {mutation.error ? (
        <div className="mt-3 text-sm text-red-600">{errText(mutation.error)}</div>
      ) : null}
    </div>
  );
}
