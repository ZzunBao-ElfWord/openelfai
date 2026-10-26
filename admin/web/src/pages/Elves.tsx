import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { errText, fetchElves, type ElfFilter } from '../api/client';
import { useEnv } from '../env/EnvContext';
import { Badge, Button, Card, EmptyState, Input, PageHeader } from '../components/ui/primitives';
import Pagination from '../components/ui/Pagination';

const PAGE_SIZE = 20;

export default function Elves() {
  const navigate = useNavigate();
  const { env } = useEnv();
  const [page, setPage] = useState(1);
  const [owner, setOwner] = useState('');
  const [state, setState] = useState('');
  const [q, setQ] = useState('');
  const [officialOnly, setOfficialOnly] = useState(false);
  const [submitted, setSubmitted] = useState<ElfFilter>({});

  const { data, isLoading, error } = useQuery({
    queryKey: ['elves', env, submitted, page],
    queryFn: () => fetchElves(env, submitted, page),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    setSubmitted({
      owner: owner.trim() || undefined,
      state: state.trim() || undefined,
      q: q.trim() || undefined,
      official: officialOnly || undefined,
    });
  }

  function onReset() {
    setOwner('');
    setState('');
    setQ('');
    setOfficialOnly(false);
    setPage(1);
    setSubmitted({});
  }

  const filtered = submitted.owner || submitted.state || submitted.q || submitted.official;

  return (
    <div>
      <PageHeader title="AI 精灵" desc="按属主 / 状态 / 关键字检索精灵实例" />

      <form onSubmit={onSubmit} className="mb-4 flex flex-wrap gap-3">
        <Input
          className="max-w-48"
          placeholder="属主用户 ID"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
        />
        <Input
          className="max-w-32"
          placeholder="状态"
          value={state}
          onChange={(e) => setState(e.target.value)}
        />
        <Input
          className="max-w-56"
          placeholder="名称关键字"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={officialOnly}
            onChange={(e) => setOfficialOnly(e.target.checked)}
          />
          仅看官方
        </label>
        <Button variant="primary" type="submit">
          筛选
        </Button>
        {filtered ? (
          <Button variant="ghost" type="button" onClick={onReset}>
            重置
          </Button>
        ) : null}
      </form>

      <Card>
        {error ? (
          <div className="p-6 text-sm text-red-600">{errText(error, '精灵列表加载失败')}</div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="th">Object ID</th>
                <th className="th">名称</th>
                <th className="th">属主</th>
                <th className="th">状态</th>
                <th className="th">更新时间</th>
                <th className="th text-right">操作</th>
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
                data.items.map((e) => (
                  <tr key={e.object_id}>
                    <td className="td font-mono text-xs text-gray-400" title={e.object_id}>
                      {e.object_id.slice(0, 12)}…
                    </td>
                    <td className="td font-medium text-gray-900">
                      {e.name || '(未命名)'}
                      {e.is_official ? (
                        <span className="ml-2">
                          <Badge tone="blue">官方</Badge>
                        </span>
                      ) : null}
                    </td>
                    <td className="td font-mono text-xs text-gray-600" title={e.owner_id}>
                      {e.owner_id.slice(0, 12)}…
                    </td>
                    <td className="td">
                      <Badge tone="gray">{e.state}</Badge>
                    </td>
                    <td className="td whitespace-nowrap text-xs text-gray-500">
                      {e.updated_at
                        ? new Date(e.updated_at).toLocaleString('zh-CN', { hour12: false })
                        : '—'}
                    </td>
                    <td className="td text-right">
                      <Button
                        variant="secondary"
                        onClick={() => navigate(`/elves/${e.object_id}`)}
                      >
                        详情
                      </Button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6}>
                    <EmptyState text="没有匹配的精灵" />
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
