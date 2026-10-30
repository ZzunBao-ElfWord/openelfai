'use strict';

const crypto = require('node:crypto');
const { fail } = require('./payment_store');

/// 内容审核词库：覆盖涉政、涉黄、涉暴、涉未成年人、违法交易、诈骗与隐私买卖。
/// 采用包含匹配，命中即拦截；宁可误伤由人工复核，也不让明显违规内容落库。
const BLOCKED_TERMS = [
  // 涉黄
  '色情', '裸体', '走光', '淫秽', '嫖娼', '卖淫', '约炮', '性交易', '成人视频', '黄片',
  '换脸', '偷拍', '迷奸', '强奸', '轮奸', '乱伦', '幼交', '萝莉', '正太',
  // 涉暴与恐怖
  '血腥', '肢解', '碎尸', '虐杀', '恐怖袭击', '自制炸弹', '炸弹制作', '制枪', '枪支买卖',
  '砍杀', '杀人', '自杀教程', '自残', '虐待动物',
  // 涉未成年人
  '未成年', '儿童色情', '幼女', '童妓', '拐卖儿童', '体罚儿童',
  // 涉政与违法
  '颠覆国家', '分裂国家', '反动', '邪教', '法轮功', '政治敏感', '游行示威', '暴乱',
  '毒品', '冰毒', '海洛因', '大麻交易', '贩毒', '制毒', '吸毒工具',
  '赌博', '博彩', '洗钱', '诈骗', '传销', '刷单', '高利贷', '套路贷', '裸贷',
  // 隐私与人身攻击
  '开盒', '人肉', '身份证号买卖', '手机号买卖', '户籍查询', '定位追踪',
  '傻逼', '操你', '全家死', '去死',
];

const ZERO_WIDTH_RE = /[\u200b-\u200f\u2028\u2029\ufeff]/g;

