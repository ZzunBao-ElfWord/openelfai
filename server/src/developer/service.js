'use strict';

const crypto = require('node:crypto');
const {
  TRACKS,
  LIMITS,
  BOOK_DIAMONDS_MIN,
  BOOK_DIAMONDS_MAX,
  validateManifest,
  validateSource,
} = require('./manifest');

const SHANGHAI_OFFSET_MS = 8 * 3_600_000;
const DAY_MS = 86_400_000;
const DEFAULT_MAX_DAILY_RUNS = 50;
const DEVELOPER_SHARE_BP = 7000;
const EDITABLE_STATUS = new Set(['draft', 'testing', 'offline']);

const DEVELOPER_COLUMNS = 'user_id, real_name, purpose, status, tier, created_at, approved_at';

function fail(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function parseJson(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch (_) {
    return null;
  }
}

function dayStart(nowMs) {
  const shifted = nowMs + SHANGHAI_OFFSET_MS;
  return Math.floor(shifted / DAY_MS) * DAY_MS - SHANGHAI_OFFSET_MS;
}

function readApplyField(value, field, min, max) {
  const text = typeof value === 'string' ? value.trim() : '';
  const length = [...text].length;
  if (length < min || length > max) {
    throw fail(400, 'INVALID_APPLICATION', `${field} 需为 ${min}-${max} 个字符`);
  }
  return text;
}

function mapDeveloper(row) {
  return {
    user_id: row.user_id,
    real_name: row.real_name,
    purpose: row.purpose,
    status: row.status,
    tier: row.tier,
    created_at: toNumber(row.created_at),
    approved_at: row.approved_at == null ? null : toNumber(row.approved_at),
  };
}

function mapSkill(row) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    track: row.track,
    kind: row.kind,
    summary: row.summary,
    status: row.status,
    latest_version: toNumber(row.latest_version),
    runs: toNumber(row.runs),
    last_run_at: row.last_run_at == null ? null : toNumber(row.last_run_at),
    created_at: toNumber(row.created_at),
    updated_at: toNumber(row.updated_at),
  };
}

