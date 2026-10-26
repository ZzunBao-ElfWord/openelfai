import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { errText, fetchLedger, type LedgerFilter } from '../api/client';
import { useEnv } from '../env/EnvContext';
import { Badge, Button, Card, EmptyState, Input, PageHeader } from '../components/ui/primitives';
import Pagination from '../components/ui/Pagination';

const PAGE_SIZE = 20;

export default function Ledger() {
  const { env } = useEnv();
  const [page, setPage] = useState(1);
  const [userId, setUserId] = useState('');
  const [type, setType] = useState('');
  const [submitted, setSubmitted] = useState<LedgerFilter>({});
  // 契约不含日期参数：日期筛选仅作用于当前页已加载数据
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['ledger', env, submitted, page],
    queryFn: () => fetchLedger(env, submitted, page),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    setSubmitted({
      user_id: userId.trim() || undefined,
      type: type.trim() || undefined,
    });
  }

  function onReset() {
    setUserId('');
    setType('');
    setFrom('');
    setTo('');
    setPage(1);
    setSubmitted({});
  }

  const items = (data?.items ?? []).filter((it) => {
    const day = it.created_at.slice(0, 10);
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  });

  const filtered = submitted.user_id || submitted.type;

  return (
    <div>
      <PageHeader title="钻石流水" desc="全站钱包流水；金额单位为钻石，正数为入账、负数为出账" />

      <form onSubmit={onSubmit} className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          className="max-w-56"
          placeholder="用户 ID"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
        />
        <Input
          className="max-w-40"
          placeholder="流水类型，如 recharge"
          value={type}
          onChange={(e) => setType(e.target.value)}
        />
        <Button variant="primary" type="submit">
          筛选
        </Button>
        {filtered ? (
          <Button variant="ghost" type="button" onClick={onReset}>
            重置
          </Button>
        ) : null}
        <div className="flex-1" />
        <span className="text-xs text-gray-400">本页日期筛选</span>
        <Input
          type="date"
          className="max-w-36"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <span className="text-xs text-gray-400">至</span>
        <Input
          type="date"
          className="max-w-36"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </form>

      <Card>
        {error ? (
          <div className="p-6 text-sm text-red-600">{errText(error, '流水加载失败')}</div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="th">时间</th>
                <th className="th">事件 ID</th>
                <th className="th">类型</th>
                <th className="th text-right">金额（钻石）</th>
                <th className="th text-right">余额</th>
                <th className="th text-right">欠额</th>
                <th className="th">备注</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr>
                  <td className="td text-gray-400" colSpan={7}>
                    加载中…
                  </td>
                </tr>
              ) : items.length > 0 ? (
                items.map((l) => (
                  <tr key={l.event_id}>
                    <td className="td whitespace-nowrap text-xs text-gray-500">
                      {l.created_at
                        ? new Date(l.created_at).toLocaleString('zh-CN', { hour12: false })
                        : '—'}
                    </td>
                    <td className="td font-mono text-xs text-gray-400" title={l.event_id}>
                      {l.event_id.slice(0, 12)}…
                    </td>
                    <td className="td">
                      <Badge tone="blue">{l.type}</Badge>
                    </td>
                    <td
                      className={`td text-right tabular-nums ${
                        l.amount >= 0 ? 'text-green-600' : 'text-red-600'
                      }`}
                    >
                      {l.amount >= 0 ? `+${l.amount}` : l.amount}
                    </td>
                    <td className="td text-right tabular-nums text-gray-700">{l.balance_after}</td>
                    <td className="td text-right tabular-nums text-gray-500">{l.debt_after}</td>
                    <td className="td max-w-64 truncate text-xs text-gray-500" title={l.note}>
                      {l.note || '—'}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7}>
                    <EmptyState text="没有匹配的流水记录" />
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
    </div>
  );
}
