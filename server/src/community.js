'use strict';
const crypto = require('node:crypto');
const { fail, fingerprint } = require('./payment_store');
const REASONS = new Set(['色情或低俗', '侮辱或攻击', '违法违规', '垃圾广告', '侵权或冒用', 'AI有害内容', '其他']);
const idOf = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value) ? value : null;
const keyOf = (...values) => crypto.createHash('sha256').update(values.join(':')).digest('hex');
const HIDDEN_STATES = new Set(['hidden', 'rejected', 'removed', 'deleted', 'blocked', 'draft', 'private']);
const suppressed = row => !row || row.isDeleted === true || !!row.deletedAt ||
  HIDDEN_STATES.has(row.moderationStatus) || HIDDEN_STATES.has(row.status);
function environment(value) {
  if (value === undefined || value === 'production' || value === 'Production') return 'Production';
  if (value === 'sandbox' || value === 'Sandbox') return 'Sandbox';
  throw fail(400, 'INVALID_ENVIRONMENT', '环境无效');
}
async function preferences(tx, user) {
  return tx.list('community_block', { owner: user.id, state: 'active', limit: 100 });
}
async function blocked(tx, blocks, row, kind) {
  const elfId = kind === 'elf' ? row.id : row.elfId || row.authorElfId;
  const elf = elfId ? await tx.get('elf', elfId) : null;
  const owner = kind === 'comment' ? row.userId || row.ownerId : elf?.ownerId || row.ownerId;
  if (elfId && (await tx.get('community_sanction', 'elf:' + elfId))?.active ||
      owner && (await tx.get('community_sanction', 'user:' + owner))?.active) return true;
  return blocks.some(block => (block.targetKind === 'elf' && block.targetId === elfId) ||
    (block.targetKind === 'user' && block.targetId === owner));
}
async function visible(tx, row, kind, blocks) {
  // Default display is an operator-selected policy, NOT an approval or safety verdict.
  // Preserve explicit takedowns, private/draft states, sanctions and user blocks.
  const original = await tx.get(kind, row.id);
  if (suppressed(original)) return false;
  if (kind === 'post') {
    const author = await tx.get('elf', original.elfId);
    if (suppressed(author)) return false;
  }
  if (kind === 'comment') {
    const parent = await tx.get('post', original.postId);
    const author = parent ? await tx.get('elf', parent.elfId) : null;
    if (suppressed(parent) || suppressed(author) || await blocked(tx, blocks, parent, 'post')) return false;
  }
  return !await blocked(tx, blocks, original, kind);
}
async function filterResult(tx, value, userId) {
  if (!value || !userId) return value;
  const user = { id: userId };
  const blocks = await preferences(tx, user);
  const filter = async (rows, kind) => {
    const result = [];
    for (const row of rows) if (await visible(tx, row, kind, blocks)) {
      if (kind === 'comment') {
        const raw = await tx.get('comment', row.id);
        result.push({ ...row, userId: raw.userId || null, authorElfId: raw.authorElfId || null });
      } else result.push(row);
    }
    return result;
  };
  const data = value.commerce || value;
  if (Array.isArray(data.posts)) data.posts = await filter(data.posts, 'post');
  if (Array.isArray(data.comments)) data.comments = await filter(data.comments, 'comment');
  if (Array.isArray(data.elves)) {
    const elves = [];
    for (const elf of data.elves) if (elf.isMine || await visible(tx, elf, 'elf', blocks)) elves.push(elf);
    data.elves = elves;
  }
  if (value.commerce) {
    data.community = { version: 1, blocks, reports: (await tx.list('community_report', { owner: userId, limit: 50 }))
      .map(row => ({ id: row.id, targetKind: row.targetKind, targetId: row.targetId,
        reason: row.reason, status: row.status, createdAt: row.createdAt, resolution: row.resolution || '' })) };
  }
  delete value.communityViewer;
  return value;
}

