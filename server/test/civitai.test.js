'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createCivitaiService, assertCivitaiUrl } = require('../src/media/civitai');
const {
  createCivitaiFavorites, normalizeComfyName,
} = require('../src/media/civitai_favorites');
const { applyLoras, normalizeLoras, DEFAULT_WORKFLOW } = require('../src/media/comfy');

/// 只允许官方 API：避免外部资源抓取变成 SSRF 跳板。
test('只接受 Civitai 官方 https 地址', () => {
  assert.ok(assertCivitaiUrl('https://civitai.com/api/v1/models?limit=5'));
  assert.throws(() => assertCivitaiUrl('http://civitai.com/api/v1/models'), /官方 API/);
  assert.throws(() => assertCivitaiUrl('https://evil.example.com/api'), /官方 API/);
});

function createFakeFetch(payload, { status = 200 } = {}) {
  const calls = [];
  const impl = async (url) => {
    calls.push(String(url));
    return {
      ok: status >= 200 && status < 300,
      status,
      async text() { return JSON.stringify(payload); },
    };
  };
  impl.calls = calls;
  return impl;
}

test('搜索默认关闭 NSFW，并过滤掉标记为 NSFW 的条目', async () => {
  const payload = {
    items: [
      {
        id: 1, name: '动漫风格', type: 'LORA', nsfw: false, creator: { username: 'a' },
        stats: { downloadCount: 100 },
        modelVersions: [{ id: 11, name: 'v1', baseModel: 'SDXL 1.0', downloadUrl: 'https://civitai.com/u/1', images: [{ url: 'https://x/t.jpg' }] }],
      },
      { id: 2, name: '成人内容', type: 'LORA', nsfw: true, modelVersions: [] },
    ],
    metadata: { totalItems: 2 },
  };
  const fetchImpl = createFakeFetch(payload);
  const service = createCivitaiService({ fetchImpl });
  const result = await service.searchModels({ query: '动漫' });
  assert.equal(result.models.length, 1);
  assert.equal(result.models[0].id, 1);
  assert.equal(result.models[0].versions[0].baseModel, 'SDXL 1.0');
  assert.match(fetchImpl.calls[0], /nsfw=false/);
  assert.match(fetchImpl.calls[0], /query=/);
});

test('limit 被钳制在上限内，非白名单类型不转发', async () => {
  const fetchImpl = createFakeFetch({ items: [], metadata: { totalItems: 0 } });
  const service = createCivitaiService({ fetchImpl, cacheMs: 0 });
  await service.searchModels({ limit: 999, types: ['LORA', 'ControlNet'] });
  const url = new URL(fetchImpl.calls[0]);
  assert.equal(url.searchParams.get('limit'), '20');
  assert.equal(url.searchParams.get('types'), 'LORA');
});

test('相同查询命中缓存，不重复请求上游', async () => {
  const fetchImpl = createFakeFetch({ items: [], metadata: {} });
  const service = createCivitaiService({ fetchImpl, cacheMs: 60_000 });
  await service.searchModels({ query: '猫' });
  await service.searchModels({ query: '猫' });
  assert.equal(fetchImpl.calls.length, 1);
});

test('非正整数模型 ID 直接拒绝，上游错误透出', async () => {
  const service = createCivitaiService({ fetchImpl: createFakeFetch({}, { status: 500 }) });
  await assert.rejects(() => service.getModel('abc'), /模型 ID 无效/);
  await assert.rejects(() => service.getModel(1), /Civitai 返回 500/);
});

