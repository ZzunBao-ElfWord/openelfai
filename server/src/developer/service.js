'use strict';

const crypto = require('node:crypto');
const {
  KINDS,
  TRACKS,
  LIMITS,
  BOOK_DIAMONDS_MIN,
  BOOK_DIAMONDS_MAX,
  validateManifest,
  validateSource,
  readPrice,
  normalizeDefinition,
} = require('./manifest');

const SHANGHAI_OFFSET_MS = 8 * 3_600_000;
const DAY_MS = 86_400_000;
const DEFAULT_MAX_DAILY_RUNS = 50;
const DEVELOPER_SHARE_BP = 7000;
const SETTLE_DAYS = 7;
const DEVELOPER_AGREEMENT_VERSION = '2026-10-30';
const EDITABLE_STATUS = new Set(['draft', 'testing', 'offline', 'rejected']);
const SUBJECT_TYPES = new Set(['individual', 'enterprise']);
const LICENSE_RE = /^[0-9A-Z]{18}$/;
const CONTACT_RE = /^(1[3-9]\d{9}|[^@\s]+@[^@\s]+\.[^@\s]+)$/;

const DEVELOPER_COLUMNS = `user_id, real_name, purpose, status, tier, subject_type, org_name,
  org_license_no, org_contact, agreement_version, agreement_at, review_note, reviewed_at,
  created_at, approved_at, updated_at`;

const CAPABILITY_COLUMNS = `id, developer_id, slug, name, track, kind, summary, price_diamonds,
  definition, status, review_note, approved_at, install_count, sales_count, call_count,
  earnings_cents, created_at, updated_at`;

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
    subject_type: row.subject_type || 'individual',
    org_name: row.org_name || null,
    org_license_no: row.org_license_no || null,
    org_contact: row.org_contact || null,
    agreement_version: row.agreement_version || null,
    agreement_at: row.agreement_at == null ? null : toNumber(row.agreement_at),
    review_note: row.review_note || null,
    reviewed_at: row.reviewed_at == null ? null : toNumber(row.reviewed_at),
    created_at: toNumber(row.created_at),
    approved_at: row.approved_at == null ? null : toNumber(row.approved_at),
    updated_at: row.updated_at == null ? null : toNumber(row.updated_at),
  };
}

