import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  errText,
  fetchAlipayOrders,
  fetchAppleOrders,
  fetchOrderReviews,
  resolveOrderReview,
  type OrderRow,
} from '../api/client';
import { useEnv } from '../env/EnvContext';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Textarea,
} from '../components/ui/primitives';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import Pagination from '../components/ui/Pagination';

const PAGE_SIZE = 20;

type OrderTab = 'alipay' | 'apple' | 'reviews';

const tabs: { key: OrderTab; label: string }[] = [
  { key: 'alipay', label: '支付宝订单' },
  { key: 'apple', label: 'Apple 订单' },
  { key: 'reviews', label: '异常单队列' },
];

export default function Orders() {
  const { env } = useEnv();
  const [tab, setTab] = useState<OrderTab>('alipay');
  const [page, setPage] = useState(1);
  const [stateInput, setStateInput] = useState('');
  const [submittedState, setSubmittedState] = useState('');
  const [pending, setPending] = useState<OrderRow | null>(null);
  const [note, setNote] = useState('');

  const queryClient = useQueryClient();

  const alipayQuery = useQuery({
    queryKey: ['orders-alipay', env, submittedState, page],
    queryFn: () => fetchAlipayOrders(env, submittedState, page),
    enabled: tab === 'alipay',
  });
  const appleQuery = useQuery({
    queryKey: ['orders-apple', env, page],
    queryFn: () => fetchAppleOrders(env, page),
    enabled: tab === 'apple',
  });
  const reviewsQuery = useQuery({
    queryKey: ['orders-reviews', env, page],
    queryFn: () => fetchOrderReviews(env, page),
    enabled: tab === 'reviews',
  });

  const resolveMutation = useMutation({
    mutationFn: () => {
      if (!pending) {
        return Promise.reject(new Error('no target'));
      }
      return resolveOrderReview(pending.object_id, env, note.trim() || undefined);
    },
    onSuccess: () => {
      setPending(null);
      setNote('');
      void queryClient.invalidateQueries({ queryKey: ['orders-reviews'] });
    },
  });

  function switchTab(next: OrderTab) {
    setTab(next);
    setPage(1);
  }

  const activeQuery = tab === 'alipay' ? alipayQuery : tab === 'apple' ? appleQuery : reviewsQuery;
  const orderRows: OrderRow[] =
    tab === 'alipay' ? (alipayQuery.data?.items ?? []) : (reviewsQuery.data?.items ?? []);

  return (
    <div>
      <PageHeader title="订单管理" desc="支付宝 / Apple 充值订单与异常单处理；金额单位为钻石" />

      <div className="mb-4 flex gap-1 border-b border-gray-200">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => switchTab(t.key)}
            className={`-mb-px px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.key
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'alipay' ? (
        <form
          className="mb-4 flex gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setSubmittedState(stateInput.trim());
          }}
        >
          <Input
            className="max-w-48"
            placeholder="按状态筛选，如 success"
            value={stateInput}
            onChange={(e) => setStateInput(e.target.value)}
          />
          <Button variant="primary" type="submit">
            筛选
          </Button>
        </form>
      ) : null}

      {activeQuery.error ? (
        <Card className="p-6 text-sm text-red-600">{errText(activeQuery.error, '订单加载失败')}</Card>
      ) : tab === 'apple' ? (
        <AppleTable loading={appleQuery.isLoading} items={appleQuery.data?.items ?? []} />
      ) : (
        <OrderTable
          loading={activeQuery.isLoading}
          items={orderRows}
          review={tab === 'reviews'}
          onResolve={(o) => {
            setPending(o);
            setNote('');
          }}
        />
      )}

      {activeQuery.data ? (
        <Pagination page={page} total={activeQuery.data.total} pageSize={PAGE_SIZE} onChange={setPage} />
      ) : null}

      <ConfirmDialog
        open={!!pending}
        title="确认标记该异常单为已处理？"
        description={
          pending ? (
            <span>
              订单：<b className="font-mono text-xs">{pending.object_id}</b>
              <br />
              标记后该单移出异常队列。请确认已人工核实渠道侧的实际支付状态。该操作记录审计日志。
            </span>
          ) : null
        }
        confirmText="标记处理"
        danger={false}
        loading={resolveMutation.isPending}
        onCancel={() => setPending(null)}
        onConfirm={() => resolveMutation.mutate()}
      >
        <label className="mb-1.5 block text-sm font-medium text-gray-700">处理备注（可选）</label>
        <Textarea
          className="w-full"
          placeholder="如：渠道核实已支付，手动补单"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        {resolveMutation.error ? (
          <div className="mt-2 text-sm text-red-600">{errText(resolveMutation.error, '处理失败')}</div>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}

function payloadText(payload: Record<string, unknown>): string {
  try {
    return JSON.stringify(payload);
  } catch {
    return '(无法序列化)';
  }
}

function OrderTable({
  loading,
  items,
  review,
  onResolve,
}: {
  loading: boolean;
  items: OrderRow[];
  review: boolean;
  onResolve?: (o: OrderRow) => void;
}) {
  const colSpan = review ? 7 : 6;
  return (
    <Card>
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="th">订单 ID</th>
            <th className="th">用户</th>
            <th className="th">状态</th>
            <th className="th">关联单号</th>
            <th className="th">更新时间</th>
            <th className="th">Payload</th>
            {review ? <th className="th text-right">操作</th> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {loading ? (
            <tr>
              <td className="td text-gray-400" colSpan={colSpan}>
                加载中…
              </td>
            </tr>
          ) : items.length > 0 ? (
            items.map((o) => {
              const text = payloadText(o.payload);
              return (
                <tr key={o.object_id}>
                  <td className="td font-mono text-xs text-gray-400" title={o.object_id}>
                    {o.object_id.slice(0, 12)}…
                  </td>
                  <td className="td font-mono text-xs text-gray-600" title={o.owner_id}>
                    {o.owner_id.slice(0, 12)}…
                  </td>
                  <td className="td">
                    <Badge tone={o.state === 'success' ? 'green' : o.state === 'review' ? 'amber' : 'gray'}>
                      {o.state}
                    </Badge>
                  </td>
                  <td className="td font-mono text-xs text-gray-600">{o.ref_id || '—'}</td>
                  <td className="td whitespace-nowrap text-xs text-gray-500">
                    {o.updated_at
                      ? new Date(o.updated_at).toLocaleString('zh-CN', { hour12: false })
                      : '—'}
                  </td>
                  <td className="td max-w-56">
                    <div className="truncate font-mono text-xs text-gray-500" title={text}>
                      {text}
                    </div>
                  </td>
                  {review ? (
                    <td className="td text-right">
                      <Button variant="primary" onClick={() => onResolve?.(o)}>
                        标记处理
                      </Button>
                    </td>
                  ) : null}
                </tr>
              );
            })
          ) : (
            <tr>
              <td colSpan={colSpan}>
                <EmptyState text={review ? '异常单队列为空' : '没有匹配的订单'} />
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}

function AppleTable({
  loading,
  items,
}: {
  loading: boolean;
  items: import('../api/client').AppleOrder[];
}) {
  return (
    <Card>
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="th">交易 ID</th>
            <th className="th">用户</th>
            <th className="th">商品</th>
            <th className="th text-right">钻石</th>
            <th className="th">环境</th>
            <th className="th">购买时间</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {loading ? (
            <tr>
              <td className="td text-gray-400" colSpan={6}>
                加载中…
              </td>
            </tr>
          ) : items.length > 0 ? (
            items.map((o) => (
              <tr key={o.transaction_id}>
                <td className="td font-mono text-xs text-gray-400" title={o.transaction_id}>
                  {o.transaction_id.slice(0, 16)}…
                </td>
                <td className="td font-mono text-xs text-gray-600" title={o.user_id}>
                  {o.user_id.slice(0, 12)}…
                </td>
                <td className="td text-xs text-gray-600">{o.product_id}</td>
                <td className="td text-right tabular-nums text-gray-900">{o.diamonds}</td>
                <td className="td">
                  <Badge tone={o.environment === 'Production' ? 'blue' : 'amber'}>
                    {o.environment}
                  </Badge>
                </td>
                <td className="td whitespace-nowrap text-xs text-gray-500">
                  {o.purchased_at
                    ? new Date(o.purchased_at).toLocaleString('zh-CN', { hour12: false })
                    : '—'}
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={6}>
                <EmptyState text="没有匹配的订单" />
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}