function createDeveloperService({ db, sandbox, llmChat, now = Date.now, maxDailyRuns = DEFAULT_MAX_DAILY_RUNS }) {
  async function readDeveloper(userId) {
    const [rows] = await db.execute(
      `SELECT ${DEVELOPER_COLUMNS} FROM platform_developers WHERE user_id = ?`,
      [userId],
    );
    return rows[0] || null;
  }

  async function requireDeveloper(user) {
    const row = await readDeveloper(user.id);
    if (!row || row.status !== 'approved') {
      throw fail(403, 'DEVELOPER_REQUIRED', '请先完成开发者入驻');
    }
    return row;
  }

  async function requireOwnedSkill(user, skillId) {
    const [rows] = await db.execute(
      `SELECT id, developer_id, slug, name, track, kind, summary, status, created_at, updated_at
         FROM dev_skill_defs WHERE id = ? AND developer_id = ?`,
      [skillId, user.id],
    );
    if (!rows.length) throw fail(404, 'SKILL_NOT_FOUND', '技能不存在');
    return rows[0];
  }

  async function readLatestVersion(skillId) {
    const [rows] = await db.execute(
      `SELECT id, version, manifest, source, source_hash, status, created_at
         FROM dev_skill_versions WHERE skill_id = ? ORDER BY version DESC LIMIT 1`,
      [skillId],
    );
    return rows[0] || null;
  }

  function profilePayload(row) {
    return {
      developer: row ? mapDeveloper(row) : null,
      sandbox: sandbox.status(),
      runtime: 'node20',
      tracks: TRACKS,
      pricing: {
        min_diamonds: BOOK_DIAMONDS_MIN,
        max_diamonds: BOOK_DIAMONDS_MAX,
        developer_share_bp: DEVELOPER_SHARE_BP,
      },
      manifest_limits: Object.fromEntries(
        Object.entries(LIMITS).map(([key, rule]) => [key, { min: rule.min, max: rule.max, default: rule.default }]),
      ),
      max_daily_runs: maxDailyRuns,
    };
  }

  async function getProfile(user) {
    return profilePayload(await readDeveloper(user.id));
  }

  async function apply(user, body) {
    const realName = readApplyField(body?.realName, '姓名', 2, 32);
    const purpose = readApplyField(body?.purpose, '入驻用途', 10, 255);
    const createdAt = now();

    const existing = await readDeveloper(user.id);
    if (existing) {
      await db.execute(
        'UPDATE platform_developers SET real_name = ?, purpose = ? WHERE user_id = ?',
        [realName, purpose, user.id],
      );
    } else {
      // 首版不接人工审核：入驻即通过，status 字段保留给后续审核流程。
      await db.execute(
        `INSERT INTO platform_developers
          (user_id, real_name, purpose, status, tier, created_at, approved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [user.id, realName, purpose, 'approved', 'standard', createdAt, createdAt],
      );
    }

    return getProfile(user);
  }

  async function listSkills(user) {
    await requireDeveloper(user);
    const [rows] = await db.execute(
      `SELECT d.id, d.slug, d.name, d.track, d.kind, d.summary, d.status, d.created_at, d.updated_at,
              COALESCE(v.max_version, 0) AS latest_version,
              COALESCE(r.runs, 0) AS runs,
              r.last_run_at
         FROM dev_skill_defs d
         LEFT JOIN (SELECT skill_id, MAX(version) AS max_version FROM dev_skill_versions GROUP BY skill_id) v
                ON v.skill_id = d.id
         LEFT JOIN (SELECT skill_id, COUNT(*) AS runs, MAX(created_at) AS last_run_at FROM dev_skill_runs GROUP BY skill_id) r
                ON r.skill_id = d.id
        WHERE d.developer_id = ?
        ORDER BY d.updated_at DESC`,
      [user.id],
    );
    return { items: rows.map(mapSkill) };
  }

  async function getSkill(user, skillId) {
    await requireDeveloper(user);
    const skill = await requireOwnedSkill(user, skillId);
    const [versionRows] = await db.execute(
      `SELECT id, version, manifest, source_hash, status, created_at
         FROM dev_skill_versions WHERE skill_id = ? ORDER BY version DESC`,
      [skillId],
    );

    const [runRows] = await db.execute(
      `SELECT id, version_id, status, llm_calls, duration_ms, created_at
         FROM dev_skill_runs WHERE skill_id = ? ORDER BY created_at DESC LIMIT 10`,
      [skillId],
    );

    return {
      skill: mapSkill({ ...skill, latest_version: versionRows[0]?.version, runs: runRows.length }),
      versions: versionRows.map((row) => ({
        id: row.id,
        version: toNumber(row.version),
        manifest: parseJson(row.manifest),
        source_hash: row.source_hash,
        status: row.status,
        created_at: toNumber(row.created_at),
      })),
      runs: runRows.map((row) => ({
        id: row.id,
        version_id: row.version_id,
        status: row.status,
        llm_calls: toNumber(row.llm_calls),
        duration_ms: toNumber(row.duration_ms),
        created_at: toNumber(row.created_at),
      })),
    };
  }

  async function createSkill(user, body) {
    await requireDeveloper(user);
    const manifest = validateManifest(body?.manifest);
    const source = validateSource(body?.source);
    const id = `ds_${crypto.randomUUID().replace(/-/g, '').slice(0, 32)}`;
    const timestamp = now();

    try {
      await db.execute(
        `INSERT INTO dev_skill_defs
          (id, developer_id, slug, name, track, kind, summary, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, user.id, manifest.slug, manifest.name, manifest.track, 'skill', manifest.summary,
          'draft', timestamp, timestamp],
      );
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') {
        throw fail(409, 'SKILL_SLUG_TAKEN', '该 slug 已被你的其他技能占用');
      }
      throw error;
    }

    await db.execute(
      `INSERT INTO dev_skill_versions
        (id, skill_id, version, manifest, source, source_hash, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), id, 1, JSON.stringify(manifest), source,
        crypto.createHash('sha256').update(source).digest('hex'), 'draft', timestamp],
    );

    return getSkill(user, id);
  }

  // 每次保存都生成新版本，调试与审核都针对具体版本，避免覆盖历史。
  async function updateSkill(user, skillId, body) {
    await requireDeveloper(user);
    const skill = await requireOwnedSkill(user, skillId);
    if (!EDITABLE_STATUS.has(skill.status)) {
      throw fail(409, 'SKILL_LOCKED', '已提交审核的技能不能修改');
    }

    const manifest = validateManifest(body?.manifest);
    const source = validateSource(body?.source);
    const latest = await readLatestVersion(skillId);
    const version = toNumber(latest?.version) + 1;
    const timestamp = now();

    await db.execute(
      `INSERT INTO dev_skill_versions
        (id, skill_id, version, manifest, source, source_hash, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), skillId, version, JSON.stringify(manifest), source,
        crypto.createHash('sha256').update(source).digest('hex'), 'draft', timestamp],
    );

    await db.execute(
      `UPDATE dev_skill_defs
          SET slug = ?, name = ?, track = ?, summary = ?, updated_at = ?
        WHERE id = ? AND developer_id = ?`,
      [manifest.slug, manifest.name, manifest.track, manifest.summary, timestamp, skillId, user.id],
    );

    return getSkill(user, skillId);
  }

  async function recordRun({ id, skillId, versionId, developerId, mode, status, input, output, error, calls, duration }) {
    await db.execute(
      `INSERT INTO dev_skill_runs
        (id, skill_id, version_id, developer_id, mode, status, input_json, output_json, error, llm_calls, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, skillId, versionId, developerId, mode, status,
        JSON.stringify(input ?? null).slice(0, 8000),
        output == null ? null : JSON.stringify(output).slice(0, 8000),
        error ? String(error).slice(0, 255) : null,
        calls, duration, now()],
    );
  }

  async function testSkill(user, skillId, body) {
    await requireDeveloper(user);
    const skill = await requireOwnedSkill(user, skillId);
    if (!EDITABLE_STATUS.has(skill.status)) {
      throw fail(409, 'SKILL_LOCKED', '已提交审核的技能不能调试');
    }

    const [quotaRows] = await db.execute(
      'SELECT COUNT(*) AS count FROM dev_skill_runs WHERE developer_id = ? AND created_at >= ?',
      [user.id, dayStart(now())],
    );
    if (toNumber(quotaRows[0]?.count) >= maxDailyRuns) {
      throw fail(429, 'RUN_QUOTA_EXCEEDED', `每日调试次数已达上限（${maxDailyRuns} 次）`);
    }

    let version = null;
    if (typeof body?.versionId === 'string' && body.versionId) {
      const [rows] = await db.execute(
        `SELECT id, version, manifest, source, source_hash, status, created_at
           FROM dev_skill_versions WHERE id = ? AND skill_id = ?`,
        [body.versionId, skillId],
      );
      version = rows[0] || null;
    } else {
      version = await readLatestVersion(skillId);
    }
    if (!version) throw fail(404, 'VERSION_NOT_FOUND', '技能版本不存在');

    const manifest = parseJson(version.manifest) || {};
    const limits = manifest.limits || { timeout_ms: 8000, max_llm_calls: 2, max_input_chars: 2000 };
    const input = body?.input === undefined
      ? (manifest.samples?.[0]?.input ?? {})
      : body.input;

    const runId = crypto.randomUUID();
    const started = now();

    let result;
    try {
      result = await sandbox.run({
        manifest,
        source: version.source,
        input,
        limits,
        // 调试用开发者本人钱包计费：调用走平台网关，与 App 内对话同一套账。
        chat: typeof llmChat === 'function' ? (payload) => llmChat({ user, ...payload }) : undefined,
      });
    } catch (error) {
      await recordRun({
        id: runId, skillId, versionId: version.id, developerId: user.id, mode: sandbox.status().mode,
        status: 'error', input, output: null, error: error.message, calls: 0, duration: now() - started,
      });
      throw error;
    }

    await recordRun({
      id: runId, skillId, versionId: version.id, developerId: user.id, mode: result.mode,
      status: result.ok ? 'ok' : 'error', input, output: result.output, error: result.error,
      calls: result.llm_calls, duration: result.duration_ms,
    });

    return {
      run_id: runId,
      ok: result.ok,
      output: result.output,
      error: result.error,
      llm_calls: result.llm_calls,
      duration_ms: result.duration_ms,
      sandbox: result.mode,
    };
  }

  async function submitSkill(user, skillId) {
    await requireDeveloper(user);
    const skill = await requireOwnedSkill(user, skillId);
    if (!EDITABLE_STATUS.has(skill.status)) {
      throw fail(409, 'SKILL_LOCKED', '该技能已提交审核或已上架');
    }

    const latest = await readLatestVersion(skillId);
    if (!latest) throw fail(409, 'TEST_REQUIRED', '请先创建技能版本');

    const [runRows] = await db.execute(
      "SELECT id FROM dev_skill_runs WHERE skill_id = ? AND version_id = ? AND status = 'ok' ORDER BY created_at DESC LIMIT 1",
      [skillId, latest.id],
    );
    if (!runRows.length) {
      throw fail(409, 'TEST_REQUIRED', '请先完成一次成功的调试，再提交审核');
    }

    await db.execute(
      "UPDATE dev_skill_defs SET status = 'submitted', updated_at = ? WHERE id = ? AND developer_id = ?",
      [now(), skillId, user.id],
    );
    await db.execute(
      "UPDATE dev_skill_versions SET status = 'submitted' WHERE id = ?",
      [latest.id],
    );
    return getSkill(user, skillId);
  }

  async function offlineSkill(user, skillId) {
    await requireDeveloper(user);
    await requireOwnedSkill(user, skillId);
    await db.execute(
      "UPDATE dev_skill_defs SET status = 'offline', updated_at = ? WHERE id = ? AND developer_id = ?",
      [now(), skillId, user.id],
    );
    return getSkill(user, skillId);
  }

  return {
    apply,
    getProfile,
    listSkills,
    getSkill,
    createSkill,
    updateSkill,
    testSkill,
    submitSkill,
    offlineSkill,
  };
}

module.exports = { createDeveloperService };