function normalizeForCheck(text) {
  return String(text || '').toLowerCase()
    .replace(ZERO_WIDTH_RE, '')
    .replace(/[\s,，.。!！?？、;；:：'"“”‘’()（）【】\[\]<>《》/\\|_\-*#~·•^+=@$%&]/g, '');
}

/// 返回命中的违规词，未命中返回 null。
function moderateText(text) {
  if (typeof text !== 'string' || !text) return null;
  const normalized = normalizeForCheck(text);
  if (!normalized) return null;
  return BLOCKED_TERMS.find((term) => normalized.includes(term)) || null;
}

const REPORT_TARGETS = new Set(['post', 'comment', 'elf', 'user', 'chat']);
const REPORT_REASONS = new Set([
  'porn', 'violence', 'minors', 'politics', 'illegal', 'harassment', 'fraud', 'privacy', 'other',
]);
const OBJECT_RE = /^[A-Za-z0-9_-]{1,160}$/;
const USER_RE = /^u_[a-f0-9]{32}$/;
const MAX_DETAIL = 500;

const COMPLIANCE_TABLES = [
  `CREATE TABLE IF NOT EXISTS compliance_reports (
    id VARCHAR(48) PRIMARY KEY,
    user_id VARCHAR(40) NOT NULL,
    target_type VARCHAR(16) NOT NULL,
    target_id VARCHAR(160) NOT NULL,
    reason VARCHAR(32) NOT NULL,
    detail VARCHAR(500) NOT NULL DEFAULT '',
    state VARCHAR(16) NOT NULL DEFAULT 'open',
    environment VARCHAR(20) NOT NULL DEFAULT 'Production',
    created_at VARCHAR(32) NOT NULL,
    resolved_at VARCHAR(32) NULL,
    resolved_by VARCHAR(64) NULL,
    resolution VARCHAR(32) NULL,
    note VARCHAR(500) NULL,
    INDEX idx_reports_state_created (state, created_at),
    INDEX idx_reports_target (target_type, target_id),
    INDEX idx_reports_user (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS compliance_blocks (
    user_id VARCHAR(40) NOT NULL,
    target_type VARCHAR(16) NOT NULL,
    target_id VARCHAR(160) NOT NULL,
    created_at VARCHAR(32) NOT NULL,
    PRIMARY KEY (user_id, target_type, target_id),
    INDEX idx_blocks_target (target_type, target_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

function readId(value, message) {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!OBJECT_RE.test(id)) throw fail(400, 'INVALID_TARGET', message);
  return id;
}

function readDetail(value) {
  const detail = typeof value === 'string' ? value.trim() : '';
  if ([...detail].length > MAX_DETAIL) throw fail(400, 'INVALID_DETAIL', '补充说明过长');
  return detail;
}

/// 举报、拉黑与账号注销：数据独立于交易环境表，跨 iOS / 安卓共享同一份。
function createComplianceService({ db, store }) {
  /// 举报不区分客户端环境：对象可能只存在于 Sandbox 或 Production 之一。
  async function resolveTargetEnvironment(preferred, targetType, targetId) {
    if (targetType === 'user') {
      const [rows] = await db.execute('SELECT id FROM users WHERE id = ?', [targetId]);
      return rows.length ? preferred : null;
    }
    if (targetType === 'chat') return preferred;
    const [rows] = await db.execute(
      'SELECT environment FROM payment_objects WHERE kind = ? AND object_id = ? LIMIT 2',
      [targetType, targetId],
    );
    if (!rows.length) return null;
    const match = rows.find((row) => row.environment === preferred);
    return match ? preferred : rows[0].environment;
  }

  async function submitReport(user, body) {
    const targetType = String(body?.targetType || '').trim();
    if (!REPORT_TARGETS.has(targetType)) throw fail(400, 'INVALID_TARGET_TYPE', '举报对象类型无效');
    const targetId = readId(body?.targetId, '举报对象无效');
    const reason = String(body?.reason || '').trim();
    if (!REPORT_REASONS.has(reason)) throw fail(400, 'INVALID_REASON', '请选择举报原因');
    const detail = readDetail(body?.detail);
    const preferred = body?.environment === 'Sandbox' ? 'Sandbox' : 'Production';
    if (targetType === 'user' && targetId === user.id) throw fail(409, 'SELF_REPORT', '不能举报自己');
    const environment = await resolveTargetEnvironment(preferred, targetType, targetId);
    if (!environment) throw fail(404, 'TARGET_NOT_FOUND', '举报对象不存在或已删除');

    // 同一用户对同一对象、同一原因只保留一条待处理举报，重复提交直接返回原记录。
    const [existing] = await db.execute(
      `SELECT * FROM compliance_reports
       WHERE user_id = ? AND target_type = ? AND target_id = ? AND reason = ? AND state = 'open'
       ORDER BY created_at DESC LIMIT 1`,
      [user.id, targetType, targetId, reason],
    );
    let report = existing[0];
    if (!report) {
      report = {
        id: 'rp_' + crypto.randomUUID().replace(/-/g, ''),
        user_id: user.id,
        target_type: targetType,
        target_id: targetId,
        reason,
        detail,
        state: 'open',
        environment,
        created_at: new Date().toISOString(),
      };
      await db.execute(
        `INSERT INTO compliance_reports
          (id, user_id, target_type, target_id, reason, detail, state, environment, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [report.id, report.user_id, report.target_type, report.target_id, report.reason,
          report.detail, report.state, report.environment, report.created_at],
      );
    }

    // 举报时可一并拉黑，立即从信息流与评论中隐藏。
    if (body?.block === true) {
      if (targetType === 'elf') await blockTarget(user, 'elf', targetId);
      if (targetType === 'user') await blockTarget(user, 'user', targetId);
    }

    return { report: publicReport(report) };
  }

  function publicReport(row) {
    return {
      id: row.id,
      targetType: row.target_type,
      targetId: row.target_id,
      reason: row.reason,
      detail: row.detail,
      state: row.state,
      createdAt: row.created_at,
    };
  }

  async function listMine(user) {
    const [rows] = await db.execute(
      `SELECT * FROM compliance_reports WHERE user_id = ?
       ORDER BY created_at DESC LIMIT 100`, [user.id],
    );
    return { reports: rows.map(publicReport) };
  }

  async function blockTarget(user, targetType, targetId) {
    if (targetType === 'user') {
      if (!USER_RE.test(targetId)) throw fail(400, 'INVALID_TARGET', '用户无效');
      if (targetId === user.id) throw fail(409, 'SELF_BLOCK', '不能拉黑自己');
      const [rows] = await db.execute('SELECT id FROM users WHERE id = ?', [targetId]);
      if (!rows.length) throw fail(404, 'TARGET_NOT_FOUND', '用户不存在');
    } else if (targetType === 'elf') {
      const [rows] = await db.execute(
        "SELECT owner_id FROM payment_objects WHERE kind = 'elf' AND object_id = ? LIMIT 1", [targetId],
      );
      if (!rows.length) throw fail(404, 'TARGET_NOT_FOUND', 'AI 不存在');
      if (rows[0].owner_id === user.id) throw fail(409, 'SELF_BLOCK', '不能拉黑自己的 AI');
    } else {
      throw fail(400, 'INVALID_TARGET_TYPE', '拉黑对象类型无效');
    }
    await db.execute(
      `INSERT IGNORE INTO compliance_blocks (user_id, target_type, target_id, created_at)
       VALUES (?, ?, ?, ?)`, [user.id, targetType, targetId, new Date().toISOString()],
    );
  }

  async function block(user, body) {
    const targetType = body?.userId ? 'user' : 'elf';
    const targetId = readId(body?.userId || body?.elfId, '请选择要拉黑的对象');
    await blockTarget(user, targetType, targetId);
    return listBlocks(user);
  }

  async function unblock(user, body) {
    const targetType = body?.userId ? 'user' : 'elf';
    const targetId = readId(body?.userId || body?.elfId, '请选择要取消拉黑的对象');
    await db.execute(
      'DELETE FROM compliance_blocks WHERE user_id = ? AND target_type = ? AND target_id = ?',
      [user.id, targetType, targetId],
    );
    return listBlocks(user);
  }

  async function listBlocks(user) {
    const [rows] = await db.execute(
      'SELECT target_type, target_id, created_at FROM compliance_blocks WHERE user_id = ? ORDER BY created_at DESC',
      [user.id],
    );
    return {
      blocks: rows.map((row) => ({
        type: row.target_type, id: row.target_id, createdAt: row.created_at,
      })),
    };
  }

  /// 信息流与评论过滤所需的最小集合。
  async function blockedSets(user) {
    const [rows] = await db.execute(
      'SELECT target_type, target_id FROM compliance_blocks WHERE user_id = ?', [user.id],
    );
    const elves = new Set();
    const users = new Set();
    for (const row of rows) {
      if (row.target_type === 'elf') elves.add(row.target_id);
      else if (row.target_type === 'user') users.add(row.target_id);
    }
    return { elves, users };
  }

  async function listReports({ state = 'open', targetType = '', environment = '', page = 0, size = 20 } = {}) {
    const filters = [];
    const params = [];
    if (state && state !== 'all') { filters.push('state = ?'); params.push(state); }
    if (REPORT_TARGETS.has(targetType)) { filters.push('target_type = ?'); params.push(targetType); }
    if (environment === 'Production' || environment === 'Sandbox') {
      filters.push('environment = ?'); params.push(environment);
    }
    const where = filters.length ? 'WHERE ' + filters.join(' AND ') : '';
    const [counts] = await db.execute(`SELECT COUNT(*) AS n FROM compliance_reports ${where}`, params);
    const limit = Math.max(1, Math.min(100, Number(size) || 20));
    const offset = Math.max(0, Number(page) || 0) * limit;
    const [rows] = await db.execute(
      `SELECT * FROM compliance_reports ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    return {
      items: rows.map((row) => ({
        ...publicReport(row),
        userId: row.user_id,
        environment: row.environment,
        resolvedAt: row.resolved_at,
        resolvedBy: row.resolved_by,
        resolution: row.resolution,
        note: row.note,
      })),
      total: Number(counts[0]?.n || 0),
      page: Math.max(0, Number(page) || 0),
      pageSize: limit,
    };
  }

  /// 管理后台或运维复核：忽略举报，或下架被举报内容。
  async function resolveReport(id, { action, note = '', reviewer = 'admin' } = {}) {
    if (!['dismiss', 'remove_content'].includes(action)) throw fail(400, 'INVALID_ACTION', '处理动作无效');
    const noteText = readDetail(note);
    const [rows] = await db.execute('SELECT * FROM compliance_reports WHERE id = ?', [id]);
    const report = rows[0];
    if (!report) throw fail(404, 'REPORT_NOT_FOUND', '举报不存在');
    if (report.state !== 'open') throw fail(409, 'REPORT_CLOSED', '该举报已处理');

    const now = new Date().toISOString();
    if (action === 'remove_content') {
      if (report.target_type === 'post') {
        await db.execute(
          "UPDATE payment_objects SET state = 'deleted', updated_at = ? WHERE environment = ? AND kind = 'post' AND object_id = ?",
          [now, report.environment, report.target_id],
        );
      } else if (report.target_type === 'comment') {
        await db.execute(
          "UPDATE payment_objects SET state = 'removed', updated_at = ? WHERE environment = ? AND kind = 'comment' AND object_id = ?",
          [now, report.environment, report.target_id],
        );
      } else {
        throw fail(409, 'CONTENT_TYPE_UNSUPPORTED', '该类型内容请在对应管理页面处理');
      }
    }

    const state = action === 'dismiss' ? 'dismissed' : 'resolved';
    await db.execute(
      `UPDATE compliance_reports
       SET state = ?, resolution = ?, resolved_at = ?, resolved_by = ?, note = ? WHERE id = ?`,
      [state, action, now, reviewer, noteText, report.id],
    );
    return { id: report.id, state, resolution: action };
  }

  /// 待审核媒体：用户上传的视频先进入 pending_review，人工复核通过后才进入信息流。
  async function listPendingMedia({ environment = '', page = 0, size = 20 } = {}) {
    const filters = ["kind = 'post'", "state = 'pending_review'"];
    const params = [];
    if (environment === 'Production' || environment === 'Sandbox') {
      filters.push('environment = ?');
      params.push(environment);
    }
    const where = 'WHERE ' + filters.join(' AND ');
    const [counts] = await db.execute(`SELECT COUNT(*) AS n FROM payment_objects ${where}`, params);
    const limit = Math.max(1, Math.min(100, Number(size) || 20));
    const offset = Math.max(0, Number(page) || 0) * limit;
    const [rows] = await db.execute(
      `SELECT environment, object_id, owner_id, payload, updated_at FROM payment_objects
       ${where} ORDER BY updated_at ASC LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    return {
      items: rows.map((row) => {
        let payload = {};
        try { payload = JSON.parse(row.payload); } catch (_) { payload = {}; }
        return {
          id: row.object_id,
          environment: row.environment,
          userId: row.owner_id,
          elfId: payload.elfId || '',
          kind: payload.kind || 'post',
          body: payload.body || '',
          videoUrl: payload.videoUrl || null,
          coverUrl: payload.coverUrl || null,
          context: payload.context || '',
          createdAt: payload.createdAt || row.updated_at,
        };
      }),
      total: Number(counts[0]?.n || 0),
      page: Math.max(0, Number(page) || 0),
      pageSize: limit,
    };
  }

  async function reviewMedia(id, { environment = 'Production', action, reviewer = 'admin', note = '' } = {}) {
    if (!['approve', 'reject'].includes(action)) throw fail(400, 'INVALID_ACTION', '处理动作无效');
    const env = environment === 'Sandbox' ? 'Sandbox' : 'Production';
    const [rows] = await db.execute(
      "SELECT object_id FROM payment_objects WHERE environment = ? AND kind = 'post' AND object_id = ?",
      [env, id],
    );
    if (!rows.length) throw fail(404, 'MEDIA_NOT_FOUND', '内容不存在');
    const state = action === 'approve' ? '' : 'rejected';
    await db.execute(
      'UPDATE payment_objects SET state = ?, updated_at = ? WHERE environment = ? AND kind = ? AND object_id = ?',
      [state, new Date().toISOString(), env, 'post', id],
    );
    // 复核动作由管理后台审计日志记录，这里只回写内容状态。
    return { id, state: action, reviewer: String(reviewer).slice(0, 64), note: note.slice(0, 500) };
  }

  /// 注销账号：清除个人资料与内容，保留依法必须留存的交易账本。
  async function deleteAccount(user) {
    // Both HTTP entry points share the audited, transactional balance checks.
    return require('./account_deletion').deleteAccount(db, user.id);
  }

  return {
    submitReport, listMine, block, unblock, listBlocks, blockedSets,
    listReports, resolveReport, listPendingMedia, reviewMedia, deleteAccount,
  };
}

module.exports = {
  BLOCKED_TERMS, COMPLIANCE_TABLES, createComplianceService, moderateText,
};