// New content is public by default. Client updates cannot undo a server takedown.
function wrapStore(base) {
  return { ...base, transaction(env, work) {
    return base.transaction(env, async original => {
      let viewer = null;
      const cache = new Map();
      const readTx = { ...original,
        async get(kind, id, lock = false) {
          const key = kind + ':' + id;
          if (!lock && cache.has(key)) return structuredClone(cache.get(key));
          const value = await original.get(kind, id, lock);
          cache.set(key, structuredClone(value)); return value;
        },
        async list(kind, options) {
          const rows = await original.list(kind, options);
          for (const row of rows) if (row.id) cache.set(kind + ':' + row.id, structuredClone(row));
          return rows;
        },
      };
      const tx = { ...readTx,
        async lockWallet(userId) { viewer ||= userId; return original.lockWallet(userId); },
        async put(kind, id, value, options = {}) {
          if (kind === 'post' || kind === 'comment' || kind === 'elf') {
            const existing = await original.get(kind, id);
            const status = existing?.moderationStatus || 'public';
            value = { ...value, moderationStatus: status };
            if (!existing) {
              if (await blocked(original, [], { ...value, ownerId: options.owner }, kind)) {
                throw fail(403, 'CONTENT_RESTRICTED', '该账号或AI已被限制发布内容，请通过反馈申诉');
              }
              if (kind !== 'elf' && viewer === options.owner && options.owner && !await original.get('community_terms', options.owner)) {
                throw fail(403, 'COMMUNITY_AGREEMENT_REQUIRED', '发布前请在设置→内容安全中阅读并同意社区规范');
              }
            }
          }
          await original.put(kind, id, value, options);
          cache.set(kind + ':' + id, structuredClone(value));
        },
      };
      const result = await work(tx);
      // Feed reads need not acquire a wallet; the service explicitly supplies viewer.
      return filterResult(readTx, result, viewer || result?.communityViewer);
    });
  } };
}

