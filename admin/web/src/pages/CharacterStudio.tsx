import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createCharacterBatch,
  errText,
  fetchCharacterBatch,
  fetchCharacterBatches,
  fetchCharacterSlots,
  updateCharacterPart,
  type CharacterBatch,
  type CharacterBatchItem,
  type CharacterPart,
  type CharacterPartStatus,
  type CharacterPartUpdate,
  type CharacterRarity,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Badge, Button, Card, EmptyState, Input, PageHeader } from '../components/ui/primitives';
import ConfirmDialog from '../components/ui/ConfirmDialog';

type Tone = 'gray' | 'red' | 'amber' | 'green' | 'blue';

const rarityOptions: CharacterRarity[] = ['common', 'rare', 'epic', 'legendary'];

const rarityTone = (tier?: string): Tone => {
  switch (tier) {
    case 'legendary':
      return 'red';
    case 'epic':
      return 'amber';
    case 'rare':
      return 'blue';
    default:
      return 'gray';
  }
};

const statusOptions: CharacterPartStatus[] = ['enabled', 'disabled'];

interface PartDraft {
  weight: string;
  rarity: CharacterRarity;
  status: CharacterPartStatus;
}

type Notice = { tone: 'green' | 'red'; text: string };

const noticeClass: Record<Notice['tone'], string> = {
  green: 'bg-green-50 text-green-700',
  red: 'bg-red-50 text-red-600',
};

function fmtTime(v: number | string | undefined): string {
  if (v === undefined || v === '') return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('zh-CN', { hour12: false });
}

const batchIdOf = (b: CharacterBatch): string => b.id || b.batchId || '';

