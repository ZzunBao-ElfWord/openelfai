import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errText, fetchElfDetail, setElfState } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useEnv } from '../env/EnvContext';
import { Badge, Button, Card, Input, PageHeader } from '../components/ui/primitives';
import ConfirmDialog from '../components/ui/ConfirmDialog';

export default function ElfDetail() {
  const { id } = useParams<{ id: string }>();
  const { env } = useEnv();
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const [targetState, setTargetState] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['elf-detail', id, env],
    queryFn: () => fetchElfDetail(id as string, env),
    enabled: !!id,
  });

  const mutation = useMutation({
    mutationFn: () => setElfState(id as string, env, targetState.trim()),
    onSuccess: () => {
      setConfirmOpen(false);
      setTargetState('');
      void queryClient.invalidateQueries({ queryKey: ['elf-detail', id, env] });
    },
  });

  if (isLoading) {
    return <div className="py-12 text-center text-sm text-gray-400">加载中…</div>;
  }
  if (error || !data) {
    return (
      <div>
        <PageHeader title="AI 精灵详情" />
        <Card className="p-6 text-sm text-red-600">{errText(error, '精灵详情加载失败')}</Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link to="/elves" className="text-sm text-blue-600 hover:underline">
          ← 返回精灵列表
        </Link>
      </div>
      <PageHeader title="AI 精灵详情" desc="完整 payload 与属主信息；状态修正仅超级管理员可用" />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="mb-4 text-sm font-semibold text-gray-900">基本信息</h2>
          <div className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-2 text-sm">
            <span className="text-gray-400">Object ID</span>
            <span className="break-all font-mono text-xs text-gray-600">{data.object_id}</span>
            <span className="text-gray-400">状态</span>
            <span>
              <Badge tone="gray">{data.state}</Badge>
            </span>
            <span className="text-gray-400">更新时间</span>
            <span className="text-gray-700">
              {data.updated_at
                ? new Date(data.updated_at).toLocaleString('zh-CN', { hour12: false })
                : '—'}
            </span>
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="mb-4 text-sm font-semibold text-gray-900">属主</h2>
          {data.owner ? (
            <div className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-2 text-sm">
              <span className="text-gray-400">昵称</span>
              <span className="font-medium text-gray-900">{data.owner.nickname || '(未命名)'}</span>
              <span className="text-gray-400">手机号</span>
              <span className="text-gray-700">{data.owner.phone || '—'}</span>
              <span className="text-gray-400">用户 ID</span>
              <span className="break-all font-mono text-xs text-gray-600">
                {data.owner.id}
                <Link
                  to={`/users/${data.owner.id}`}
                  className="ml-2 text-blue-600 hover:underline"
                >
                  查看用户
                </Link>
              </span>
            </div>
          ) : (
            <div className="text-sm text-gray-400">属主信息缺失</div>
          )}
        </Card>
      </div>

      <Card className="p-6">
        <h2 className="mb-4 text-sm font-semibold text-gray-900">Payload（完整 JSON）</h2>
        <pre className="max-h-[32rem] overflow-auto rounded-lg bg-gray-900 p-4 text-xs leading-5 text-gray-100">
          {JSON.stringify(data.payload, null, 2)}
        </pre>
      </Card>

      {me?.role === 'super_admin' ? (
        <Card className="p-6">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">状态修正</h2>
          <p className="mb-4 text-xs text-gray-400">
            高危操作：直接覆写精灵状态机状态，立即生效并记录审计日志。当前环境：
            {env === 'Production' ? '生产环境' : '沙箱环境'}。
          </p>
          <form
            className="flex gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!targetState.trim()) return;
              setConfirmOpen(true);
            }}
          >
            <Input
              className="max-w-56"
              placeholder={`目标状态，当前为 ${data.state}`}
              value={targetState}
              onChange={(e) => setTargetState(e.target.value)}
              required
            />
            <Button variant="danger" type="submit">
              修正状态
            </Button>
          </form>
          {mutation.error ? (
            <div className="mt-3 text-sm text-red-600">{errText(mutation.error, '状态修正失败')}</div>
          ) : null}
        </Card>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        title="确认修正该精灵的状态？"
        description={
          <span>
            精灵：<b className="font-mono text-xs">{id}</b>
            <br />
            环境：{env === 'Production' ? '生产环境' : '沙箱环境'}
            <br />
            状态：<b>{data.state}</b> → <b className="text-red-600">{targetState.trim()}</b>
            <br />
            该操作立即生效并记录审计日志。
          </span>
        }
        confirmText="确认修正"
        loading={mutation.isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => mutation.mutate()}
      />
    </div>
  );
}
