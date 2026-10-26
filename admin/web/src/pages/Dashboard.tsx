import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchStats, errText, type DailyPoint } from '../api/client';
import { useEnv } from '../env/EnvContext';
import { Card, PageHeader } from '../components/ui/primitives';

const numberFmt = new Intl.NumberFormat('zh-CN');

// 10 钻石 = 1 元
function yuan(diamonds: number): string {
  return `≈ ¥${(diamonds / 10).toFixed(2)}`;
}

export default function Dashboard() {
  const { env } = useEnv();
  const { data, isLoading, error } = useQuery({
    queryKey: ['stats-overview', env],
    queryFn: () => fetchStats(env),
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return <PageSkeleton />;
  }
  if (error || !data) {
    return (
      <div>
        <PageHeader title="数据看板" />
        <Card className="p-6 text-sm text-red-600">{errText(error, '统计数据加载失败')}</Card>
      </div>
    );
  }

  const cards: { label: string; value: number; money?: boolean; warn?: boolean }[] = [
    { label: '用户总数', value: data.users_total },
    { label: '今日新增用户', value: data.users_new_today },
    { label: '近 7 日新增用户', value: data.users_new_7d },
    { label: '今日活跃用户', value: data.active_today },
    { label: 'AI 精灵总数', value: data.elves_total },
    { label: '待处理异常单', value: data.pending_reviews, warn: data.pending_reviews > 0 },
    { label: '今日充值（钻石）', value: data.recharge_today, money: true },
    { label: '近 7 日充值（钻石）', value: data.recharge_7d, money: true },
    { label: '近 7 日打赏（钻石）', value: data.tip_7d, money: true },
  ];

  return (
    <div>
      <PageHeader title="数据看板" desc="数据每分钟自动刷新；金额单位为钻石（10 钻石 = 1 元）" />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.label} className="p-5">
            <div className="text-sm text-gray-500">{c.label}</div>
            <div
              className={`mt-2 text-2xl font-semibold ${
                c.warn ? 'text-red-600' : 'text-gray-900'
              }`}
            >
              {numberFmt.format(c.value)}
            </div>
            {c.money ? <div className="mt-1 text-xs text-gray-400">{yuan(c.value)}</div> : null}
          </Card>
        ))}
      </div>

      <Card className="mt-6 p-6">
        <DailyChart data={data.daily7} />
      </Card>
    </div>
  );
}

type Metric = 'new_users' | 'recharge' | 'tip';

const metricMeta: { key: Metric; label: string; bar: string }[] = [
  { key: 'new_users', label: '新增用户', bar: 'bg-blue-500' },
  { key: 'recharge', label: '充值（钻石）', bar: 'bg-emerald-500' },
  { key: 'tip', label: '打赏（钻石）', bar: 'bg-amber-500' },
];

// 近 7 日趋势：纯 CSS 柱状图，不引图表库
function DailyChart({ data }: { data: DailyPoint[] }) {
  const [metric, setMetric] = useState<Metric>('new_users');
  const meta = metricMeta.find((m) => m.key === metric) ?? metricMeta[0];
  const max = Math.max(1, ...data.map((d) => d[metric]));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">近 7 日趋势</h2>
        <div className="flex rounded-lg bg-gray-100 p-0.5">
          {metricMeta.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMetric(m.key)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                metric === m.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      {data.length === 0 ? (
        <div className="py-10 text-center text-sm text-gray-400">暂无数据</div>
      ) : (
        <div className="flex h-48 gap-3">
          {data.map((d) => {
            const v = d[metric];
            const pct = v === 0 ? 0 : Math.max(3, (v / max) * 100);
            return (
              <div key={d.date} className="flex min-w-0 flex-1 flex-col items-center">
                <span className="text-xs tabular-nums text-gray-500">{numberFmt.format(v)}</span>
                <div className="flex w-full flex-1 items-end justify-center">
                  <div
                    className={`w-full max-w-10 rounded-t ${meta.bar}`}
                    style={{ height: `${pct}%` }}
                  />
                </div>
                <span className="mt-1 text-xs tabular-nums text-gray-400">{d.date.slice(5)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PageSkeleton() {
  return (
    <div>
      <PageHeader title="数据看板" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="h-28 animate-pulse p-5" />
        ))}
      </div>
    </div>
  );
}
