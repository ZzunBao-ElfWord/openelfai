import { useQuery } from '@tanstack/react-query';
import { errText, fetchSystemHealth } from '../api/client';
import { Badge, Button, Card, PageHeader } from '../components/ui/primitives';

// 系统健康：MySQL 与 Node API 探测结果，30 秒自动刷新
export default function System() {
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ['system-health'],
    queryFn: fetchSystemHealth,
    refetchInterval: 30000,
  });

  const items = data
    ? [
        {
          name: 'MySQL',
          ok: data.mysql.ok,
          latency_ms: data.mysql.latency_ms,
          extra: '',
        },
        {
          name: 'Node API',
          ok: data.node_api.ok,
          latency_ms: data.node_api.latency_ms,
          extra: `HTTP ${data.node_api.status_code}`,
        },
      ]
    : [];

  const okCount = items.filter((i) => i.ok).length;

  return (
    <div>
      <PageHeader title="系统健康" desc="MySQL 与 Node API 连通性探测，30 秒自动刷新" />

      <div className="mb-4 flex items-center justify-between text-sm text-gray-500">
        <span>
          {data ? (
            <>
              共 {items.length} 项检查，
              {okCount === items.length ? (
                <span className="text-green-600">全部正常</span>
              ) : (
                <span className="text-red-600">{items.length - okCount} 项异常</span>
              )}
              {' · 最近检查 '}
              {new Date(dataUpdatedAt).toLocaleTimeString('zh-CN', { hour12: false })}
            </>
          ) : (
            '检查中…'
          )}
        </span>
        <Button variant="secondary" disabled={isFetching} onClick={() => void refetch()}>
          {isFetching ? '刷新中…' : '立即刷新'}
        </Button>
      </div>

      {error ? (
        <Card className="p-6 text-sm text-red-600">{errText(error, '健康检查失败')}</Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((s) => (
            <Card key={s.name} className="p-5">
              <div className="flex items-center justify-between">
                <div className="font-medium text-gray-900">{s.name}</div>
                {s.ok ? <Badge tone="green">正常</Badge> : <Badge tone="red">异常</Badge>}
              </div>
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="text-gray-500">延迟 {s.latency_ms} ms</span>
                {s.extra ? <span className="font-mono text-gray-400">{s.extra}</span> : null}
              </div>
            </Card>
          ))}
          {isLoading ? <Card className="p-5 text-sm text-gray-400">正在探测…</Card> : null}
        </div>
      )}
    </div>
  );
}
