import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { errText, fetchUserDetail, type Wallet } from '../api/client';
import { Badge, Card, EmptyState, PageHeader } from '../components/ui/primitives';

export default function UserDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error } = useQuery({
    queryKey: ['user-detail', id],
    queryFn: () => fetchUserDetail(id as string),
    enabled: !!id,
  });

  if (isLoading) {
    return <div className="py-12 text-center text-sm text-gray-400">加载中…</div>;
  }
  if (error || !data) {
    return (
      <div>
        <PageHeader title="用户详情" />
        <Card className="p-6 text-sm text-red-600">{errText(error, '用户详情加载失败')}</Card>
      </div>
    );
  }

  const u = data.user;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/users" className="text-sm text-blue-600 hover:underline">
          ← 返回用户列表
        </Link>
      </div>
      <PageHeader title={`用户详情 — ${u.nickname || u.id}`} desc="资料、双环境钱包、持有 AI 与最近流水" />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="mb-4 text-sm font-semibold text-gray-900">基本资料</h2>
          <div className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-2 text-sm">
            <span className="text-gray-400">用户 ID</span>
            <span className="break-all font-mono text-xs text-gray-600">{u.id}</span>
            <span className="text-gray-400">昵称</span>
            <span className="font-medium text-gray-900">{u.nickname || '(未命名)'}</span>
            <span className="text-gray-400">手机号</span>
            <span className="text-gray-700">{u.phone || '—'}</span>
            <span className="text-gray-400">状态</span>
            <span>
              {u.status === 'banned' ? <Badge tone="red">已封禁</Badge> : <Badge tone="green">正常</Badge>}
            </span>
            <span className="text-gray-400">注册时间</span>
            <span className="text-gray-700">
              {u.created_at ? new Date(u.created_at).toLocaleString('zh-CN', { hour12: false }) : '—'}
            </span>
            <span className="text-gray-400">最后登录</span>
            <span className="text-gray-700">
              {u.last_login_at
                ? new Date(u.last_login_at).toLocaleString('zh-CN', { hour12: false })
                : '—'}
            </span>
            <span className="text-gray-400">实名认证</span>
            <span className="text-gray-400">未接入实名</span>
            <span className="text-gray-400">登录会话数</span>
            <span className="tabular-nums text-gray-700">{data.sessions}</span>
          </div>
        </Card>

        <div className="space-y-4">
          <WalletCard title="生产环境钱包" wallet={data.wallets.Production} />
          <WalletCard title="沙箱环境钱包" wallet={data.wallets.Sandbox} />
        </div>
      </div>

      <Card>
        <div className="border-b border-gray-100 px-6 py-4">
          <h2 className="text-sm font-semibold text-gray-900">持有的 AI 精灵（{data.elves.length}）</h2>
        </div>
        {data.elves.length === 0 ? (
          <EmptyState text="该用户暂无 AI 精灵" />
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="th">Object ID</th>
                <th className="th">名称</th>
                <th className="th">状态</th>
                <th className="th">更新时间</th>
                <th className="th text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.elves.map((e) => (
                <tr key={e.object_id}>
                  <td className="td font-mono text-xs text-gray-400" title={e.object_id}>
                    {e.object_id.slice(0, 12)}…
                  </td>
                  <td className="td font-medium text-gray-900">{e.name || '(未命名)'}</td>
                  <td className="td">
                    <Badge tone="gray">{e.state}</Badge>
                  </td>
                  <td className="td whitespace-nowrap text-xs text-gray-500">
                    {e.updated_at
                      ? new Date(e.updated_at).toLocaleString('zh-CN', { hour12: false })
                      : '—'}
                  </td>
                  <td className="td text-right">
                    <Link
                      to={`/elves/${e.object_id}`}
                      className="text-sm font-medium text-blue-600 hover:underline"
                    >
                      查看
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <div className="border-b border-gray-100 px-6 py-4">
          <h2 className="text-sm font-semibold text-gray-900">
            最近流水（{data.recent_ledger.length} 条）
          </h2>
        </div>
        {data.recent_ledger.length === 0 ? (
          <EmptyState text="暂无流水记录" />
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="th">时间</th>
                <th className="th">类型</th>
                <th className="th text-right">金额（钻石）</th>
                <th className="th text-right">余额</th>
                <th className="th text-right">欠额</th>
                <th className="th">备注</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.recent_ledger.map((l) => (
                <tr key={l.event_id}>
                  <td className="td whitespace-nowrap text-xs text-gray-500">
                    {l.created_at
                      ? new Date(l.created_at).toLocaleString('zh-CN', { hour12: false })
                      : '—'}
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
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function WalletCard({ title, wallet }: { title: string; wallet?: Wallet }) {
  return (
    <Card className="p-6">
      <h2 className="mb-4 text-sm font-semibold text-gray-900">{title}</h2>
      {wallet ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div>
            <div className="text-xs text-gray-400">钻石余额</div>
            <div className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900">
              {wallet.diamonds}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-400">退款欠额</div>
            <div
              className={`mt-0.5 text-lg font-semibold tabular-nums ${
                wallet.refund_debt > 0 ? 'text-red-600' : 'text-gray-900'
              }`}
            >
              {wallet.refund_debt}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-400">累计充值</div>
            <div className="mt-0.5 tabular-nums text-gray-700">{wallet.total_recharged} 钻石</div>
          </div>
          <div>
            <div className="text-xs text-gray-400">累计消费</div>
            <div className="mt-0.5 tabular-nums text-gray-700">{wallet.total_spent} 钻石</div>
          </div>
          <div>
            <div className="text-xs text-gray-400">创作者收益</div>
            <div className="mt-0.5 tabular-nums text-gray-700">
              ¥{(wallet.earnings_fen / 100).toFixed(2)}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-400">版本号</div>
            <div className="mt-0.5 tabular-nums text-gray-400">v{wallet.version}</div>
          </div>
        </div>
      ) : (
        <div className="py-4 text-center text-sm text-gray-400">该环境暂无钱包</div>
      )}
    </Card>
  );
}
