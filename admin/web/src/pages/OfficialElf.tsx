import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createOfficialElf,
  errText,
  fetchOfficialElves,
  updateOfficialElf,
  uploadAsset,
  type AssetUploadResult,
  type OfficialElfCreateResult,
  type OfficialElfFields,
  type OfficialElfRow,
  type OfficialListingInput,
} from '../api/client';
import { useEnv } from '../env/EnvContext';
import { Badge, Button, Card, EmptyState, Input, PageHeader, Textarea } from '../components/ui/primitives';

const EMPTY: OfficialElfFields = {
  name: '',
  nickname: '',
  initial: '',
  tagline: '',
  intro: '',
  persona: '',
  fear: '',
  habit: '',
  generation: 1,
  edition: '官方首发',
  baseCapacity: 3,
  learnedSkills: [],
  avatarUrl: '',
  portraitUrl: '',
  series: [],
  officialNote: '',
};

// 与素材包 config/character.json 对齐，便于一键跑通运营流程
const PRESET: OfficialElfFields = {
  name: '鲸凌',
  nickname: '鲸鱼娘',
  initial: '鲸',
  tagline: '把整片海，说给你听。',
  intro:
    '从深潮里浮上来的声音收藏者。白天收集人类掉进海里的心事，夜里把她们编成节目、短片和文字，再轻轻放回水面。',
  persona: '相信潮水会记住每一次认真说话。',
  fear: '怕热闹散场以后，没人记得她说过什么。',
  habit: '开口前先用指节轻轻敲两下贝壳麦克风。',
  generation: 1,
  edition: '官方首发',
  baseCapacity: 3,
  learnedSkills: ['voice', 'writing', 'rhythm'],
  avatarUrl: '',
  portraitUrl: '',
  series: [
    {
      id: 'radio',
      name: '鲸歌电台',
      format: 'audio',
      coverUrl: '',
      cadence: '每周三 22:00',
      desc: '深夜海里的一档声音节目。念听众投递的心事，配一段潮声与低音贝斯。',
    },
    {
      id: 'night',
      name: '深夜短片',
      format: 'video',
      coverUrl: '',
      cadence: '每周五 23:30',
      desc: '竖屏氛围短片。把一条城市夜路拍成海沟下潜，结尾留一句不解释的旁白。',
    },
    {
      id: 'tide',
      name: '潮汐图文',
      format: 'text',
      coverUrl: '',
      cadence: '每日 07:30',
      desc: '每天一条潮位播报：把一件小事写成可以收进口袋的句子，配一张海面留白图。',
    },
  ],
  officialNote: 'OpenElf 官方首发内容型 AI；仅授权内部测试，授权落地前不得对外发布。',
};

const PRESET_LISTING: OfficialListingInput = {
  enabled: true,
  price: 4800,
  title: '鲸凌 · 官方首发',
  subtitle: '官方首发',
  note: 'ELF-W01',
};