function mapCapability(row, extra = {}) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    track: row.track,
    kind: row.kind,
    summary: row.summary,
    price_diamonds: toNumber(row.price_diamonds),
    definition: parseJson(row.definition),
    status: row.status,
    review_note: row.review_note || null,
    approved_at: row.approved_at == null ? null : toNumber(row.approved_at),
    install_count: toNumber(row.install_count),
    sales_count: toNumber(row.sales_count),
    call_count: toNumber(row.call_count),
    earnings_cents: toNumber(row.earnings_cents),
    latest_version: toNumber(extra.latest_version),
    runs: toNumber(extra.runs),
    last_run_at: extra.last_run_at == null ? null : toNumber(extra.last_run_at),
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
    if (!row) throw fail(403, 'DEVELOPER_REQUIRED', '请先完成开发者入驻');
    if (row.status === 'pending') throw fail(403, 'DEVELOPER_REVIEWING', '入驻资料审核中，通过后即可发布能力');
    if (row.status === 'rejected') {
      throw fail(403, 'DEVELOPER_REJECTED', row.review_note ? `入驻未通过：${row.review_note}` : '入驻申请未通过，请修改后重新提交');
    }
    if (row.status !== 'approved') throw fail(403, 'DEVELOPER_SUSPENDED', '开发者账号已被暂停，请联系平台');
    return row;
  }

  async function requireOwnedCapability(user, capabilityId) {
    const [rows] = await db.execute(
      `SELECT ${CAPABILITY_COLUMNS} FROM dev_skill_defs WHERE id = ? AND developer_id = ?`,
      [capabilityId, user.id],
    );
    if (!rows.length) throw fail(404, 'CAPABILITY_NOT_FOUND', '能力不存在');
    return rows[0];
  }

  async function readLatestVersion(capabilityId) {
    const [rows] = await db.execute(
      `SELECT id, version, manifest, source, source_hash, status, created_at
         FROM dev_skill_versions WHERE skill_id = ? ORDER BY version DESC LIMIT 1`,
      [capabilityId],
    );
    return rows[0] || null;
  }

  async function profileStats(userId) {
    const [capRows] = await db.execute(
      `SELECT kind, status, COUNT(*) AS count, COALESCE(SUM(install_count), 0) AS installs,
              COALESCE(SUM(sales_count), 0) AS sales, COALESCE(SUM(call_count), 0) AS calls,
              COALESCE(SUM(earnings_cents), 0) AS earnings_cents
         FROM dev_skill_defs WHERE developer_id = ? GROUP BY kind, status`,
      [userId],
    );
    const byStatus = { draft: 0, submitted: 0, approved: 0, rejected: 0, offline: 0 };
    const totals = { installs: 0, sales: 0, calls: 0, earnings_cents: 0 };
    for (const row of capRows) {
      const count = toNumber(row.count);
      byStatus[row.status] = toNumber(byStatus[row.status]) + count;
      totals.installs += toNumber(row.installs);
      totals.sales += toNumber(row.sales);
      totals.calls += toNumber(row.calls);
      totals.earnings_cents += toNumber(row.earnings_cents);
    }
    return { by_status: byStatus, totals };
  }

  async function dailyRunsUsed(userId) {
    const [rows] = await db.execute(
      'SELECT COUNT(*) AS count FROM dev_skill_runs WHERE developer_id = ? AND created_at >= ?',
      [userId, dayStart(now())],
    );
    return toNumber(rows[0]?.count);
  }

  async function profilePayload(row) {
    const agreement = row
      ? {
        version: DEVELOPER_AGREEMENT_VERSION,
        accepted: row.agreement_version === DEVELOPER_AGREEMENT_VERSION,
        accepted_at: row.agreement_at == null ? null : toNumber(row.agreement_at),
      }
      : { version: DEVELOPER_AGREEMENT_VERSION, accepted: false, accepted_at: null };
    const stats = row ? await profileStats(row.user_id) : { by_status: {}, totals: {} };
    const used = row ? await dailyRunsUsed(row.user_id) : 0;
    return {
      developer: row ? mapDeveloper(row) : null,
      agreement,
      sandbox: sandbox.status(),
      runtime: 'node20',
      kinds: KINDS,
      tracks: TRACKS,
      pricing: {
        min_diamonds: BOOK_DIAMONDS_MIN,
        max_diamonds: BOOK_DIAMONDS_MAX,
        developer_share_bp: DEVELOPER_SHARE_BP,
      },
      settle_days: SETTLE_DAYS,
      manifest_limits: Object.fromEntries(
        Object.entries(LIMITS).map(([key, rule]) => [key, { min: rule.min, max: rule.max, default: rule.default }]),
      ),
      quota: { daily_runs_used: used, daily_runs_limit: maxDailyRuns },
      max_daily_runs: maxDailyRuns,
      stats,
    };
  }

  async function getProfile(user) {
    return profilePayload(await readDeveloper(user.id));
  }

  // 个人主体填完实名信息即通过；企业主体进入人工审核。
  async function apply(user, body) {
    const subjectType = typeof body?.subjectType === 'string' ? body.subjectType.trim() : 'individual';
    if (!SUBJECT_TYPES.has(subjectType)) throw fail(400, 'INVALID_SUBJECT_TYPE', '主体类型需为个人或企业');
    const realName = readApplyField(body?.realName, '姓名', 2, 32);
    const purpose = readApplyField(body?.purpose, '入驻用途', 10, 255);
    const agreementVersion = typeof body?.agreementVersion === 'string' ? body.agreementVersion.trim() : '';
    if (agreementVersion !== DEVELOPER_AGREEMENT_VERSION) {
      throw fail(400, 'AGREEMENT_REQUIRED', '请先阅读并同意《开发者服务协议》');
    }

    let orgName = null;
    let orgLicenseNo = null;
    let orgContact = null;
    if (subjectType === 'enterprise') {
      orgName = readApplyField(body?.orgName, '企业名称', 2, 128);
      orgLicenseNo = typeof body?.orgLicenseNo === 'string' ? body.orgLicenseNo.trim().toUpperCase() : '';
      if (!LICENSE_RE.test(orgLicenseNo)) throw fail(400, 'INVALID_LICENSE', '请填写 18 位统一社会信用代码');
      orgContact = typeof body?.orgContact === 'string' ? body.orgContact.trim() : '';
      if (!CONTACT_RE.test(orgContact)) throw fail(400, 'INVALID_CONTACT', '请填写企业联系人手机号或邮箱');
    }

    const timestamp = now();
    const existing = await readDeveloper(user.id);
    // 暂停中的账号不能靠重新提交自我恢复，必须由平台解封。
    if (existing?.status === 'suspended') {
      throw fail(403, 'DEVELOPER_SUSPENDED', '开发者账号已被暂停，请联系平台处理');
    }
    // 已通过的开发者补充资料不改变状态；被拒的重新提交要重新走审核。
    const keepApproved = existing?.status === 'approved';
    const status = keepApproved ? 'approved' : (subjectType === 'individual' ? 'approved' : 'pending');
    const approvedAt = status === 'approved' ? (existing?.approved_at ?? timestamp) : null;

    if (existing) {
      await db.execute(
        `UPDATE platform_developers
            SET real_name = ?, purpose = ?, subject_type = ?, org_name = ?, org_license_no = ?, org_contact = ?,
                agreement_version = ?, agreement_at = ?, status = ?, approved_at = ?,
                review_note = NULL, reviewed_at = NULL, updated_at = ?
          WHERE user_id = ?`,
        [realName, purpose, subjectType, orgName, orgLicenseNo, orgContact,
          agreementVersion, timestamp, status, approvedAt, timestamp, user.id],
      );
    } else {
      await db.execute(
        `INSERT INTO platform_developers
          (user_id, real_name, purpose, subject_type, org_name, org_license_no, org_contact,
            agreement_version, agreement_at, status, tier, created_at, approved_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [user.id, realName, purpose, subjectType, orgName, orgLicenseNo, orgContact,
          agreementVersion, timestamp, status, 'standard', timestamp, approvedAt, timestamp],
      );
    }

    return getProfile(user);
  }

  async function listCapabilities(user, query) {
    await requireDeveloper(user);
    const kind = query?.kind && KINDS.includes(query.kind) ? query.kind : null;
    const [rows] = await db.execute(
      `SELECT d.id, d.developer_id, d.slug, d.name, d.track, d.kind, d.summary, d.price_diamonds,
              d.definition, d.status, d.review_note, d.approved_at, d.install_count, d.sales_count,
              d.call_count, d.earnings_cents, d.created_at, d.updated_at,
              COALESCE(v.max_version, 0) AS latest_version,
              COALESCE(r.runs, 0) AS runs,
              r.last_run_at
         FROM dev_skill_defs d
         LEFT JOIN (SELECT skill_id, MAX(version) AS max_version FROM dev_skill_versions GROUP BY skill_id) v
                ON v.skill_id = d.id
         LEFT JOIN (SELECT skill_id, COUNT(*) AS runs, MAX(created_at) AS last_run_at FROM dev_skill_runs GROUP BY skill_id) r
                ON r.skill_id = d.id
        WHERE d.developer_id = ? ${kind ? 'AND d.kind = ?' : ''}
        ORDER BY d.updated_at DESC`,
      kind ? [user.id, kind] : [user.id],
    );
    return { items: rows.map((row) => mapCapability(row)) };
  }

  async function getCapability(user, capabilityId) {
    await requireDeveloper(user);
    const capability = await requireOwnedCapability(user, capabilityId);
    const [versionRows] = await db.execute(
      `SELECT id, version, manifest, source_hash, status, created_at
         FROM dev_skill_versions WHERE skill_id = ? ORDER BY version DESC`,
      [capabilityId],
    );

    const [runRows] = await db.execute(
      `SELECT id, version_id, status, llm_calls, duration_ms, created_at
         FROM dev_skill_runs WHERE skill_id = ? ORDER BY created_at DESC LIMIT 10`,
      [capabilityId],
    );

    return {
      capability: mapCapability({ ...capability, latest_version: versionRows[0]?.version, runs: runRows.length }),
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

  function readKind(body, fallback = 'skill') {
    const kind = typeof body?.kind === 'string' ? body.kind.trim() : fallback;
    if (!KINDS.includes(kind)) throw fail(400, 'INVALID_KIND', '能力类型需为 skill / expert / connector');
    return kind;
  }

  // 保存能力：技能走 manifest + 源码（每次保存生成新版本），专家/连接器只存声明式定义。
  async function writeCapability(user, capabilityId, body) {
    const kind = readKind(body, body?.kind);
    const timestamp = now();
    let slug;
    let name;
    let track;
    let summary;
    let price;
    let definition = null;
    let manifest = null;
    let source = null;

    if (kind === 'skill') {
      manifest = validateManifest(body?.manifest);
      source = validateSource(body?.source);
      slug = manifest.slug;
      name = manifest.name;
      track = manifest.track;
      summary = manifest.summary;
      price = manifest.pricing.book_diamonds;
    } else {
      definition = normalizeDefinition(kind, body?.definition);
      price = readPrice(body?.priceDiamonds);
      slug = definition.slug;
      name = definition.name;
      track = definition.track;
      summary = definition.summary;
    }

    try {
      if (!capabilityId) {
        const id = `ds_${crypto.randomUUID().replace(/-/g, '').slice(0, 32)}`;
        await db.execute(
          `INSERT INTO dev_skill_defs
            (id, developer_id, slug, name, track, kind, summary, price_diamonds, definition,
              status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, user.id, slug, name, track, kind, summary, price,
            definition ? JSON.stringify(definition) : null, 'draft', timestamp, timestamp],
        );
        if (kind === 'skill') {
          await db.execute(
            `INSERT INTO dev_skill_versions
              (id, skill_id, version, manifest, source, source_hash, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [crypto.randomUUID(), id, 1, JSON.stringify(manifest), source,
              crypto.createHash('sha256').update(source).digest('hex'), 'draft', timestamp],
          );
        }
        return id;
      }

      const existing = await requireOwnedCapability(user, capabilityId);
      if (existing.kind !== kind) throw fail(409, 'KIND_IMMUTABLE', '能力类型创建后不可修改');
      await db.execute(
        `UPDATE dev_skill_defs
            SET slug = ?, name = ?, track = ?, summary = ?, price_diamonds = ?, definition = ?,
                status = 'draft', review_note = NULL, updated_at = ?
          WHERE id = ? AND developer_id = ?`,
        [slug, name, track, summary, price, definition ? JSON.stringify(definition) : null,
          timestamp, capabilityId, user.id],
      );
      if (kind === 'skill') {
        const latest = await readLatestVersion(capabilityId);
        const version = toNumber(latest?.version) + 1;
        await db.execute(
          `INSERT INTO dev_skill_versions
            (id, skill_id, version, manifest, source, source_hash, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [crypto.randomUUID(), capabilityId, version, JSON.stringify(manifest), source,
            crypto.createHash('sha256').update(source).digest('hex'), 'draft', timestamp],
        );
      }
      return capabilityId;
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') throw fail(409, 'CAPABILITY_SLUG_TAKEN', '该 slug 已被你的其他能力占用');
      throw error;
    }
  }

  async function createCapability(user, body) {
    await requireDeveloper(user);
    return getCapability(user, await writeCapability(user, null, body));
  }

  // 每次保存技能都生成新版本，调试与审核都针对具体版本，避免覆盖历史。
  async function updateCapability(user, capabilityId, body) {
    await requireDeveloper(user);
    const capability = await requireOwnedCapability(user, capabilityId);
    if (!EDITABLE_STATUS.has(capability.status)) throw fail(409, 'CAPABILITY_LOCKED', '已提交审核或已上架的能力不能修改');
    return getCapability(user, await writeCapability(user, capabilityId, { ...body, kind: body?.kind || capability.kind }));
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

  // 只有技能可以调试；专家/连接器是声明式配置，提交后由平台审核。
  async function testCapability(user, capabilityId, body) {
    await requireDeveloper(user);
    const capability = await requireOwnedCapability(user, capabilityId);
    if (capability.kind !== 'skill') throw fail(400, 'NOT_TESTABLE', '只有技能支持调试运行');
    if (!EDITABLE_STATUS.has(capability.status)) throw fail(409, 'CAPABILITY_LOCKED', '已提交审核的能力不能调试');

    const used = await dailyRunsUsed(user.id);
    if (used >= maxDailyRuns) throw fail(429, 'RUN_QUOTA_EXCEEDED', `每日调试次数已达上限（${maxDailyRuns} 次）`);

    let version = null;
    if (typeof body?.versionId === 'string' && body.versionId) {
      const [rows] = await db.execute(
        `SELECT id, version, manifest, source, source_hash, status, created_at
           FROM dev_skill_versions WHERE id = ? AND skill_id = ?`,
        [body.versionId, capabilityId],
      );
      version = rows[0] || null;
    } else {
      version = await readLatestVersion(capabilityId);
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
        id: runId, skillId: capabilityId, versionId: version.id, developerId: user.id, mode: sandbox.status().mode,
        status: 'error', input, output: null, error: error.message, calls: 0, duration: now() - started,
      });
      throw error;
    }

    await recordRun({
      id: runId, skillId: capabilityId, versionId: version.id, developerId: user.id, mode: result.mode,
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

  async function submitCapability(user, capabilityId) {
    await requireDeveloper(user);
    const capability = await requireOwnedCapability(user, capabilityId);
    if (!EDITABLE_STATUS.has(capability.status)) throw fail(409, 'CAPABILITY_LOCKED', '该能力已提交审核或已上架');

    let latest = null;
    if (capability.kind === 'skill') {
      latest = await readLatestVersion(capabilityId);
      if (!latest) throw fail(409, 'TEST_REQUIRED', '请先创建技能版本');
      const [runRows] = await db.execute(
        "SELECT id FROM dev_skill_runs WHERE skill_id = ? AND version_id = ? AND status = 'ok' ORDER BY created_at DESC LIMIT 1",
        [capabilityId, latest.id],
      );
      if (!runRows.length) throw fail(409, 'TEST_REQUIRED', '请先完成一次成功的调试，再提交审核');
    } else if (!parseJson(capability.definition)) {
      throw fail(409, 'INCOMPLETE_DEFINITION', '请先补全能力定义再提交审核');
    }

    await db.execute(
      "UPDATE dev_skill_defs SET status = 'submitted', review_note = NULL, updated_at = ? WHERE id = ? AND developer_id = ?",
      [now(), capabilityId, user.id],
    );
    if (latest) {
      await db.execute("UPDATE dev_skill_versions SET status = 'submitted' WHERE id = ?", [latest.id]);
    }
    return getCapability(user, capabilityId);
  }

  // 开发者可自行下架已上架的能力，重新提交可再次进入审核。
  async function offlineCapability(user, capabilityId) {
    await requireDeveloper(user);
    const capability = await requireOwnedCapability(user, capabilityId);
    if (!['approved', 'submitted'].includes(capability.status)) {
      throw fail(409, 'NOT_ONLINE', '该能力当前不在上架或审核状态');
    }
    await db.execute(
      "UPDATE dev_skill_defs SET status = 'offline', updated_at = ? WHERE id = ? AND developer_id = ?",
      [now(), capabilityId, user.id],
    );
    return getCapability(user, capabilityId);
  }

  async function getStats(user) {
    await requireDeveloper(user);
    const [rows] = await db.execute(
      `SELECT id, slug, name, kind, track, status, price_diamonds, install_count, sales_count,
              call_count, earnings_cents
         FROM dev_skill_defs WHERE developer_id = ? ORDER BY updated_at DESC`,
      [user.id],
    );
    const totals = { installs: 0, sales: 0, calls: 0, earnings_cents: 0, capabilities: rows.length };
    const items = rows.map((row) => {
      const item = {
        id: row.id, slug: row.slug, name: row.name, kind: row.kind, track: row.track,
        status: row.status, price_diamonds: toNumber(row.price_diamonds),
        install_count: toNumber(row.install_count), sales_count: toNumber(row.sales_count),
        call_count: toNumber(row.call_count), earnings_cents: toNumber(row.earnings_cents),
      };
      totals.installs += item.install_count;
      totals.sales += item.sales_count;
      totals.calls += item.call_count;
      totals.earnings_cents += item.earnings_cents;
      return item;
    });
    return { items, totals, settle_days: SETTLE_DAYS, share_bp: DEVELOPER_SHARE_BP };
  }

  // 收益流水：到期 pending 自动转 available，提现沿用平台创作者收益通道。
  async function listEarnings(user) {
    await requireDeveloper(user);
    const timestamp = now();
    await db.execute(
      "UPDATE dev_earnings SET status = 'available' WHERE developer_id = ? AND status = 'pending' AND settle_at <= ?",
      [user.id, timestamp],
    );
    const [rows] = await db.execute(
      `SELECT e.id, e.capability_id, e.book_id, e.buyer_id, e.gross_diamonds, e.developer_cents,
              e.status, e.settle_at, e.created_at, d.name AS capability_name, d.kind AS capability_kind
         FROM dev_earnings e
         LEFT JOIN dev_skill_defs d ON d.id = e.capability_id
        WHERE e.developer_id = ?
        ORDER BY e.created_at DESC LIMIT 100`,
      [user.id],
    );
    const totals = { pending_cents: 0, available_cents: 0, lifetime_cents: 0 };
    const items = rows.map((row) => {
      const cents = toNumber(row.developer_cents);
      totals.lifetime_cents += cents;
      if (row.status === 'available') totals.available_cents += cents;
      else if (row.status === 'pending') totals.pending_cents += cents;
      return {
        id: row.id, capability_id: row.capability_id, capability_name: row.capability_name,
        capability_kind: row.capability_kind, book_id: row.book_id, buyer_id: row.buyer_id,
        gross_diamonds: toNumber(row.gross_diamonds), developer_cents: cents,
        status: row.status, settle_at: toNumber(row.settle_at), created_at: toNumber(row.created_at),
      };
    });
    return { items, totals, settle_days: SETTLE_DAYS, share_bp: DEVELOPER_SHARE_BP, min_withdraw_cents: 1000 };
  }

  return {
    apply,
    getProfile,
    listCapabilities,
    getCapability,
    createCapability,
    updateCapability,
    testCapability,
    submitCapability,
    offlineCapability,
    getStats,
    listEarnings,
  };
}

module.exports = { createDeveloperService, DEVELOPER_AGREEMENT_VERSION, DEVELOPER_SHARE_BP };
