import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { downloadCsv, errText, fetchAudit, type AuditEntry, type AuditFilter } from '../api/client';
import { Badge, Button, Card, EmptyState, Input, PageHeader } from '../components/ui/primitives';
import Pagination from '../components/ui/Pagination';

const PAGE_SIZE = 50;

const methodTone: Record<string, 'red' | 'amber' | 'blue' | 'gray'> = {
  DELETE: 'red',
  POST: 'blue',
  PATCH: 'amber',
  PUT: 'amber',
};

export default function Audit() {
  const [page, setPage] = useState(1);
  const [method, setMethod] = useState('');
  const [actor, setActor] = useState('');
  const [q, setQ] = useState('');
  const [submitted, setSubmitted] = useState<AuditFilter>({});
  const [exporting, setExporting] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['audit', page, submitted],
    queryFn: () => fetchAudit(page, submitted),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    setSubmitted({
      method: method || undefined,
      actor: actor.trim() || undefined,
      q: q.trim() || undefined,
    });
  }

  function onReset() {
    setMethod('');
    setActor('');
    setQ('');
    setPage(1);
    setSubmitted({});
  }

  const filtered = submitted.method || submitted.actor || submitted.q;

  return (
    <div>
      <PageHeader title="审计日志" desc="所有变更类操作（登录除外）的不可抵赖记录" />

      <form onSubmit={onSubmit} className="mb-4 flex flex-wrap gap-3">
        <select className="input max-w-32" value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="">全部方法</option>
          <option value="POST">POST</option>
          <option value="PUT">PUT</option>
          <option value="PATCH">PATCH</option>
          <option value="DELETE">DELETE</option>
        </select>
        <Input
          className="max-w-40"
          placeholder="操作人"
          value={actor}
          onChange={(e) => setActor(e.target.value)}
        />
        <Input
          className="max-w-64"
          placeholder="路径关键字，如 /users"
          value={q}
          onChange={(e) => setQ(e.target.value)}
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
        <Button
          variant="secondary"
          type="button"
          disabled={exporting}
          onClick={async () => {
            setExporting(true);
            try {
              await downloadCsv('/audit/export.csv', Object.fromEntries(
                Object.entries(submitted).filter(([, v]) => v) as [string, string][],
              ));
            } finally {
              setExporting(false);
            }
          }}
        >
          {exporting ? '导出中…' : '导出 CSV'}
        </Button>
      </form>

      <Card>
        {error ? (
          <div className="p-6 text-sm text-red-600">{errText(error, '审计日志加载失败')}</div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="th">时间(UTC)</th>
                <th className="th">操作人</th>
                <th className="th">方法</th>
                <th className="th">路径</th>
                <th className="th">结果</th>
                <th className="th">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr>
                  <td className="td text-gray-400" colSpan={6}>
                    加载中…
                  </td>
                </tr>
              ) : data && data.items.length > 0 ? (
                data.items.map((row: AuditEntry) => (
                  <tr key={row.id}>
                    <td className="td whitespace-nowrap text-xs text-gray-500">
                      {new Date(row.created_at).toLocaleString('zh-CN', { hour12: false })}
                    </td>
                    <td className="td">
                      <div className="font-medium text-gray-900">{row.actor_name || '匿名'}</div>
                      <div className="text-xs text-gray-400">{row.role}</div>
                    </td>
                    <td className="td">
                      <Badge tone={methodTone[row.method] ?? 'gray'}>{row.method}</Badge>
                    </td>
                    <td className="td font-mono text-xs text-gray-600">{row.path}</td>
                    <td className="td">
                      <Badge tone={row.status < 400 ? 'green' : 'red'}>{row.status}</Badge>
                    </td>
                    <td className="td font-mono text-xs text-gray-500">{row.ip}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6}>
                    <EmptyState text="没有匹配的审计记录" />
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
