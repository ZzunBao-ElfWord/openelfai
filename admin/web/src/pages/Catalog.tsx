import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  errText,
  fetchCatalog,
  updateCatalogModule,
  type CatalogModule,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useEnv } from '../env/EnvContext';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader } from '../components/ui/primitives';

const numberFmt = new Intl.NumberFormat('zh-CN');

export default function Catalog() {
  const { me } = useAuth();
  const { env } = useEnv();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<CatalogModule | null>(null);
  const [price, setPrice] = useState('');
  const [listed, setListed] = useState<'' | 'true' | 'false'>('');
  const [editError, setEditError] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['catalog'],
    queryFn: fetchCatalog,
  });

  const mutation = useMutation({
    mutationFn: () => {
      if (!editing) {
        return Promise.reject(new Error('no target'));
      }
      const body: { environment: typeof env; price_diamonds?: number; listed?: boolean } = {
        environment: env,
      };
      if (price.trim() !== '') {
        body.price_diamonds = Number(price);
      }
      if (listed !== '') {
        body.listed = listed === 'true';
      }
      return updateCatalogModule(editing.id, body);
    },
    onSuccess: () => {
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ['catalog'] });
    },
    onError: (err) => setEditError(errText(err, '保存失败')),
  });

  function openEdit(m: CatalogModule) {
    setEditing(m);
    setPrice(m.override ? String(m.override.price_diamonds) : '');
    setListed(m.override ? String(m.override.listed) as 'true' | 'false' : '');
    setEditError('');
  }

  const isSuper = me?.role === 'super_admin';

  return (
    <div>
      <PageHeader title="能力包目录" desc="定价单位：钻石（10 钻石 = 1 元）；覆盖配置按环境独立" />

      <Card>
        {error ? (
          <div className="p-6 text-sm text-red-600">{errText(error, '目录加载失败')}</div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="th">赛道</th>
                <th className="th">名称</th>
                <th className="th">槽位</th>
                <th className="th text-right">词元消耗</th>
                <th className="th text-right">定价（钻石）</th>
                <th className="th">状态</th>
                {isSuper ? <th className="th text-right">操作</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr>
                  <td className="td text-gray-400" colSpan={isSuper ? 7 : 6}>
                    加载中…
                  </td>
                </tr>
              ) : data && data.modules.length > 0 ? (
                data.modules.map((m) => {
                  const effective = m.override?.price_diamonds ?? m.price_diamonds;
                  return (
                    <tr key={m.id}>
                      <td className="td">
                        <Badge tone="blue">{m.track}</Badge>
                      </td>
                      <td className="td font-medium text-gray-900">{m.label}</td>
                      <td className="td text-gray-600">{m.slot}</td>
                      <td className="td text-right tabular-nums text-gray-700">
                        {numberFmt.format(m.token_cost)}
                      </td>
                      <td className="td text-right">
                        <span className="tabular-nums font-medium text-gray-900">
                          {numberFmt.format(effective)}
                        </span>
                        {m.override ? (
                          <span className="ml-2 text-xs tabular-nums text-gray-400 line-through">
                            {numberFmt.format(m.price_diamonds)}
                          </span>
                        ) : null}
                      </td>
                      <td className="td">
                        <div className="flex flex-wrap gap-1.5">
                          {m.override ? <Badge tone="amber">已覆盖</Badge> : <Badge tone="gray">默认</Badge>}
                          {m.override?.listed === false ? (
                            <Badge tone="red">已下架</Badge>
                          ) : m.override?.listed === true ? (
                            <Badge tone="green">已上架</Badge>
                          ) : null}
                        </div>
                      </td>
                      {isSuper ? (
                        <td className="td text-right">
                          <Button variant="secondary" onClick={() => openEdit(m)}>
                            编辑
                          </Button>
                        </td>
                      ) : null}
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={isSuper ? 7 : 6}>
                    <EmptyState text="目录为空" />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </Card>

      <Modal
        open={!!editing}
        title={`编辑能力包 — ${editing?.label ?? ''}`}
        onClose={() => setEditing(null)}
      >
        <div className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
          一期仅落库，待服务端接入后生效。当前环境：
          {env === 'Production' ? '生产环境' : '沙箱环境'}。
        </div>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (price.trim() !== '' && (!Number.isFinite(Number(price)) || Number(price) < 0)) {
              setEditError('覆盖价必须为非负数字');
              return;
            }
            if (price.trim() === '' && listed === '') {
              setEditError('请至少填写一项要修改的内容');
              return;
            }
            setEditError('');
            mutation.mutate();
          }}
        >
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              覆盖定价（钻石，留空则不修改）
            </label>
            <Input
              type="number"
              min="0"
              step="1"
              className="w-full"
              placeholder={`默认定价 ${editing?.price_diamonds ?? 0}`}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">上架状态</label>
            <select
              className="input"
              value={listed}
              onChange={(e) => setListed(e.target.value as '' | 'true' | 'false')}
            >
              <option value="">不修改</option>
              <option value="true">上架</option>
              <option value="false">下架</option>
            </select>
          </div>
          {editError ? <div className="text-sm text-red-600">{editError}</div> : null}
          <div className="flex justify-end gap-3">
            <Button type="button" onClick={() => setEditing(null)}>
              取消
            </Button>
            <Button variant="primary" type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? '保存中…' : '保存覆盖'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
