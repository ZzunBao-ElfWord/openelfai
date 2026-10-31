import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  errText,
  fetchPlatformModels,
  fetchWorkBuddyPackages,
  postWorkBuddyChat,
  type WorkBuddyChatStep,
  type WorkBuddyPackage,
} from '../api/client';
import { Badge, Button, Card, EmptyState, Input, PageHeader, Textarea } from '../components/ui/primitives';

// WorkBuddy 上架：只读展示包清单、依赖与本地校验结果，以及 RELEASES.md 发布记录。
// 数据由 workbuddy/scripts/validate.mjs 产出，后台不提供写操作。

const KIND_LABEL: Record<string, string> = { expert: '专家', skill: '技能' };

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)}KB`;
  return `${n}B`;
}

function fmtTime(v: string): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString('zh-CN', { hour12: false });
}

function PackageCard({ pkg }: { pkg: WorkBuddyPackage }) {
  const connectors = pkg.dependencies?.connectors ?? [];
  const failedChecks = pkg.checks.filter((c) => !c.ok);
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-900">{pkg.name}</span>
            <Badge tone={pkg.kind === 'expert' ? 'blue' : 'green'}>
              {KIND_LABEL[pkg.kind] ?? pkg.kind}
            </Badge>
            <span className="font-mono text-xs text-gray-400">v{pkg.version || '?'}</span>
          </div>
          <div className="mt-1 text-xs text-gray-500">
            目录 <span className="font-mono">{pkg.dir}</span> · {pkg.files.length} 个文件
          </div>
        </div>
        {pkg.ok ? <Badge tone="green">校验通过</Badge> : <Badge tone="red">校验失败</Badge>}
      </div>

      <div className="mt-3 text-xs text-gray-600">
        依赖连接器：{connectors.length > 0 ? (
          <span className="font-mono">{connectors.join('、')}</span>
        ) : (
          <span className="text-gray-400">无</span>
        )}
      </div>

      <div className="mt-4">
        <div className="mb-2 text-xs font-medium text-gray-500">校验项</div>
        <ul className="space-y-1 text-xs">
          {pkg.checks.map((c) => (
            <li key={c.name} className="flex items-start gap-2">
              <span className={c.ok ? 'text-green-600' : 'text-red-600'}>{c.ok ? '✓' : '✗'}</span>
              <span className={c.ok ? 'text-gray-600' : 'text-red-600'}>
                {c.name}
                {!c.ok && c.message ? `：${c.message}` : ''}
              </span>
            </li>
          ))}
          {pkg.checks.length === 0 ? <li className="text-gray-400">无校验记录</li> : null}
        </ul>
      </div>

      <details className="mt-4 text-xs" open={failedChecks.length > 0}>
        <summary className="cursor-pointer text-gray-500">文件清单</summary>
        <table className="mt-2 min-w-full">
          <tbody>
            {pkg.files.map((f) => (
              <tr key={f.path} className="border-b border-gray-100 last:border-0">
                <td className="py-1 pr-3 font-mono text-gray-700">{f.path}</td>
                <td className="py-1 text-right tabular-nums text-gray-400">{fmtBytes(f.bytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </Card>
  );
}

// 调试台：用测试者的 OpenElf API Key 走真实 MCP 工具，模型走平台内部网关。
// 后端一次请求内完成「模型 → 工具 → 结果回填」循环，前端只负责展示。
type Turn = { role: 'user' | 'assistant'; content: string; steps?: WorkBuddyChatStep[] };

function StepBlock({ step }: { step: WorkBuddyChatStep }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex items-center gap-2 text-xs">
        <span className={step.ok ? 'text-green-600' : 'text-red-600'}>{step.ok ? '✓' : '✗'}</span>
        <span className="font-mono text-gray-700">{step.tool}</span>
        <span className="text-gray-400">第 {step.round} 轮</span>
        {!step.ok && step.error ? <span className="text-red-600">{step.error}</span> : null}
      </div>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-gray-400">参数与返回</summary>
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-gray-50 p-2 font-mono text-[11px] text-gray-600">
          {JSON.stringify({ arguments: step.arguments, result: step.result }, null, 2)}
        </pre>
      </details>
      {step.images.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {step.images.map((src, i) => (
            <img
              key={`${step.tool}-${i}`}
              src={src}
              alt="AI 生成预览"
              className="h-32 w-32 rounded-lg border border-gray-200 object-cover"
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ChatPanel({ skillNames }: { skillNames: string[] }) {
  const { data: modelsData } = useQuery({
    queryKey: ['platform-models'],
    queryFn: fetchPlatformModels,
  });
  const models = (modelsData?.items ?? []).filter((m) => m.status === 'active');

  const [apiKey, setApiKey] = useState(() => sessionStorage.getItem('wb_api_key') ?? '');
  const [source, setSource] = useState<'platform' | 'custom'>(
    () => (sessionStorage.getItem('wb_source') as 'platform' | 'custom') || 'platform',
  );
  const [model, setModel] = useState(() => sessionStorage.getItem('wb_model') ?? '');
  const [baseUrl, setBaseUrl] = useState(
    () => sessionStorage.getItem('wb_base_url') ?? 'https://tokenhub.tencentmaas.com/v1',
  );
  const [modelKey, setModelKey] = useState(() => sessionStorage.getItem('wb_model_key') ?? '');
  const [skill, setSkill] = useState(() => skillNames[0] ?? 'image-studio-skill');
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const activeModel = model || (source === 'custom' ? '' : models[0]?.model_id || '');

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    if (!apiKey.trim() || !activeModel) {
      setError('请先填写 API Key 与模型');
      return;
    }
    if (source === 'custom' && !modelKey.trim()) {
      setError('自定义模型通道需要填写模型密钥');
      return;
    }
    const history = [...turns.map((t) => ({ role: t.role, content: t.content })), { role: 'user' as const, content: text }];
    setTurns([...turns, { role: 'user', content: text }]);
    setInput('');
    setError('');
    setSending(true);
    sessionStorage.setItem('wb_api_key', apiKey.trim());
    sessionStorage.setItem('wb_source', source);
    sessionStorage.setItem('wb_model', activeModel);
    sessionStorage.setItem('wb_base_url', baseUrl.trim());
    sessionStorage.setItem('wb_model_key', modelKey.trim());
    try {
      const result = await postWorkBuddyChat({
        api_key: apiKey.trim(),
        model: activeModel,
        skill,
        base_url: source === 'custom' ? baseUrl.trim() : undefined,
        model_key: source === 'custom' ? modelKey.trim() : undefined,
        messages: history,
      });
      setTurns((prev) => [...prev, { role: 'assistant', content: result.reply, steps: result.steps }]);
    } catch (e) {
      setError(errText(e, '对话失败'));
    } finally {
      setSending(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-6 py-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">对话调试台</h2>
          <p className="mt-1 text-xs text-gray-500">
            用真实技能正文与 MCP 工具跑一轮对话；API Key 只保存在本浏览器会话，不落库
          </p>
        </div>
        <Button variant="ghost" onClick={() => setTurns([])} disabled={sending}>
          清空对话
        </Button>
      </div>

      <div className="grid gap-3 px-6 py-4 sm:grid-cols-2">
        <label className="text-xs text-gray-500">
          OpenElf API Key
          <Input
            className="mt-1"
            type="password"
            placeholder="oe-sk-..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </label>
        <label className="text-xs text-gray-500">
          模型通道
          <select
            className="input mt-1"
            value={source}
            onChange={(e) => setSource(e.target.value as 'platform' | 'custom')}
          >
            <option value="platform">平台内部网关</option>
            <option value="custom">自定义 OpenAI 兼容（测试）</option>
          </select>
        </label>
        {source === 'platform' ? (
          <label className="text-xs text-gray-500">
            模型
            <select
              className="input mt-1"
              value={activeModel}
              onChange={(e) => setModel(e.target.value)}
            >
              {models.length === 0 ? <option value="">暂无可用模型</option> : null}
              {models.map((m) => (
                <option key={m.model_id} value={m.model_id}>
                  {m.display_name || m.model_id}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label className="text-xs text-gray-500">
              接口地址
              <Input
                className="mt-1"
                placeholder="https://tokenhub.tencentmaas.com/v1"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </label>
            <label className="text-xs text-gray-500">
              模型 ID
              <Input
                className="mt-1"
                placeholder="hy4-preview"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </label>
            <label className="text-xs text-gray-500">
              模型密钥
              <Input
                className="mt-1"
                type="password"
                placeholder="sk-..."
                value={modelKey}
                onChange={(e) => setModelKey(e.target.value)}
              />
            </label>
          </>
        )}
        <label className="text-xs text-gray-500">
          调试技能
          <select className="input mt-1" value={skill} onChange={(e) => setSkill(e.target.value)}>
            {(skillNames.length > 0 ? skillNames : ['image-studio-skill']).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="space-y-4 px-6 pb-4">
        {turns.length === 0 ? (
          <EmptyState text="发一条消息开始：先让它给预览，再让它保存角色卡并生成正式形象" />
        ) : null}
        {turns.map((turn, idx) => (
          <div key={idx} className={turn.role === 'user' ? 'text-right' : ''}>
            <div
              className={`inline-block max-w-[90%] whitespace-pre-wrap rounded-xl px-4 py-2 text-left text-sm ${
                turn.role === 'user' ? 'bg-blue-50 text-gray-900' : 'bg-gray-50 text-gray-700'
              }`}
            >
              {turn.content}
            </div>
            {turn.steps && turn.steps.length > 0 ? (
              <div className="mt-2 space-y-2">
                {turn.steps.map((step, i) => (
                  <StepBlock key={`${idx}-${i}`} step={step} />
                ))}
              </div>
            ) : null}
          </div>
        ))}
        {error ? <div className="text-sm text-red-600">{error}</div> : null}
      </div>

      <div className="flex items-end gap-3 border-t border-gray-100 px-6 py-4">
        <Textarea
          className="flex-1"
          rows={2}
          placeholder="例如：我想做一只像素风的 AI 形象，先给我几版预览看看"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send();
          }}
        />
        <Button variant="primary" disabled={sending} onClick={() => void send()}>
          {sending ? '生成中…' : '发送'}
        </Button>
      </div>
    </Card>
  );
}

export default function WorkBuddy() {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['workbuddy-packages'],
    queryFn: fetchWorkBuddyPackages,
    refetchInterval: 60000,
  });

  const packages = data?.packages ?? [];
  const passed = packages.filter((p) => p.ok).length;
  const totalFiles = packages.reduce((s, p) => s + p.files.length, 0);

  return (
    <div>
      <PageHeader
        title="WorkBuddy 上架"
        desc="专家与技能包清单、依赖连接器与本地校验结果；只读展示，上传审核仍在 WorkBuddy 开放平台手工完成"
      />

      <div className="mb-4 flex items-center justify-between text-sm text-gray-500">
        <span>
          {data?.available ? (
            <>
              共 {packages.length} 个包，{passed === packages.length ? (
                <span className="text-green-600">全部通过校验</span>
              ) : (
                <span className="text-red-600">{packages.length - passed} 个未通过</span>
              )}
              {' · 清单生成 '}
              {fmtTime(data.generated_at)}
            </>
          ) : (
            '暂无校验清单'
          )}
        </span>
        <Button variant="secondary" disabled={isFetching} onClick={() => void refetch()}>
          {isFetching ? '刷新中…' : '立即刷新'}
        </Button>
      </div>

      {error ? (
        <Card className="p-6 text-sm text-red-600">{errText(error, '上架包清单加载失败')}</Card>
      ) : isLoading ? (
        <Card className="p-6 text-sm text-gray-400">加载中…</Card>
      ) : !data?.available ? (
        <Card className="p-6">
          <div className="text-sm text-gray-700">{data?.message || '尚未同步上架包目录'}</div>
          <div className="mt-3 text-xs text-gray-500">
            读取目录：<span className="font-mono">{data?.dir}</span>
            <br />
            先执行 <span className="font-mono">node scripts/validate.mjs</span> 生成 dist/manifest.json，
            再把 workbuddy 目录同步到上述路径。
          </div>
        </Card>
      ) : (
        <>
          <div className="mb-4 grid gap-4 sm:grid-cols-3">
            <Card className="p-5">
              <div className="text-xs text-gray-400">上架包</div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-gray-900">{packages.length}</div>
            </Card>
            <Card className="p-5">
              <div className="text-xs text-gray-400">校验通过</div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-gray-900">{passed}</div>
            </Card>
            <Card className="p-5">
              <div className="text-xs text-gray-400">文件总数</div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-gray-900">{totalFiles}</div>
            </Card>
          </div>

          <div className="mb-6 grid gap-4 lg:grid-cols-2">
            {packages.map((p) => (
              <PackageCard key={p.name} pkg={p} />
            ))}
            {packages.length === 0 ? (
              <Card>
                <EmptyState text="packages/ 下暂无上架包" />
              </Card>
            ) : null}
          </div>

          <Card>
            <div className="border-b border-gray-100 px-6 py-4">
              <h2 className="text-sm font-semibold text-gray-900">发布记录（RELEASES.md）</h2>
            </div>
            {data.releases ? (
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap px-6 py-4 font-mono text-xs leading-6 text-gray-600">
                {data.releases}
              </pre>
            ) : (
              <EmptyState text="未找到 RELEASES.md" />
            )}
          </Card>

          <div className="mt-6">
            <ChatPanel
              skillNames={packages.filter((p) => p.kind === 'skill').map((p) => p.name)}
            />
          </div>
        </>
      )}
    </div>
  );
}