// 结果网格：缩略图 + 组合哈希 + 稀有度 + 单项下载
function BatchGrid({ batch }: { batch: CharacterBatch }) {
  const items = batch.items ?? [];
  if (!items.length) {
    return <EmptyState text="该批次没有可用条目" />;
  }
  return (
    <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((item: CharacterBatchItem) => (
        <div
          key={`${item.index}-${item.compositionHash}`}
          className="rounded-lg border border-gray-200 bg-white p-3"
        >
          {item.error ? (
            <div className="flex h-32 items-center justify-center rounded bg-red-50 px-2 text-center text-xs text-red-600">
              {item.error}
            </div>
          ) : (
            <a href={item.imageUrl} target="_blank" rel="noreferrer">
              <img
                src={item.thumbUrl ?? item.imageUrl}
                alt={item.compositionHash}
                loading="lazy"
                className="h-32 w-full rounded bg-gray-50 object-contain"
              />
            </a>
          )}
          <div className="mt-2 truncate font-mono text-[11px] text-gray-500" title={item.compositionHash}>
            #{item.index} · {item.compositionHash.slice(0, 10)}…
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <Badge tone={rarityTone(item.rarityTier)}>{item.rarityTier ?? '—'}</Badge>
            {item.imageUrl ? (
              <a
                className="text-xs text-blue-600 hover:underline"
                href={item.imageUrl}
                download
                target="_blank"
                rel="noreferrer"
              >
                下载
              </a>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function CharacterStudio() {
  const { me } = useAuth();
  const isSuper = me?.role === 'super_admin';
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState<Record<string, PartDraft>>({});
  const [pending, setPending] = useState<{ part: CharacterPart; body: CharacterPartUpdate } | null>(
    null,
  );
  const [notice, setNotice] = useState<Notice | null>(null);

  const [count, setCount] = useState('12');
  const [style, setStyle] = useState('anime');
  const [seedStart, setSeedStart] = useState('');
  const [batchName, setBatchName] = useState('');
  const [formError, setFormError] = useState('');

  const [result, setResult] = useState<CharacterBatch | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const partsQuery = useQuery({
    queryKey: ['character-slots'],
    queryFn: fetchCharacterSlots,
  });

  const batchesQuery = useQuery({
    queryKey: ['character-batches'],
    queryFn: () => fetchCharacterBatches(20),
  });

  const detailQuery = useQuery({
    queryKey: ['character-batch', selectedId],
    queryFn: () => fetchCharacterBatch(selectedId as string),
    enabled: !!selectedId,
  });

  useEffect(() => {
    const data = partsQuery.data;
    if (!data) return;
    const next: Record<string, PartDraft> = {};
    for (const slot of data.slots) {
      for (const part of slot.parts) {
        next[part.id] = {
          weight: String(part.weight),
          rarity: part.rarity,
          status: part.status,
        };
      }
    }
    setDraft(next);
  }, [partsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (vars: { part: CharacterPart; body: CharacterPartUpdate }) =>
      updateCharacterPart(vars.part.id, vars.body),
    onSuccess: (_res, vars) => {
      setPending(null);
      setNotice({ tone: 'green', text: `已保存配件「${vars.part.name}」` });
      void queryClient.invalidateQueries({ queryKey: ['character-slots'] });
    },
    onError: (err) => {
      setPending(null);
      setNotice({ tone: 'red', text: `保存失败：${errText(err, '请求失败')}` });
    },
  });

  const createMutation = useMutation({
    mutationFn: createCharacterBatch,
    onSuccess: (batch) => {
      setResult(batch);
      setSelectedId(null);
      setFormError('');
      setNotice({ tone: 'green', text: `批次「${batch.name}」已生成，共 ${batch.count} 条` });
      void queryClient.invalidateQueries({ queryKey: ['character-batches'] });
    },
    onError: (err) => {
      setNotice({ tone: 'red', text: `生成失败：${errText(err, '请求失败')}` });
    },
  });

  function draftOf(part: CharacterPart): PartDraft {
    return draft[part.id] ?? { weight: String(part.weight), rarity: part.rarity, status: part.status };
  }

  function setDraftField(id: string, patch: Partial<PartDraft>) {
    setDraft((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function patchOf(part: CharacterPart): CharacterPartUpdate {
    const d = draftOf(part);
    const body: CharacterPartUpdate = {};
    if (d.weight.trim() !== String(part.weight)) body.weight = Number(d.weight);
    if (d.rarity !== part.rarity) body.rarity = d.rarity;
    if (d.status !== part.status) body.status = d.status;
    return body;
  }

  function requestSave(part: CharacterPart) {
    const body = patchOf(part);
    if (!Object.keys(body).length) return;
    if (
      body.weight !== undefined &&
      (!Number.isInteger(body.weight) || body.weight < 1 || body.weight > 100)
    ) {
      setNotice({ tone: 'red', text: `「${part.name}」权重必须是 1-100 的整数` });
      return;
    }
    setNotice(null);
    setPending({ part, body });
  }

  function submitBatch() {
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1 || n > 200) {
      setFormError('数量必须是 1-200 的整数');
      return;
    }
    const styleValue = style.trim();
    if (!/^[a-z0-9_-]{1,24}$/i.test(styleValue)) {
      setFormError('风格只能由字母、数字、下划线或短横线组成（1-24 位）');
      return;
    }
    if (batchName.trim().length > 64) {
      setFormError('批次名不能超过 64 个字符');
      return;
    }
    let seed: number | undefined;
    if (seedStart.trim() !== '') {
      seed = Number(seedStart);
      if (!Number.isSafeInteger(seed) || seed < 0) {
        setFormError('起始 seed 必须是非负整数');
        return;
      }
    }
    setFormError('');
    createMutation.mutate({
      count: n,
      style: styleValue,
      seedStart: seed,
      name: batchName.trim() || undefined,
    });
  }

  const shownBatch: CharacterBatch | null = selectedId
    ? detailQuery.data ?? null
    : result;
  const comboSpace = partsQuery.data?.comboSpace ?? 0;
  const slots = partsQuery.data?.slots ?? [];

  return (
    <div>
      <PageHeader
        title="形象工坊"
        desc="配件权重与稀有度调整、批量形象生成；所有写入均由 openelf-api 内部运营接口执行，后台数据库账号对本模块只读。"
      />

      {notice ? (
        <div className={`mb-4 rounded-lg px-4 py-3 text-sm ${noticeClass[notice.tone]}`}>
          {notice.text}
        </div>
      ) : null}

      <h2 className="mb-3 text-base font-semibold text-gray-900">配件权重</h2>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm text-gray-500">
        <span>
          当前启用组合空间：<b className="tabular-nums text-gray-900">{comboSpace}</b> 种
        </span>
        {!isSuper ? (
          <span className="rounded-lg bg-gray-100 px-3 py-1 text-xs text-gray-600">
            当前角色只读，配件参数仅 super_admin 可修改
          </span>
        ) : null}
      </div>

      {partsQuery.error ? (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          {errText(partsQuery.error, '配件目录加载失败')}
        </div>
      ) : null}

      {partsQuery.isLoading ? (
        <Card>
          <div className="p-6 text-sm text-gray-400">加载中…</div>
        </Card>
      ) : (
        slots.map((slot) => (
          <Card key={slot.slot} className="mb-4">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-900">{slot.label}</span>
                <span className="font-mono text-xs text-gray-400">{slot.slot}</span>
              </div>
              <span className="text-xs text-gray-400">{slot.parts.length} 个配件</span>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="th">配件</th>
                    <th className="th">权重</th>
                    <th className="th">稀有度</th>
                    <th className="th">状态</th>
                    {isSuper ? <th className="th text-right">操作</th> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {slot.parts.map((part) => {
                    const d = draftOf(part);
                    const dirty = Object.keys(patchOf(part)).length > 0;
                    return (
                      <tr key={part.id}>
                        <td className="td">
                          <div className="font-medium text-gray-900">{part.name}</div>
                          <div className="mt-0.5 font-mono text-xs text-gray-400">{part.id}</div>
                        </td>
                        <td className="td">
                          <Input
                            type="number"
                            min="1"
                            max="100"
                            step="1"
                            className="w-24"
                            value={d.weight}
                            disabled={!isSuper}
                            onChange={(e) => setDraftField(part.id, { weight: e.target.value })}
                          />
                        </td>
                        <td className="td">
                          <select
                            className="input w-32"
                            value={d.rarity}
                            disabled={!isSuper}
                            onChange={(e) =>
                              setDraftField(part.id, { rarity: e.target.value as CharacterRarity })
                            }
                          >
                            {rarityOptions.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="td">
                          <div className="flex items-center gap-2">
                            <select
                              className="input w-28"
                              value={d.status}
                              disabled={!isSuper}
                              onChange={(e) =>
                                setDraftField(part.id, {
                                  status: e.target.value as CharacterPartStatus,
                                })
                              }
                            >
                              {statusOptions.map((s) => (
                                <option key={s} value={s}>
                                  {s === 'enabled' ? '启用' : '停用'}
                                </option>
                              ))}
                            </select>
                          </div>
                        </td>
                        {isSuper ? (
                          <td className="td text-right">
                            <Button
                              variant="primary"
                              disabled={!dirty || saveMutation.isPending}
                              onClick={() => requestSave(part)}
                            >
                              保存
                            </Button>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                  {slot.parts.length === 0 ? (
                    <tr>
                      <td colSpan={isSuper ? 5 : 4}>
                        <EmptyState text="该槽位暂无配件" />
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Card>
        ))
      )}

      <h2 className="mt-8 mb-3 text-base font-semibold text-gray-900">批量生成</h2>
      <Card className="mb-4">
        <form
          className="space-y-4 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            submitBatch();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">数量（1-200）</label>
              <Input
                type="number"
                min="1"
                max="200"
                step="1"
                value={count}
                onChange={(e) => setCount(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">风格</label>
              <Input
                value={style}
                placeholder="anime"
                onChange={(e) => setStyle(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">起始 seed（可选）</label>
              <Input
                type="number"
                min="0"
                step="1"
                value={seedStart}
                placeholder="留空则随机"
                onChange={(e) => setSeedStart(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">批次名（可选）</label>
              <Input
                value={batchName}
                maxLength={64}
                placeholder="如：万圣节主题"
                onChange={(e) => setBatchName(e.target.value)}
              />
            </div>
          </div>

          {formError ? <div className="text-sm text-red-600">{formError}</div> : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-gray-400">
              批量渲染为串行合成，单批最多 200 版；数量越大耗时越长（最长约 90 秒）。
            </p>
            <div className="flex items-center gap-3">
              {createMutation.isPending ? (
                <span className="animate-pulse text-sm text-blue-600">
                  正在渲染 {count} 张形象，请勿关闭页面…
                </span>
              ) : null}
              <Button
                variant="primary"
                type="submit"
                disabled={!isSuper || createMutation.isPending}
              >
                {createMutation.isPending ? '生成中…' : '开始生成'}
              </Button>
            </div>
          </div>
          {!isSuper ? (
            <p className="text-xs text-gray-500">批量生成仅 super_admin 可执行。</p>
          ) : null}
        </form>
      </Card>

      {shownBatch ? (
        <Card className="mb-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-gray-900">{shownBatch.name}</div>
              <div className="mt-0.5 text-xs text-gray-400">
                共 {shownBatch.count} 条 · {fmtTime(shownBatch.createdAt)}
                {shownBatch.style ? ` · 风格 ${shownBatch.style}` : ''}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {shownBatch.sheetUrl ? (
                <a
                  className="text-sm text-blue-600 hover:underline"
                  href={shownBatch.sheetUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  查看联系表大图
                </a>
              ) : null}
              <Button
                variant="secondary"
                onClick={() => {
                  setResult(null);
                  setSelectedId(null);
                }}
              >
                关闭
              </Button>
            </div>
          </div>
          {detailQuery.isLoading && selectedId ? (
            <div className="p-6 text-sm text-gray-400">批次详情加载中…</div>
          ) : detailQuery.error && selectedId ? (
            <div className="p-4 text-sm text-red-600">
              {errText(detailQuery.error, '批次详情加载失败')}
            </div>
          ) : (
            <BatchGrid batch={shownBatch} />
          )}
        </Card>
      ) : null}

      <h3 className="mb-3 text-sm font-semibold text-gray-900">最近批次</h3>
      <Card>
        {batchesQuery.error ? (
          <div className="p-6 text-sm text-red-600">
            {errText(batchesQuery.error, '批次列表加载失败')}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="th">批次</th>
                  <th className="th">风格</th>
                  <th className="th text-right">数量</th>
                  <th className="th">创建时间</th>
                  <th className="th">联系表</th>
                  <th className="th text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {batchesQuery.isLoading ? (
                  <tr>
                    <td className="td text-gray-400" colSpan={6}>
                      加载中…
                    </td>
                  </tr>
                ) : batchesQuery.data && batchesQuery.data.length > 0 ? (
                  batchesQuery.data.map((batch) => {
                    const id = batchIdOf(batch);
                    return (
                      <tr key={id}>
                        <td className="td">
                          <div className="font-medium text-gray-900">{batch.name || '未命名批次'}</div>
                          <div className="mt-0.5 font-mono text-xs text-gray-400">{id}</div>
                        </td>
                        <td className="td text-gray-600">{batch.style || '—'}</td>
                        <td className="td text-right tabular-nums text-gray-700">{batch.count}</td>
                        <td className="td whitespace-nowrap text-xs text-gray-500">
                          {fmtTime(batch.createdAt)}
                        </td>
                        <td className="td">
                          {batch.sheetUrl ? (
                            <a
                              className="text-xs text-blue-600 hover:underline"
                              href={batch.sheetUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              联系表大图
                            </a>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </td>
                        <td className="td text-right">
                          <Button
                            variant="secondary"
                            disabled={!id}
                            onClick={() => {
                              setResult(null);
                              setSelectedId(id);
                            }}
                          >
                            查看详情
                          </Button>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6}>
                      <EmptyState text="暂无批次" />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={!!pending}
        title="确认保存配件参数？"
        description={
          pending ? (
            <span>
              配件：<b>{pending.part.name}</b>（
              <span className="font-mono text-xs">{pending.part.slot}</span>）
              <br />
              修改内容：
              {pending.body.weight !== undefined ? ` 权重 ${pending.part.weight} → ${pending.body.weight}` : ''}
              {pending.body.rarity !== undefined ? ` 稀有度 ${pending.part.rarity} → ${pending.body.rarity}` : ''}
              {pending.body.status !== undefined
                ? ` 状态 ${pending.part.status} → ${pending.body.status}`
                : ''}
              <br />
              该操作会立即影响后继批量生成的组合空间，并记录审计日志。
            </span>
          ) : null
        }
        confirmText="确认保存"
        danger={false}
        loading={saveMutation.isPending}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (pending) saveMutation.mutate(pending);
        }}
      />
    </div>
  );
}
