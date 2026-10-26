import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createAdminUser,
  deleteAdminUser,
  errText,
  fetchAdminUsers,
  resetAdminPassword,
  type AdminAccount,
  type Role,
} from '../api/client';
import { Badge, Button, Card, Input, Modal, PageHeader } from '../components/ui/primitives';
import ConfirmDialog from '../components/ui/ConfirmDialog';

const roleLabel: Record<Role, string> = {
  super_admin: '超级管理员',
  moderator: '审核员',
  operator: '运营',
};

export default function AdminAccounts() {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('moderator');
  const [error, setError] = useState('');
  // 重置密码弹层状态
  const [resetTarget, setResetTarget] = useState<AdminAccount | null>(null);
  const [newPwd, setNewPwd] = useState('');
  const [resetError, setResetError] = useState('');
  // 删除确认
  const [pendingDelete, setPendingDelete] = useState<AdminAccount | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: fetchAdminUsers,
  });

  const mutation = useMutation({
    mutationFn: () => createAdminUser({ username: username.trim(), password, role }),
    onSuccess: () => {
      setUsername('');
      setPassword('');
      setError('');
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (err) => setError(errText(err, '创建失败')),
  });

  const resetMutation = useMutation({
    mutationFn: () => {
      if (!resetTarget) return Promise.reject(new Error('no target'));
      return resetAdminPassword(resetTarget.id, newPwd);
    },
    onSuccess: () => {
      setResetTarget(null);
      setNewPwd('');
      setResetError('');
    },
    onError: (err) => setResetError(errText(err, '重置失败')),
  });

  const delMutation = useMutation({
    mutationFn: () => {
      if (!pendingDelete) return Promise.reject(new Error('no target'));
      return deleteAdminUser(pendingDelete.id);
    },
    onSuccess: () => {
      setPendingDelete(null);
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (err) => setError(errText(err, '删除失败')),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 10) {
      setError('密码至少 10 位');
      return;
    }
    mutation.mutate();
  }

  return (
    <div className="space-y-6">
      <PageHeader title="后台账号" desc="仅超级管理员可见；账号变更同样写入审计日志" />

      <Card>
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="th">用户名</th>
              <th className="th">角色</th>
              <th className="th">创建时间(UTC)</th>
              <th className="th text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              <tr>
                <td className="td text-gray-400" colSpan={4}>
                  加载中…
                </td>
              </tr>
            ) : (
              data?.items.map((u) => (
                <tr key={u.id}>
                  <td className="td font-medium text-gray-900">{u.username}</td>
                  <td className="td">
                    <Badge tone={u.role === 'super_admin' ? 'blue' : 'gray'}>
                      {roleLabel[u.role]}
                    </Badge>
                  </td>
                  <td className="td text-xs text-gray-500">
                    {new Date(u.created_at).toLocaleString('zh-CN', { hour12: false })}
                  </td>
                  <td className="td text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="secondary" onClick={() => { setResetTarget(u); setNewPwd(''); setResetError(''); }}>
                        重置密码
                      </Button>
                      <Button variant="danger" onClick={() => setPendingDelete(u)}>
                        删除
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      <Modal open={!!resetTarget} title={`重置密码 — ${resetTarget?.username ?? ''}`} onClose={() => setResetTarget(null)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (newPwd.length < 10) {
              setResetError('密码至少 10 位');
              return;
            }
            resetMutation.mutate();
          }}
        >
          <label className="mb-1.5 block text-sm font-medium text-gray-700">新密码（至少 10 位）</label>
          <Input
            type="text"
            className="w-full"
            value={newPwd}
            onChange={(e) => setNewPwd(e.target.value)}
            placeholder="输入新密码"
            required
          />
          <p className="mt-2 text-xs text-gray-400">
            重置后请通知对方使用新密码重新登录；已登录的会话仍有效，直至令牌过期。
          </p>
          {resetError ? <div className="mt-2 text-sm text-red-600">{resetError}</div> : null}
          <div className="mt-4 flex justify-end gap-3">
            <Button type="button" onClick={() => setResetTarget(null)}>
              取消
            </Button>
            <Button variant="primary" type="submit" disabled={resetMutation.isPending}>
              {resetMutation.isPending ? '提交中…' : '确认重置'}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!pendingDelete}
        title="确认删除该后台账号？"
        description={
          pendingDelete ? (
            <span>
              账号：<b>{pendingDelete.username}</b>（{roleLabel[pendingDelete.role]}）
              <br />
              删除后该账号立即无法登录，且不能删除当前登录账号或最后一个超级管理员。此操作记录审计日志。
            </span>
          ) : null
        }
        confirmText="确认删除"
        loading={delMutation.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => delMutation.mutate()}
      />

      <Card className="p-6">
        <h2 className="mb-4 text-sm font-semibold text-gray-900">新建后台账号</h2>
        <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">用户名</label>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} required />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">初始密码</label>
            <Input
              type="text"
              className="w-56"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 10 位"
              required
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">角色</label>
            <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="moderator">审核员</option>
              <option value="operator">运营</option>
              <option value="super_admin">超级管理员</option>
            </select>
          </div>
          <Button variant="primary" type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? '创建中…' : '创建账号'}
          </Button>
        </form>
        {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}
      </Card>
    </div>
  );
}