export default function OfficialElf() {
  const { env } = useEnv();
  const queryClient = useQueryClient();
  const [fields, setFields] = useState<OfficialElfFields>(EMPTY);
  const [skillsText, setSkillsText] = useState('');
  const [listing, setListing] = useState<OfficialListingInput>(PRESET_LISTING);
  const [objectId, setObjectId] = useState('');
  const [assets, setAssets] = useState<AssetUploadResult[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<OfficialElfCreateResult | null>(null);

  const { data: official } = useQuery({
    queryKey: ['official-elves', env],
    queryFn: () => fetchOfficialElves(env),
  });

  function update<K extends keyof OfficialElfFields>(key: K, value: OfficialElfFields[K]) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  function setSeriesCover(id: string, url: string) {
    setFields((prev) => ({
      ...prev,
      series: prev.series.map((s) => (s.id === id ? { ...s, coverUrl: url } : s)),
    }));
  }

  function applyAsset(url: string, filename = '') {
    const n = filename.toLowerCase();
    if (n.includes('avatar')) update('avatarUrl', url);
    else if (n.includes('portrait')) update('portraitUrl', url);
    else if (n.includes('radio')) setSeriesCover('radio', url);
    else if (n.includes('night')) setSeriesCover('night', url);
    else if (n.includes('tide')) setSeriesCover('tide', url);
  }

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError('');
    setMessage('');
    for (const file of Array.from(files)) {
      try {
        const res = await uploadAsset(file);
        setAssets((prev) => [res, ...prev]);
        applyAsset(res.url, file.name);
        setMessage(`已上传 ${file.name}（${(res.bytes / 1024).toFixed(0)} KB）`);
      } catch (err) {
        setError(errText(err, `上传 ${file.name} 失败`));
      }
    }
    setUploading(false);
  }

  function loadPreset() {
    setFields(PRESET);
    setSkillsText(PRESET.learnedSkills.join(', '));
    setListing(PRESET_LISTING);
    setEditingId(null);
    setObjectId('');
    setMessage('已载入鲸凌预设，请先上传素材填入形象与栏目封面');
    setError('');
    setResult(null);
  }

  function loadForEdit(row: OfficialElfRow) {
    const p = row.payload as Record<string, unknown>;
    const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
    const num = (v: unknown, fallback: number) =>
      typeof v === 'number' && Number.isFinite(v) ? v : fallback;
    const skills = Array.isArray(p.learnedSkills)
      ? p.learnedSkills.filter((s): s is string => typeof s === 'string')
      : [];
    const series = Array.isArray(p.series)
      ? (p.series as Record<string, unknown>[]).map((s) => ({
          id: str(s.id),
          name: str(s.name),
          format: str(s.format, 'text'),
          coverUrl: str(s.coverUrl),
          cadence: str(s.cadence),
          desc: str(s.desc),
        }))
      : PRESET.series;
    setFields({
      name: str(p.name),
      nickname: str(p.nickname),
      initial: str(p.initial),
      tagline: str(p.tagline),
      intro: str(p.intro),
      persona: str(p.persona),
      fear: str(p.fear),
      habit: str(p.habit),
      generation: num(p.generation, 1),
      edition: str(p.edition, '官方首发'),
      baseCapacity: num(p.baseCapacity ?? p.slots, 3),
      learnedSkills: skills,
      avatarUrl: str(p.avatarUrl),
      portraitUrl: str(p.portraitUrl),
      series,
      officialNote: str(p.officialNote),
    });
    setSkillsText(skills.join(', '));
    setEditingId(row.object_id);
    setObjectId('');
    setMessage(`正在编辑 ${row.object_id}；编辑模式不修改一级挂单`);
    setError('');
    setResult(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditingId(null);
    setMessage('');
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
    setResult(null);

    const skills = skillsText
      .split(/[,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const body: OfficialElfFields = { ...fields, learnedSkills: skills };

    setSubmitting(true);
    try {
      if (editingId) {
        await updateOfficialElf(editingId, { ...body, environment: env });
        setMessage(`已更新官方建档 ${editingId}`);
      } else {
        const res = await createOfficialElf({
          ...body,
          environment: env,
          object_id: objectId.trim() || undefined,
          listing,
        });
        setResult(res);
        setMessage(`建档成功：${res.object_id}`);
      }
      await queryClient.invalidateQueries({ queryKey: ['official-elves', env] });
      void queryClient.invalidateQueries({ queryKey: ['elves'] });
    } catch (err) {
      setError(errText(err, '提交失败'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="官方 AI 运营"
        desc="上传素材 → 创建官方建档 → 一级市场挂单；本期只在后台侧生效，App 读取为第二阶段"
      />

      <Card className="p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">1. 素材上传</h2>
            <p className="mt-1 text-xs text-gray-400">
              仅 png / jpg / webp，单文件 ≤ 5MB；按内容 SHA256 命名，重复上传不产生副本
            </p>
          </div>
          <label className={`btn-secondary ${uploading ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
            {uploading ? '上传中…' : '选择文件（可多选）'}
            <input
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                void onFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
        </div>

        {assets.length === 0 ? (
          <EmptyState text="还没有上传素材，先选择素材包里的 visual 目录文件" />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {assets.map((a) => (
              <div key={a.name} className="flex gap-3 rounded-lg border border-gray-200 p-3">
                <img src={a.url} alt={a.name} className="h-20 w-20 shrink-0 rounded-md object-cover" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-[11px] text-gray-500" title={a.name}>
                    {a.name}
                  </div>
                  <div className="mt-1 text-xs text-gray-400">
                    {(a.bytes / 1024).toFixed(0)} KB · {a.mime}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Button variant="ghost" onClick={() => update('avatarUrl', a.url)}>
                      头像
                    </Button>
                    <Button variant="ghost" onClick={() => update('portraitUrl', a.url)}>
                      立绘
                    </Button>
                    <Button variant="ghost" onClick={() => setSeriesCover('radio', a.url)}>
                      电台
                    </Button>
                    <Button variant="ghost" onClick={() => setSeriesCover('night', a.url)}>
                      短片
                    </Button>
                    <Button variant="ghost" onClick={() => setSeriesCover('tide', a.url)}>
                      图文
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <form onSubmit={onSubmit} className="space-y-6">
        <Card className="p-6">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">2. 角色字段</h2>
              <p className="mt-1 text-xs text-gray-400">
                人格三字段只影响自动运营的能力权重，人类手动指挥始终优先
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" type="button" onClick={loadPreset}>
                载入鲸凌预设
              </Button>
              {editingId ? (
                <Button variant="ghost" type="button" onClick={cancelEdit}>
                  取消编辑
                </Button>
              ) : null}
            </div>
          </div>

          {editingId ? (
            <div className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              编辑模式：{editingId}。只更新官方字段与栏目，不改变所有权、状态与挂单。
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-3">
            <Field label="名称">
              <Input value={fields.name} onChange={(e) => update('name', e.target.value)} required />
            </Field>
            <Field label="昵称">
              <Input value={fields.nickname} onChange={(e) => update('nickname', e.target.value)} />
            </Field>
            <Field label="首字">
              <Input
                value={fields.initial}
                maxLength={4}
                onChange={(e) => update('initial', e.target.value)}
              />
            </Field>
            <Field label="版本">
              <Input value={fields.edition} onChange={(e) => update('edition', e.target.value)} />
            </Field>
            <Field label="代数">
              <Input
                type="number"
                min={1}
                value={fields.generation}
                onChange={(e) => update('generation', Number(e.target.value) || 1)}
              />
            </Field>
            <Field label="基础学习位">
              <Input
                type="number"
                min={1}
                max={12}
                value={fields.baseCapacity}
                onChange={(e) => update('baseCapacity', Number(e.target.value) || 1)}
              />
            </Field>
            <Field label="一句话简介" className="md:col-span-3">
              <Input value={fields.tagline} onChange={(e) => update('tagline', e.target.value)} />
            </Field>
            <Field label="详细简介" className="md:col-span-3">
              <Textarea value={fields.intro} onChange={(e) => update('intro', e.target.value)} />
            </Field>
            <Field label="相信（人格）">
              <Textarea value={fields.persona} onChange={(e) => update('persona', e.target.value)} />
            </Field>
            <Field label="害怕（人格）">
              <Textarea value={fields.fear} onChange={(e) => update('fear', e.target.value)} />
            </Field>
            <Field label="习惯（人格）">
              <Textarea value={fields.habit} onChange={(e) => update('habit', e.target.value)} />
            </Field>
            <Field label="已学技能（逗号分隔）" className="md:col-span-2">
              <Input
                value={skillsText}
                placeholder="voice, writing, rhythm"
                onChange={(e) => setSkillsText(e.target.value)}
              />
            </Field>
            <Field label="官方备注">
              <Input
                value={fields.officialNote}
                onChange={(e) => update('officialNote', e.target.value)}
              />
            </Field>
            <Field label="形象头像 URL">
              <Input value={fields.avatarUrl} onChange={(e) => update('avatarUrl', e.target.value)} />
            </Field>
            <Field label="立绘 URL">
              <Input value={fields.portraitUrl} onChange={(e) => update('portraitUrl', e.target.value)} />
            </Field>
            <Field label="自定义 object_id（可选）">
              <Input
                value={objectId}
                placeholder="留空自动生成"
                disabled={!!editingId}
                onChange={(e) => setObjectId(e.target.value)}
              />
            </Field>
          </div>

          {(fields.avatarUrl || fields.portraitUrl) && (
            <div className="mt-4 flex gap-4">
              {fields.avatarUrl ? (
                <img
                  src={fields.avatarUrl}
                  alt="头像预览"
                  className="h-24 w-24 rounded-xl object-cover"
                />
              ) : null}
              {fields.portraitUrl ? (
                <img
                  src={fields.portraitUrl}
                  alt="立绘预览"
                  className="h-24 w-24 rounded-xl object-cover"
                />
              ) : null}
            </div>
          )}
        </Card>

        <Card className="p-6">
          <h2 className="text-sm font-semibold text-gray-900">3. 栏目</h2>
          <p className="mt-1 mb-4 text-xs text-gray-400">
            本期复用内容形态 audio / video / text，不新增能力包
          </p>
          {fields.series.length === 0 ? (
            <EmptyState text="暂无栏目，点上方「载入鲸凌预设」" />
          ) : (
            <div className="grid gap-4 lg:grid-cols-3">
              {fields.series.map((s, i) => (
                <div key={`${s.id}-${i}`} className="rounded-lg border border-gray-200 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900">{s.name || '(未命名)'}</span>
                    <Badge tone="gray">{s.format}</Badge>
                  </div>
                  <div className="space-y-3">
                    <Field label="栏目名">
                      <Input
                        value={s.name}
                        onChange={(e) =>
                          update(
                            'series',
                            fields.series.map((x, j) =>
                              j === i ? { ...x, name: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    </Field>
                    <Field label="更新节奏">
                      <Input
                        value={s.cadence}
                        onChange={(e) =>
                          update(
                            'series',
                            fields.series.map((x, j) =>
                              j === i ? { ...x, cadence: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    </Field>
                    <Field label="封面 URL">
                      <Input
                        value={s.coverUrl}
                        onChange={(e) =>
                          update(
                            'series',
                            fields.series.map((x, j) =>
                              j === i ? { ...x, coverUrl: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    </Field>
                    <Field label="简介">
                      <Textarea
                        rows={2}
                        value={s.desc}
                        onChange={(e) =>
                          update(
                            'series',
                            fields.series.map((x, j) =>
                              j === i ? { ...x, desc: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    </Field>
                    {s.coverUrl ? (
                      <img
                        src={s.coverUrl}
                        alt={s.name}
                        className="h-28 w-full rounded-md object-cover"
                      />
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-6">
          <h2 className="text-sm font-semibold text-gray-900">4. 一级市场挂单</h2>
          <p className="mt-1 mb-4 text-xs text-gray-400">
            10 钻石 = 1 元；官方自持 AI 收益全部归平台。编辑模式下不修改挂单。
          </p>
          <label className="mb-4 flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={listing.enabled}
              disabled={!!editingId}
              onChange={(e) => setListing((prev) => ({ ...prev, enabled: e.target.checked }))}
            />
            启用一级市场挂单
          </label>
          <div className="grid gap-4 md:grid-cols-4">
            <Field label="价格（钻石）">
              <Input
                type="number"
                min={1}
                value={listing.price}
                disabled={!!editingId || !listing.enabled}
                onChange={(e) => setListing((prev) => ({ ...prev, price: Number(e.target.value) || 0 }))}
              />
            </Field>
            <Field label="挂单标题">
              <Input
                value={listing.title}
                disabled={!!editingId || !listing.enabled}
                onChange={(e) => setListing((prev) => ({ ...prev, title: e.target.value }))}
              />
            </Field>
            <Field label="副标题">
              <Input
                value={listing.subtitle}
                disabled={!!editingId || !listing.enabled}
                onChange={(e) => setListing((prev) => ({ ...prev, subtitle: e.target.value }))}
              />
            </Field>
            <Field label="备注">
              <Input
                value={listing.note}
                disabled={!!editingId || !listing.enabled}
                onChange={(e) => setListing((prev) => ({ ...prev, note: e.target.value }))}
              />
            </Field>
          </div>
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" type="submit" disabled={submitting}>
            {submitting ? '提交中…' : editingId ? '保存官方字段' : '创建官方建档并挂单'}
          </Button>
          <span className="text-xs text-gray-400">当前环境：{env === 'Production' ? '生产' : '沙箱'}</span>
        </div>

        {message ? <div className="text-sm text-green-600">{message}</div> : null}
        {error ? <div className="text-sm text-red-600">{error}</div> : null}

        {result ? (
          <Card className="border-blue-200 bg-blue-50 p-4 text-sm">
            <div className="font-medium text-gray-900">建档完成</div>
            <div className="mt-2 grid grid-cols-[7rem_1fr] gap-y-1 text-xs">
              <span className="text-gray-500">object_id</span>
              <span className="break-all font-mono text-gray-700">{result.object_id}</span>
              <span className="text-gray-500">listing_id</span>
              <span className="break-all font-mono text-gray-700">
                {result.listing_id || '未挂单'}
              </span>
            </div>
            <Link
              to={`/elves/${result.object_id}`}
              className="mt-2 inline-block text-xs text-blue-600 hover:underline"
            >
              查看精灵详情 →
            </Link>
          </Card>
        ) : null}
      </form>

      <Card>
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">已建档的官方 AI</h2>
            <p className="mt-1 text-xs text-gray-400">当前环境：{env}</p>
          </div>
          <Badge tone="blue">{official?.total ?? 0} 个</Badge>
        </div>
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="th">Object ID</th>
              <th className="th">名称</th>
              <th className="th">栏目</th>
              <th className="th">挂单</th>
              <th className="th">更新时间</th>
              <th className="th text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {official && official.items.length > 0 ? (
              official.items.map((row) => {
                const p = row.payload as Record<string, unknown>;
                const series = Array.isArray(p.series) ? (p.series as Record<string, unknown>[]) : [];
                const price =
                  row.listing && typeof row.listing.price === 'number'
                    ? (row.listing.price as number)
                    : null;
                return (
                  <tr key={row.object_id}>
                    <td className="td font-mono text-xs text-gray-400" title={row.object_id}>
                      {row.object_id.slice(0, 16)}
                      {row.object_id.length > 16 ? '…' : ''}
                    </td>
                    <td className="td whitespace-nowrap font-medium text-gray-900">
                      {typeof p.name === 'string' ? p.name : '(未命名)'}
                      <span className="ml-2">
                        <Badge tone="blue">官方</Badge>
                      </span>
                    </td>
                    <td className="td text-xs text-gray-600">{series.length} 个</td>
                    <td className="td text-xs text-gray-600">
                      {price === null ? '未挂单' : `${price} 钻石`}
                    </td>
                    <td className="td whitespace-nowrap text-xs text-gray-500">
                      {row.updated_at
                        ? new Date(row.updated_at).toLocaleString('zh-CN', { hour12: false })
                        : '—'}
                    </td>
                    <td className="td space-x-1 text-right">
                      <Button variant="ghost" onClick={() => loadForEdit(row)}>
                        编辑
                      </Button>
                      <Link to={`/elves/${row.object_id}`} className="btn-secondary inline-block">
                        详情
                      </Link>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={6}>
                  <EmptyState text="还没有官方建档" />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Field({
  label,
  className = '',
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs text-gray-500">{label}</span>
      {children}
    </label>
  );
}
