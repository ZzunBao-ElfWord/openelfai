'use strict';
// 开发者入驻 + 沙箱骨架：manifest 校验、本地沙箱执行、服务层闭环（全部不连 MySQL）。
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { validateManifest, validateSource } = require('../src/developer/manifest');
const { createSandbox } = require('../src/developer/sandbox');
const { createDeveloperService } = require('../src/developer/service');

const BASE_MANIFEST = {
  slug: 'weather-brief',
  name: '天气播报',
  track: 'knowledge',
  summary: '把用户给的城市整理成一段当日天气播报文案',
  pricing: { book_diamonds: 68 },
};

const LIMITS = { timeout_ms: 5000, max_llm_calls: 2, max_input_chars: 2000 };
const ECHO_SOURCE = 'exports.handler = async (event) => ({ echo: event.input.text });';

function makeDb() {
  const state = { developers: [], defs: [], versions: [], runs: [] };

  function execute(sql, params = []) {
    const query = String(sql).replace(/\s+/g, ' ').trim();

    if (query.includes('FROM platform_developers WHERE user_id = ?')) {
      return [state.developers.filter((row) => row.user_id === params[0]), []];
    }

    if (query.startsWith('INSERT INTO platform_developers')) {
      const [user_id, real_name, purpose, status, tier, created_at, approved_at] = params;
      state.developers.push({ user_id, real_name, purpose, status, tier, created_at, approved_at });
      return [{ affectedRows: 1 }, []];
    }

    if (query.startsWith('UPDATE platform_developers SET real_name')) {
      const row = state.developers.find((item) => item.user_id === params[2]);
      if (row) {
        row.real_name = params[0];
        row.purpose = params[1];
      }
      return [{ affectedRows: row ? 1 : 0 }, []];
    }

    if (query.startsWith('INSERT INTO dev_skill_defs')) {
      const [id, developer_id, slug, name, track, kind, summary, status, created_at, updated_at] = params;
      if (state.defs.some((row) => row.developer_id === developer_id && row.slug === slug)) {
        const error = new Error('duplicate slug');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      state.defs.push({ id, developer_id, slug, name, track, kind, summary, status, created_at, updated_at });
      return [{ affectedRows: 1 }, []];
    }

    if (query.startsWith('UPDATE dev_skill_defs SET slug')) {
      const [slug, name, track, summary, updated_at, id, developer_id] = params;
      const row = state.defs.find((item) => item.id === id && item.developer_id === developer_id);
      if (row) Object.assign(row, { slug, name, track, summary, updated_at });
      return [{ affectedRows: row ? 1 : 0 }, []];
    }

    if (query.startsWith("UPDATE dev_skill_defs SET status = 'submitted'")) {
      const row = state.defs.find((item) => item.id === params[1] && item.developer_id === params[2]);
      if (row) {
        row.status = 'submitted';
        row.updated_at = params[0];
      }
      return [{ affectedRows: row ? 1 : 0 }, []];
    }

    if (query.includes('FROM dev_skill_defs d')) {
      const items = state.defs
        .filter((row) => row.developer_id === params[0])
        .map((row) => {
          const versions = state.versions.filter((v) => v.skill_id === row.id);
          const runs = state.runs.filter((r) => r.skill_id === row.id);
          return {
            ...row,
            latest_version: versions.length ? Math.max(...versions.map((v) => v.version)) : 0,
            runs: runs.length,
            last_run_at: runs.length ? Math.max(...runs.map((r) => r.created_at)) : null,
          };
        });
      return [items, []];
    }

    if (query.includes('FROM dev_skill_defs WHERE id = ? AND developer_id = ?')) {
      return [state.defs.filter((row) => row.id === params[0] && row.developer_id === params[1]), []];
    }

    if (query.startsWith('INSERT INTO dev_skill_versions')) {
      const [id, skill_id, version, manifest, source, source_hash, status, created_at] = params;
      state.versions.push({ id, skill_id, version, manifest, source, source_hash, status, created_at });
      return [{ affectedRows: 1 }, []];
    }

    if (query.includes('FROM dev_skill_versions WHERE skill_id = ?')) {
      const rows = state.versions
        .filter((row) => row.skill_id === params[0])
        .sort((a, b) => b.version - a.version);
      return [query.includes('LIMIT 1') ? rows.slice(0, 1) : rows, []];
    }

    if (query.includes('FROM dev_skill_versions WHERE id = ? AND skill_id = ?')) {
      return [state.versions.filter((row) => row.id === params[0] && row.skill_id === params[1]), []];
    }

    if (query.startsWith('UPDATE dev_skill_versions SET status')) {
      const row = state.versions.find((item) => item.id === params[0]);
      if (row) row.status = 'submitted';
      return [{ affectedRows: row ? 1 : 0 }, []];
    }

    if (query.startsWith('INSERT INTO dev_skill_runs')) {
      const [id, skill_id, version_id, developer_id, mode, status, input_json, output_json, error,
        llm_calls, duration_ms, created_at] = params;
      state.runs.push({
        id, skill_id, version_id, developer_id, mode, status, input_json, output_json, error,
        llm_calls, duration_ms, created_at,
      });
      return [{ affectedRows: 1 }, []];
    }

    if (query.includes('COUNT(*) AS count FROM dev_skill_runs')) {
      const rows = state.runs.filter((row) => row.developer_id === params[0] && row.created_at >= params[1]);
      return [[{ count: rows.length }], []];
    }

    if (query.includes("FROM dev_skill_runs WHERE skill_id = ? AND version_id = ? AND status = 'ok'")) {
      return [state.runs.filter((row) => row.skill_id === params[0] && row.version_id === params[1] &&
        row.status === 'ok'), []];
    }

    if (query.includes('FROM dev_skill_runs WHERE skill_id = ?')) {
      const rows = state.runs
        .filter((row) => row.skill_id === params[0])
        .sort((a, b) => b.created_at - a.created_at);
      return [query.includes('LIMIT 10') ? rows.slice(0, 10) : rows, []];
    }

    throw new Error('Unexpected SQL: ' + query);
  }

  return { execute, state };
}

test('manifest：缺省值被规范化，价格/轨道校验生效', () => {
  const manifest = validateManifest(BASE_MANIFEST);
  assert.equal(manifest.runtime, 'node20');
  assert.equal(manifest.limits.timeout_ms, 8000);
  assert.equal(manifest.limits.max_llm_calls, 2);
  assert.deepEqual(manifest.models, []);

  assert.throws(
    () => validateManifest({ ...BASE_MANIFEST, pricing: { book_diamonds: 5 } }),
    /18-999/,
  );
  assert.throws(
    () => validateManifest({ ...BASE_MANIFEST, track: 'unknown' }),
    /track/,
  );
});

test('源码校验：必须导出 handler，拒绝宿主模块', () => {
  assert.equal(validateSource(ECHO_SOURCE), ECHO_SOURCE);
  assert.throws(() => validateSource('exports.handler = () => 1; require("fs")'), /不允许使用 fs/);
  assert.throws(() => validateSource('const a = 1;'), /exports.handler/);
});

test('本地沙箱：执行单文件技能并回传输出', async () => {
  const sandbox = createSandbox({ mode: 'local' });
  const result = await sandbox.run({
    manifest: { runtime: 'node20' },
    source: ECHO_SOURCE,
    input: { text: '你好' },
    limits: LIMITS,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.output, { echo: '你好' });
  assert.equal(result.mode, 'local');
});

test('本地沙箱：ctx.llm.chat 经父进程通道返回模型结果', async () => {
  const sandbox = createSandbox({ mode: 'local' });
  const result = await sandbox.run({
    manifest: { runtime: 'node20' },
    source: `exports.handler = async (event, ctx) => {
      const r = await ctx.llm.chat([{ role: 'user', content: 'hi' }]);
      return { text: r.content };
    };`,
    input: {},
    limits: LIMITS,
    chat: async () => ({ content: '模型回复' }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.output.text, '模型回复');
  assert.equal(result.llm_calls, 1);
});

test('本地沙箱：超时与禁用模式', async () => {
  const sandbox = createSandbox({ mode: 'local' });
  const result = await sandbox.run({
    manifest: { runtime: 'node20' },
    source: 'exports.handler = () => new Promise(() => {});',
    input: {},
    limits: { ...LIMITS, timeout_ms: 1000 },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /超时/);

  const disabled = createSandbox({ mode: 'disabled' });
  await assert.rejects(
    () => disabled.run({ manifest: {}, source: ECHO_SOURCE, input: {}, limits: LIMITS }),
    (error) => error.statusCode === 503 && error.code === 'SANDBOX_UNAVAILABLE',
  );
});

test('服务闭环：入驻 → 建技能 → 调试 → 提交', async () => {
  const db = makeDb();
  const sandbox = createSandbox({ mode: 'local' });
  const service = createDeveloperService({
    db,
    sandbox,
    now: () => 1_700_000_000_000,
    llmChat: async () => ({ content: 'ok' }),
  });
  const user = { id: 'u_dev_test' };

  const before = await service.getProfile(user);
  assert.equal(before.developer, null);
  assert.equal(before.sandbox.mode, 'local');

  const applied = await service.apply(user, {
    realName: '张三',
    purpose: '开发写作类技能，服务站内 AI 智能体',
  });
  assert.equal(applied.developer.status, 'approved');
  assert.equal(applied.pricing.developer_share_bp, 7000);

  await assert.rejects(
    () => service.createSkill(user, {
      manifest: { ...BASE_MANIFEST, pricing: { book_diamonds: 1 } },
      source: ECHO_SOURCE,
    }),
    (error) => error.code === 'INVALID_MANIFEST',
  );

  const created = await service.createSkill(user, { manifest: BASE_MANIFEST, source: ECHO_SOURCE });
  assert.equal(created.skill.status, 'draft');
  assert.equal(created.skill.latest_version, 1);
  assert.equal(created.versions.length, 1);

  await assert.rejects(
    () => service.submitSkill(user, created.skill.id),
    (error) => error.code === 'TEST_REQUIRED',
  );

  const run = await service.testSkill(user, created.skill.id, { input: { text: '上海' } });
  assert.equal(run.ok, true);
  assert.deepEqual(run.output, { echo: '上海' });

  const submitted = await service.submitSkill(user, created.skill.id);
  assert.equal(submitted.skill.status, 'submitted');

  await assert.rejects(
    () => service.testSkill(user, created.skill.id, {}),
    (error) => error.code === 'SKILL_LOCKED',
  );
});