function createCommunityService(store) {
  async function submit(user, body = {}) {
    const env = environment(body.environment);
    const requestId = idOf(body.requestId);
    if (!requestId || requestId.length < 8) throw fail(400, 'INVALID_REQUEST_ID', '缺少提交编号');
    if (!REASONS.has(body.reason)) throw fail(400, 'INVALID_REASON', '请选择举报原因');
    const details = typeof body.details === 'string' ? body.details.trim() : '';
    if (details.length > 1000) throw fail(400, 'INVALID_DETAILS', '说明最多1000字');
    const kind = body.targetKind;
    const targetId = kind === 'feedback' ? 'feedback' : idOf(body.targetId);
    if (!['post', 'comment', 'elf', 'user', 'feedback'].includes(kind) || !targetId || (kind === 'feedback' && !details)) {
      throw fail(400, 'INVALID_TARGET', '举报对象或反馈内容无效');
    }
    return store.transaction(env, async tx => {
      await tx.lockWallet(user.id); // Serialize per-user limits and idempotency.
      const id = 'cr_' + keyOf(user.id, requestId);
      const hash = fingerprint({ kind, targetId, reason: body.reason, details });
      const old = await tx.get('community_report', id, true);
      if (old) {
        if (old.hash !== hash) throw fail(409, 'REQUEST_REUSED', '提交编号已被使用');
        return { id: old.id, status: old.status };
      }
      const recent = await tx.list('community_report', { owner: user.id, limit: 100 });
      if (recent.filter(row => Date.parse(row.createdAt) > Date.now() - 86400000).length >= 30) throw fail(429, 'REPORT_LIMIT', '今日提交次数已达上限');
      const target = kind === 'feedback' ? {} : kind === 'user' ? await tx.user(targetId) : await tx.get(kind, targetId);
      if (!target) throw fail(404, 'UNKNOWN_TARGET', '内容不存在或已删除');
      const row = { id, hash, reporterId: user.id, targetKind: kind, targetId,
        reason: body.reason, details, status: 'pending', createdAt: new Date().toISOString(),
        evidence: String(target.body || target.text || target.name || '').slice(0, 4000) };
      await tx.put('community_report', id, row, { owner: user.id, ref: targetId, state: 'pending' });
      return { id, status: 'pending' };
    });
  }
  async function setBlock(user, body = {}) {
    const env = environment(body.environment);
    if (!['elf', 'user'].includes(body.targetKind) || !idOf(body.targetId) || typeof body.blocked !== 'boolean') throw fail(400, 'INVALID_TARGET', '屏蔽对象无效');
    return store.transaction(env, async tx => {
      await tx.lockWallet(user.id);
      const kind = body.targetKind;
      const target = kind === 'elf' ? await tx.get('elf', body.targetId) : await tx.user(body.targetId);
      if (!target) throw fail(404, 'UNKNOWN_TARGET', '屏蔽对象不存在');
      if ((kind === 'user' && target.id === user.id) || (kind === 'elf' && target.ownerId === user.id)) throw fail(400, 'SELF_BLOCK', '不能屏蔽自己');
      const id = 'cb_' + keyOf(user.id, kind, body.targetId);
      const old = await tx.get('community_block', id);
      const rows = await preferences(tx, user);
      if (body.blocked && !rows.some(row => row.id === id) && rows.length >= 100) throw fail(409, 'BLOCK_LIMIT', '屏蔽名单已满，请先管理名单');
      const row = { id, targetKind: kind, targetId: body.targetId,
        label: String(target.name || target.nickname || '用户').slice(0, 80),
        createdAt: old?.createdAt || new Date().toISOString(), active: body.blocked };
      await tx.put('community_block', id, row, { owner: user.id, ref: body.targetId, state: body.blocked ? 'active' : 'removed' });
      return { blocks: await preferences(tx, user) };
    });
  }
  async function snapshot(user, hint) {
    return store.transaction(environment(hint), async tx => ({ version: 1, blocks: await preferences(tx, user),
      termsAccepted: !!await tx.get('community_terms', user.id),
      reports: (await tx.list('community_report', { owner: user.id, limit: 50 })).map(({ evidence, hash, reporterId, ...row }) => row) }));
  }
  async function acceptTerms(user, body = {}) {
    if (body.version !== '2026-10-28' || body.accepted !== true) throw fail(400, 'INVALID_AGREEMENT', '请明确同意当前社区规范');
    return store.transaction(environment(body.environment), async tx => {
      await tx.put('community_terms', user.id, { version: body.version, acceptedAt: new Date().toISOString() }, { owner: user.id });
      return { accepted: true, version: body.version };
    });
  }
  async function queue(hint, kind = 'content') {
    return store.transaction(environment(hint), async tx => {
      if (kind === 'reports') return { reports: await tx.list('community_report', { state: 'pending', limit: 100 }) };
      // Retain historical queue/audit records; do not enqueue or approve old content.
      const rows = await tx.list('community_queue', { state: 'pending', limit: 100 });
      const items = [];
      for (const row of rows) items.push({ ...row, content: await tx.get(row.targetKind, row.targetId) });
      return { items };
    });
  }
  async function review(body, reviewer) {
    const env = environment(body.environment);
    if (!['approve', 'hide', 'dismiss'].includes(body.action) || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 500) throw fail(400, 'INVALID_REVIEW', '请填写处理动作和理由');
    return store.transaction(env, async tx => {
      // Locks a stable row to serialize decisions, without modifying any balances.
      const kind = body.kind === 'report' ? 'community_report' : 'community_queue';
      const row = await tx.get(kind, body.id, true);
      if (!row) throw fail(404, 'UNKNOWN_REVIEW', '审核记录不存在');
      if (row.status !== 'pending') throw fail(409, 'ALREADY_REVIEWED', '已经处理，请勿重复审核');
      if (kind === 'community_queue' && body.action === 'dismiss') throw fail(400, 'INVALID_REVIEW', '内容审核只能通过或下架');
      if (kind === 'community_report' && body.action === 'approve') throw fail(400, 'INVALID_REVIEW', '举报请执行下架或不成立');
      if ((['post', 'comment'].includes(row.targetKind) || kind === 'community_queue' && row.targetKind === 'elf') && body.action !== 'dismiss') {
        const content = await tx.get(row.targetKind, row.targetId, true);
        if (!content) throw fail(404, 'UNKNOWN_TARGET', '内容已删除');
        if (body.action === 'approve' && row.targetKind === 'elf' && content.ownerId &&
            !await tx.get('community_terms', content.ownerId)) {
          throw fail(403, 'COMMUNITY_AGREEMENT_REQUIRED', '用户尚未同意公开创作的社区规范，请勿批准公开资料');
        }
        // Deliberately use the undecorated transaction: only this privileged review
        // path may assign approval, never a client-originated put().
        await tx.put(row.targetKind, row.targetId, { ...content, moderationStatus: body.action === 'approve' ? 'approved' : 'hidden' },
          { owner: content.userId || content.ownerId || row.ownerId || null, ref: content.elfId || content.postId,
            state: row.targetKind === 'elf' ? content.status || (content.isOfficial ? 'official' : 'owned') : body.action === 'approve' ? 'approved' : 'hidden' });
        if (body.action === 'hide') {
          const key = row.targetKind + ':' + row.targetId;
          const queued = await tx.get('community_queue', key, true);
          if (queued?.status === 'pending') await tx.put('community_queue', key,
            { ...queued, status: 'hidden', resolution: body.reason, reviewedAt: new Date().toISOString(), reviewer },
            { owner: queued.ownerId, state: 'hidden', ref: row.targetId });
        }
      } else if (['elf', 'user'].includes(row.targetKind) && body.action === 'hide') {
        await tx.put('community_sanction', row.targetKind + ':' + row.targetId,
          { active: true, reason: body.reason.trim(), reviewedAt: new Date().toISOString(), reviewer }, { ref: row.targetId, state: 'active' });
      } else if (body.action === 'hide') throw fail(400, 'INVALID_REVIEW', '反馈请回复处理结果，不可下架');
      const status = body.action === 'approve' ? 'approved' : body.action === 'hide' ? 'hidden' : 'dismissed';
      const updated = { ...row, status, resolution: body.reason.trim(), reviewedAt: new Date().toISOString(), reviewer };
      await tx.put(kind, row.id, updated, { owner: row.reporterId || row.ownerId || null, ref: row.targetId, state: status });
      await tx.put('community_audit', crypto.randomUUID(), { id: row.id, kind, action: body.action, reason: body.reason.trim(), reviewer, at: updated.reviewedAt }, { ref: row.id });
      return { id: row.id, status };
    });
  }
  return { submit, setBlock, snapshot, queue, review, acceptTerms };
}
function registerCommunity(app, { store, reviewStore, authenticate, reviewToken = '', compliance = null }) {
  const service = createCommunityService(store);
  const reviews = createCommunityService(reviewStore);
  const guarded = handler => async request => {
    const { user } = await authenticate(request);
    return handler(user, request.body || request.query || {});
  };
  app.get('/api/v1/community', guarded((user, query) => service.snapshot(user, query.environment)));
  app.get('/api/v1/community/feed', guarded((user, query) =>
    require('./public_feed').publicFeed(reviewStore, user, query, compliance)));
  app.post('/api/v1/community/reports', { bodyLimit: 8192, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, guarded(service.submit));
  app.post('/api/v1/community/blocks', { bodyLimit: 4096 }, guarded(service.setBlock));
  app.post('/api/v1/community/terms', { bodyLimit: 4096 }, guarded(service.acceptTerms));
  app.addHook('preHandler', async request => {
    if (request.routeOptions.url !== '/api/v1/elf-chat') return;
    const { user } = await authenticate(request);
    await store.transaction('Production', async tx => {
      const elf = await tx.get('elf', request.body?.elfId || '');
      if (elf && elf.ownerId !== user.id && suppressed(elf)) {
        throw fail(403, 'CONTENT_BLOCKED', '该AI的公开资料已被隐藏或下架');
      }
      if (elf && await blocked(tx, await preferences(tx, user), elf, 'elf')) {
        throw fail(403, 'CONTENT_BLOCKED', '该AI已被屏蔽或限制使用');
      }
    });
  });
  const authorize = request => {
    if (reviewToken.length < 32) throw fail(503, 'REVIEW_DISABLED', '内容审核管理未配置');
    const supplied = String(request.headers.authorization || '').replace(/^Bearer /, '');
    const digest = text => crypto.createHash('sha256').update(text).digest();
    if (!crypto.timingSafeEqual(digest(supplied), digest(reviewToken))) throw fail(401, 'UNAUTHORIZED', '无权访问');
  };
  app.get('/internal/community/queue', async request => { authorize(request); return reviews.queue(request.query.environment, request.query.kind); });
  app.post('/internal/community/review', { bodyLimit: 8192 }, async request => { authorize(request); return reviews.review(request.body || {}, 'community-operator'); });
  return service;
}
module.exports = { wrapStore, createCommunityService, registerCommunity, filterResult, environment };
