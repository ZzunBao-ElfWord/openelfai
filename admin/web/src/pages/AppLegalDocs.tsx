import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  archiveAppDocument,
  createAppDocument,
  errText,
  fetchAppDocument,
  fetchAppDocuments,
  publishAppDocument,
  updateAppDocument,
  type AppDocument,
} from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Textarea } from '../components/ui/primitives';
import ConfirmDialog from '../components/ui/ConfirmDialog';

const slugOptions = [
  { slug: 'privacy', label: '隐私政策' },
  { slug: 'terms', label: '用户协议' },
  { slug: 'community', label: '社区规范' },
];

const statusLabel: Record<AppDocument['status'], string> = {
  draft: '草稿',
  published: '已发布',
  archived: '已归档',
};

const statusTone: Record<AppDocument['status'], 'green' | 'amber' | 'gray'> = {
  draft: 'amber',
  published: 'green',
  archived: 'gray',
};

function fmtTime(v: number): string {
  if (!v) return '—';
  return new Date(v).toLocaleString('zh-CN', { hour12: false });
}

// datetime-local -> 毫秒时间戳；空值返回 null
function toEpoch(value: string): number | null {
  if (!value.trim()) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function toLocalInput(v: number): string {
  if (!v) return '';
  const d = new Date(v);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type Editor = {
  id?: string;
  slug: string;
  title: string;
  content: string;
  effectiveAt: string;
  version?: number;
};

const emptyEditor: Editor = { slug: 'privacy', title: '隐私政策', content: '', effectiveAt: '' };

type Notice = { tone: 'green' | 'red'; text: string };

export default function AppLegalDocs() {
  const { me } = useAuth();
  const isSuper = me?.role === 'super_admin';
  const queryClient = useQueryClient();

  const [editor, setEditor] = useState<Editor | null>(null);
  const [editorError, setEditorError] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [publishing, setPublishing] = useState<AppDocument | null>(null);
  const [archiving, setArchiving] = useState<AppDocument | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['app-documents'],
    queryFn: fetchAppDocuments,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!editor) {
        throw new Error('no editor');
      }
      if (!editor.title.trim()) {
        throw new Error('标题不能为空');
      }
      if (editor.id) {
        return updateAppDocument(editor.id, {
          title: editor.title.trim(),
          content: editor.content,
          effective_at: toEpoch(editor.effectiveAt),
        });
      }
      return createAppDocument({
        slug: editor.slug,
        title: editor.title.trim(),
        content: editor.content,
        effective_at: toEpoch(editor.effectiveAt),
      });
    },
    onSuccess: () => {
      setEditor(null);
      setEditorError('');
      setNotice({ tone: 'green', text: '草稿已保存' });
      void queryClient.invalidateQueries({ queryKey: ['app-documents'] });
    },
    onError: (err) => setEditorError(errText(err, '保存失败')),
  });

  const publishMutation = useMutation({
    mutationFn: (doc: AppDocument) => publishAppDocument(doc.id),
    onSuccess: (_, doc) => {
      setPublishing(null);
      setNotice({ tone: 'green', text: `${doc.title} v${doc.version} 已发布，App 将在 60 秒内生效` });
      void queryClient.invalidateQueries({ queryKey: ['app-documents'] });
    },
    onError: (err) => {
      setPublishing(null);
      setNotice({ tone: 'red', text: errText(err, '发布失败') });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (doc: AppDocument) => archiveAppDocument(doc.id),
    onSuccess: (_, doc) => {
      setArchiving(null);
      setNotice({ tone: 'green', text: `${doc.title} v${doc.version} 已下线` });
      void queryClient.invalidateQueries({ queryKey: ['app-documents'] });
    },
    onError: (err) => {
      setArchiving(null);
      setNotice({ tone: 'red', text: errText(err, '下线失败') });
    },
  });

  const copyMutation = useMutation({
    mutationFn: async (doc: AppDocument) => {
      const detail = await fetchAppDocument(doc.id);
      return createAppDocument({
        slug: doc.slug,
        title: doc.title,
        content: detail.content,
      });
    },
    onSuccess: (_, doc) => {
      setNotice({ tone: 'green', text: `已基于 ${doc.title} v${doc.version} 新建草稿` });
      void queryClient.invalidateQueries({ queryKey: ['app-documents'] });
    },
    onError: (err) => setNotice({ tone: 'red', text: errText(err, '复制失败') }),
  });

  function openCreate(slug = 'privacy') {
    const opt = slugOptions.find((s) => s.slug === slug);
    setEditor({ ...emptyEditor, slug, title: opt?.label ?? '' });
    setEditorError('');
  }

  async function openEdit(doc: AppDocument) {
    setEditorError('');
    try {
      const detail = await fetchAppDocument(doc.id);
      setEditor({
        id: doc.id,
        slug: doc.slug,
        title: doc.title,
        content: detail.content,
        effectiveAt: toLocalInput(doc.effective_at),
        version: doc.version,
      });
    } catch (err) {
      setNotice({ tone: 'red', text: errText(err, '读取文档失败') });
    }
  }

  const latestBySlug = new Map<string, AppDocument>();
  for (const doc of data?.items ?? []) {
    if (!latestBySlug.has(doc.slug)) latestBySlug.set(doc.slug, doc);
  }

  const isDraftOnly = editor?.id && data?.items.find((d) => d.id === editor.id)?.status !== 'draft';

  return (
    <div>
      <PageHeader
        title="法律与政策"
        desc="App 设置页的政策文档；发布即生成新版本并自动归档旧版本，App 60 秒内生效"
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2 text-sm text-gray-500">
          {slugOptions.map((s) => {
            const latest = latestBySlug.get(s.slug);
            return (
              <span key={s.slug} className="rounded-md bg-gray-100 px-2.5 py-1">
                {s.label}：{latest ? `v${latest.version} · ${statusLabel[latest.status]}` : '暂无版本'}
              </span>
            );
          })}
        </div>
        <Button variant="primary" onClick={() => openCreate()}>
          新建草稿
        </Button>
      </div>

      {notice ? (
        <div
          className={`mb-4 rounded-lg px-4 py-3 text-sm ${
            notice.tone === 'green' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
          }`}
        >
          {notice.text}
        </div>
      ) : null}

      <Card>
        {error ? (
          <div className="p-6 text-sm text-red-600">{errText(error, '文档加载失败')}</div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="th">文档</th>
                <th className="th">版本</th>
                <th className="th">状态</th>
                <th className="th">生效时间</th>
                <th className="th">更新时间</th>
                <th className="th">发布人</th>
                <th className="th text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr>
                  <td className="td text-gray-400" colSpan={7}>
                    加载中…
                  </td>
                </tr>
              ) : data && data.items.length > 0 ? (
                data.items.map((doc) => (
                  <tr key={doc.id}>
                    <td className="td">
                      <div className="font-medium text-gray-900">{doc.title}</div>
                      <div className="mt-0.5 font-mono text-xs text-gray-400">{doc.slug}</div>
                    </td>
                    <td className="td tabular-nums text-gray-700">v{doc.version}</td>
                    <td className="td">
                      <Badge tone={statusTone[doc.status]}>{statusLabel[doc.status]}</Badge>
                    </td>
                    <td className="td text-gray-600">{fmtTime(doc.effective_at)}</td>
                    <td className="td text-gray-600">{fmtTime(doc.updated_at)}</td>
                    <td className="td text-gray-600">{doc.published_by || '—'}</td>
                    <td className="td">
                      <div className="flex flex-wrap justify-end gap-2">
                        {doc.status === 'draft' ? (
                          <Button variant="secondary" onClick={() => void openEdit(doc)}>
                            编辑
                          </Button>
                        ) : null}
                        {doc.status === 'draft' && isSuper ? (
                          <Button variant="primary" onClick={() => setPublishing(doc)}>
                            发布
                          </Button>
                        ) : null}
                        {doc.status === 'published' && isSuper ? (
                          <Button variant="danger" onClick={() => setArchiving(doc)}>
                            下线
                          </Button>
                        ) : null}
                        {doc.status !== 'draft' ? (
                          <Button
                            variant="ghost"
                            disabled={copyMutation.isPending}
                            onClick={() => copyMutation.mutate(doc)}
                          >
                            复制为新草稿
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7}>
                    <EmptyState text="暂无文档，先新建一份草稿" />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </Card>

      <Modal
        open={!!editor}
        title={editor?.id ? `编辑草稿 — ${editor?.title ?? ''} v${editor?.version ?? ''}` : '新建文档草稿'}
        onClose={() => setEditor(null)}
        width="max-w-3xl"
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setEditorError('');
            saveMutation.mutate();
          }}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">文档类型</label>
              <select
                className="input w-full"
                value={editor?.slug ?? 'privacy'}
                disabled={!!editor?.id}
                onChange={(e) => {
                  const opt = slugOptions.find((s) => s.slug === e.target.value);
                  setEditor((prev) =>
                    prev ? { ...prev, slug: e.target.value, title: opt?.label ?? prev.title } : prev,
                  );
                }}
              >
                {slugOptions.map((s) => (
                  <option key={s.slug} value={s.slug}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">生效时间（可选）</label>
              <Input
                type="datetime-local"
                className="w-full"
                value={editor?.effectiveAt ?? ''}
                onChange={(e) =>
                  setEditor((prev) => (prev ? { ...prev, effectiveAt: e.target.value } : prev))
                }
              />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">标题</label>
            <Input
              className="w-full"
              value={editor?.title ?? ''}
              maxLength={64}
              onChange={(e) => setEditor((prev) => (prev ? { ...prev, title: e.target.value } : prev))}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">正文</label>
            <Textarea
              className="w-full font-mono"
              rows={16}
              placeholder="按空行分段。App 以纯文本按段落渲染，不使用 HTML。"
              value={editor?.content ?? ''}
              onChange={(e) =>
                setEditor((prev) => (prev ? { ...prev, content: e.target.value } : prev))
              }
            />
            <div className="mt-1 text-xs text-gray-400">
              共 {editor?.content.length ?? 0} 字；发布后 App 设置页直接渲染，不再依赖网页链接。
            </div>
          </div>
          {isDraftOnly ? (
            <div className="rounded-lg bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
              该版本已发布或已归档，不能直接编辑。请从列表「复制为新草稿」后再修改。
            </div>
          ) : null}
          {editorError ? <div className="text-sm text-red-600">{editorError}</div> : null}
          <div className="flex justify-end gap-3">
            <Button type="button" onClick={() => setEditor(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              disabled={saveMutation.isPending || !!isDraftOnly}
            >
              {saveMutation.isPending ? '保存中…' : '保存草稿'}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!publishing}
        title="发布政策文档"
        description={
          <>
            将发布 <b>{publishing?.title}</b> v{publishing?.version}，同类型已发布版本会自动归档。
            发布后 App 将在 60 秒内展示新正文。
          </>
        }
        confirmText="确认发布"
        danger={false}
        loading={publishMutation.isPending}
        onCancel={() => setPublishing(null)}
        onConfirm={() => publishing && publishMutation.mutate(publishing)}
      />

      <ConfirmDialog
        open={!!archiving}
        title="下线政策文档"
        description={
          <>
            下线 <b>{archiving?.title}</b> v{archiving?.version} 后，App 将回落到内置占位文案。
            该操作不会删除历史版本。
          </>
        }
        confirmText="确认下线"
        loading={archiveMutation.isPending}
        onCancel={() => setArchiving(null)}
        onConfirm={() => archiving && archiveMutation.mutate(archiving)}
      />
    </div>
  );
}