/// 最小内存库：覆盖收藏表。
function createMemoryDb() {
  const rows = new Map();
  return {
    rows,
    async execute(sql, params) {
      if (sql.includes('INSERT INTO civitai_favorites')) {
        const [id, userId, modelId, versionId, name, type, baseModel, downloadUrl, thumbUrl, comfyName, createdAt, updatedAt] = params;
        const hit = [...rows.values()].find(
          (row) => row.user_id === userId && row.model_id === modelId && row.version_id === versionId,
        );
        if (hit) {
          hit.name = name;
          hit.comfy_name = comfyName;
          hit.updated_at = updatedAt;
          return [{ affectedRows: 1 }, []];
        }
        rows.set(id, {
          id, user_id: userId, model_id: modelId, version_id: versionId, name, type,
          base_model: baseModel, download_url: downloadUrl, thumb_url: thumbUrl,
          comfy_name: comfyName, created_at: createdAt, updated_at: updatedAt,
        });
        return [{ affectedRows: 1 }, []];
      }
      if (sql.includes('DELETE FROM civitai_favorites')) {
        const [id, userId] = params;
        const row = rows.get(id);
        if (!row || row.user_id !== userId) return [{ affectedRows: 0 }, []];
        rows.delete(id);
        return [{ affectedRows: 1 }, []];
      }
      if (sql.includes('FROM civitai_favorites')) {
        const [userId] = params;
        return [[...rows.values()]
          .filter((row) => row.user_id === userId)
          .sort((a, b) => b.created_at - a.created_at), []];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

test('收藏 CRUD：重复收藏不新增行，删除按用户隔离', async () => {
  const db = createMemoryDb();
  const favorites = createCivitaiFavorites({ db });
  const first = await favorites.add('u_1', {
    modelId: 1, versionId: 11, name: '动漫风格', type: 'LORA',
    baseModel: 'SDXL 1.0', downloadUrl: 'https://civitai.com/u/1', comfyName: 'anime_v1.safetensors',
  });
  assert.equal(first.comfyName, 'anime_v1.safetensors');

  await favorites.add('u_1', { modelId: 1, versionId: 11, name: '动漫风格2', comfyName: 'anime_v2.safetensors' });
  assert.equal(db.rows.size, 1);
  assert.equal((await favorites.list('u_1'))[0].name, '动漫风格2');

  await assert.rejects(() => favorites.remove('u_2', first.id), /没有找到/);
  await favorites.remove('u_1', first.id);
  assert.equal((await favorites.list('u_1')).length, 0);
});

test('ComfyUI 模型名不允许路径穿越', () => {
  assert.equal(normalizeComfyName('anime_v1.safetensors'), 'anime_v1.safetensors');
  assert.equal(normalizeComfyName(''), '');
  assert.throws(() => normalizeComfyName('../../etc/passwd'), /路径分隔符/);
  assert.throws(() => normalizeComfyName('sub/dir.safetensors'), /路径分隔符/);
});

test('resolveLoras 只返回已填 ComfyUI 文件名的 LoRA 收藏', async () => {
  const db = createMemoryDb();
  const favorites = createCivitaiFavorites({ db });
  const withName = await favorites.add('u_1', { modelId: 1, name: 'A', type: 'LORA', comfyName: 'a.safetensors' });
  await favorites.add('u_1', { modelId: 2, name: 'B', type: 'LORA' });
  await favorites.add('u_1', { modelId: 3, name: 'C', type: 'Checkpoint', comfyName: 'c.safetensors' });

  const resolved = await favorites.resolveLoras('u_1', [withName.id, 'missing']);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].comfyName, 'a.safetensors');
});

test('LoRA 注入：model 与 clip 都串到 LoraLoader，顺序正确', () => {
  const workflow = applyLoras(DEFAULT_WORKFLOW, ['a.safetensors', 'b.safetensors']);
  assert.equal(workflow['3'].inputs.model[0], '101');
  assert.equal(workflow['6'].inputs.clip[0], '101');
  assert.equal(workflow['7'].inputs.clip[0], '101');
  assert.equal(workflow['100'].inputs.model[0], '4');
  assert.equal(workflow['100'].inputs.clip[0], '4');
  assert.equal(workflow['101'].inputs.model[0], '100');
  assert.equal(workflow['101'].inputs.lora_name, 'b.safetensors');
  // 常量模板不能被污染。
  assert.equal(DEFAULT_WORKFLOW['3'].inputs.model[0], '4');
});

test('LoRA 名清洗：丢弃含路径分隔符与超量项', () => {
  assert.deepEqual(normalizeLoras(['ok.safetensors', '../evil', 'x'], ), ['ok.safetensors', 'x']);
  assert.equal(normalizeLoras(['a', 'b', 'c', 'd', 'e', 'f']).length, 5);
  assert.deepEqual(normalizeLoras('not-an-array'), []);
});
