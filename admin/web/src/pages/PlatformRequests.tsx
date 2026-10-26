import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  errText,
  fetchPlatformRequests,
  fetchPlatformUsage,
  type PlatformRequestFilter,
} from '../api/client';
import { Badge, Button, Card, EmptyState, Input, PageHeader } from '../components/ui/primitives';
import Pagination from '../components/ui/Pagination';

const PAGE_SIZE = 20;
const MICRO = 1_000_000;
const numberFmt = new Intl.NumberFormat('zh-CN');

function yuan(micro: number): string {
  return (micro / MICRO).toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  });
}

function fmtTime(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'number' ? v : Number(v);
  const d = new Date(Number.isFinite(n) ? n : v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('zh-CN', { hour12: false });
}

export default function PlatformRequests() {
  const [daysInput, setDaysInput] = useState('7');
  const [days, setDays] = useState(7);
  const [model, setModel] = useState('');
  const [status, setStatus] = useState('');
  const [userId, setUserId] = useState('');
  const [submitted, setSubmitted] = useState<PlatformRequestFilter>({});
  const [page, setPage] = useState(1);

  const usageQuery = useQuery({
    queryKey: ['platform-usage', days],
    queryFn: () => fetchPlatformUsage(days),
  });

  const logQuery = useQuery({
    queryKey: ['platform-requests', submitted, page],
    queryFn: () => fetchPlatformRequests(submitted, page),
  });

  const usage = usageQuery.data;
  const totalRequests = (usage?.daily ?? []).reduce((s, d) => s + d.requests, 0);
  const promptTokens = (usage?.daily ?? []).reduce((s, d) => s + d.prompt_tokens, 0);
  const completionTokens = (usage?.daily ?? []).reduce((s, d) => s + d.completion_tokens, 0);
  const priceMicro = (usage?.daily ?? []).reduce((s, d) => s + d.price_micro, 0);

  const filtered = submitted.model || submitted.status || submitted.user_id;

  return (
    <div>
      <PageHeader
        title="调用日志"
        desc="开放平台调用用量与明细；金额单位为元，成本为上游成本、售价为对开发者实际收费"
      />

      <form
        className="mb-4 flex flex-wrap items-center gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(daysInput);
          if (!Number.isInteger(n) || n < 1 || n > 90) return;
          setDays(n);
        }}
      >
        <span className="text-sm text-gray-500">统计周期</span>
        <Input
          type="number"
          min="1"
          max="90"
          step="1"
          className="max-w-24"
          value={daysInput}
          onChange={(e) => setDaysInput(e.target.value)}
        />
        <span className="text-sm text-gray-500">天</span>
        <Button variant="secondary" type="submit">
          应用
        </Button>
      </form>

      {usageQuery.error ? (
        <Card className="mb-4 p-6 text-sm text-red-600">
          {errText(usageQuery.error, '用量统计加载失败')}
        </Card>
      ) : (
        <>
          <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label={`近 ${days} 天请求数`} value={numberFmt.format(totalRequests)} />
            <StatCard label="输入 token" value={numberFmt.format(promptTokens)} />
            <StatCard label="输出 token" value={numberFmt.format(completionTokens)} />
            <StatCard label="消费金额（元）" value={yuan(priceMicro)} />
          </div>

          <Card className="mb-6">
            <div className="border-b border-gray-100 px-6 py-4">
              <h2 className="text-sm font-semibold text-gray-900">按模型汇总</h2>
            </div>
            {usageQuery.isLoading ? (
              <div className="p-6 text-sm text-gray-400">加载中…</div>
            ) : usage && usage.by_model.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="th">实际模型</th>
                      <th className="th text-right">请求数</th>
                      <th className="th text-right">消费金额（元）</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {usage.by_model.map((m) => (
                      <tr key={m.resolved_model}>
                        <td className="td font-mono text-xs text-gray-700">{m.resolved_model}</td>
                        <td className="td text-right tabular-nums text-gray-900">
                          {numberFmt.format(m.requests)}
                        </td>
                        <td className="td text-right tabular-nums text-gray-900">
                          {yuan(m.price_micro)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState text="周期内暂无调用" />
            )}
          </Card>
        </>
      )}

      <form
        className="mb-4 flex flex-wrap items-center gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setSubmitted({
            model: model.trim() || undefined,
            status: status.trim() || undefined,
            user_id: userId.trim() || undefined,
          });
        }}
      >
        <Input
          className="max-w-52"
          placeholder="请求 / 实际模型"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />
        <select
          className="input max-w-40"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">全部状态</option>
          <option value="ok">成功</option>
          <option value="upstream_error">上游错误</option>
          <option value="timeout">超时</option>
          <option value="rejected">已拒绝</option>
        </select>
        <Input
          className="max-w-56"
          placeholder="用户 ID"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
        />
        <Button variant="primary" type="submit">
          筛选
        </Button>
        {filtered ? (
          <Button
            variant="ghost"
            type="button"
            onClick={() => {
              setModel('');
              setStatus('');
              setUserId('');
              setPage(1);
              setSubmitted({});
            }}
          >
            重置
          </Button>
        ) : null}
      </form>

      <Card>
        {logQuery.error ? (
          <div className="p-6 text-sm text-red-600">{errText(logQuery.error, '调用日志加载失败')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="th">时间</th>
                  <th className="th">用户</th>
                  <th className="th">请求模型</th>
                  <th className="th">实际模型</th>
                  <th className="th text-right">Prompt / Completion</th>
                  <th className="th text-right">成本（元）</th>
                  <th className="th text-right">售价（元）</th>
                  <th className="th text-right">延迟 ms</th>
                  <th className="th">状态</th>
                  <th className="th">是否估算</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {logQuery.isLoading ? (
                  <tr>
                    <td className="td text-gray-400" colSpan={10}>
                      加载中…
                    </td>
                  </tr>
                ) : logQuery.data && logQuery.data.items.length > 0 ? (
                  logQuery.data.items.map((r) => (
                    <tr key={`${r.id}-${r.created_at}`}>
                      <td className="td whitespace-nowrap text-xs text-gray-500">
                        {fmtTime(r.created_at)}
                      </td>
                      <td className="td font-mono text-xs text-gray-500" title={r.user_id}>
                        {r.user_id.slice(0, 12)}…
                      </td>
                      <td className="td max-w-48 truncate font-mono text-xs text-gray-600" title={r.requested_model}>
                        {r.requested_model}
                      </td>
                      <td className="td max-w-48 truncate font-mono text-xs text-gray-900" title={r.resolved_model}>
                        {r.resolved_model}
                      </td>
                      <td className="td whitespace-nowrap text-right tabular-nums text-gray-700">
                        {numberFmt.format(r.prompt_tokens)} / {numberFmt.format(r.completion_tokens)}
                      </td>
                      <td className="td text-right tabular-nums text-gray-700">{yuan(r.cost_micro)}</td>
                      <td className="td text-right tabular-nums text-gray-900">{yuan(r.price_micro)}</td>
                      <td className="td text-right tabular-nums text-gray-700">
                        {numberFmt.format(r.latency_ms)}
                      </td>
                      <td className="td">
                        <Badge tone={r.status === 'ok' ? 'green' : 'red'}>{r.status}</Badge>
                      </td>
                      <td className="td">
                        {r.estimated ? (
                          <Badge tone="amber">估算</Badge>
                        ) : (
                          <span className="text-xs text-gray-400">否</span>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={10}>
                      <EmptyState text="没有匹配的调用记录" />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {logQuery.data ? (
        <Pagination
          page={page}
          total={logQuery.data.total}
          pageSize={PAGE_SIZE}
          onChange={setPage}
        />
      ) : null}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-5">
      <div className="text-xs text-gray-400">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-gray-900">{value}</div>
    </Card>
  );
}
