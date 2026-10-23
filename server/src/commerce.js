'use strict';

const crypto = require('node:crypto');
const { changeBalance, fingerprint, fail } = require('./payment_store');

const CATALOG = [
  { id: 'pm_001', name: '尘', elfId: 'pm_dust', title: '尘 · 第 1 代', price: 1280, slots: 2, generation: 1, edition: '初版', equipped: [] },
  { id: 'pm_002', name: '摩卡', elfId: 'pm_mocha', title: '摩卡 · 第 2 代', price: 2880, slots: 3, generation: 2, edition: '视觉版', equipped: ['vision'] },
  { id: 'pm_003', name: '柯', elfId: 'pm_ko', title: '柯 · 第 3 代', price: 3680, slots: 6, generation: 3, edition: '扩展版', equipped: [] },
];
const MODULES = { sharp: [1,3,'text'], writing: [2,24,'text'], rhythm: [1,2,'text'], vision: [2,20,'image'],
  imageedit: [1,12,'image'], video: [3,48,'video'], voice: [1,18,'audio'], music: [2,30,'audio'],
  retrieval: [1,6,'quote'], deep: [3,36,'text'], memory: [1,4,'text'], source: [1,5,'quote'], mingle: [1,8,'reply'], think: [2,15,'text'], auto: [2,0,'text'] };
const MODULE_PRICES = { sharp: 28, writing: 128, rhythm: 18, vision: 88, imageedit: 68,
  video: 298, voice: 98, music: 168, retrieval: 38, deep: 198, memory: 68, source: 48,
  mingle: 48, think: 158, auto: 198 };
const USER_RE = /^u_[a-f0-9]{32}$/;
const REQUEST_RE = /^[A-Za-z0-9_-]{16,100}$/;

function newElf(user, template, id) {
  return { id, serial: '#' + id.slice(-8), name: template.name, initial: template.name[0],
    ownerId: user.id, ownerLabel: user.nickname, generation: template.generation || 1,
    edition: template.edition || '初版', persona: '还没写', fear: '还没写', habit: '还没写', status: 'owned',
    energy: 160, maxEnergy: 320, followers: 0, echo: 0, works: 0, attention: 0, slots: template.slots,
    equipped: [...template.equipped], ownedModules: [...template.equipped], today: [], relations: [] };
}

function createCommerceService({ store, settings }) {
  function environment(hint) {
    if (hint != null && !['Sandbox', 'sandbox', 'Production', 'production'].includes(hint)) throw fail(400, 'INVALID_ENVIRONMENT', '交易环境无效');
    const value = hint === 'Sandbox' || hint === 'sandbox' ? 'Sandbox' :
      hint === 'Production' || hint === 'production' ? 'Production' : settings.sandboxOnly ? 'Sandbox' : 'Production';
    if (settings.sandboxOnly && value !== 'Sandbox' || value === 'Sandbox' && !settings.allowSandbox) {
      throw fail(403, 'ENVIRONMENT_DISABLED', '当前交易环境尚未开放');
    }
    return value;
  }
  async function ensureProfile(tx, user, wallet) {
    let profile = await tx.get('profile', user.id, true);
    if (!profile) {
      const id = 'starter_' + user.id.slice(2);
      const elf = newElf(user, { name: '青梧', slots: 4, equipped: ['sharp', 'rhythm'] }, id);
      profile = { activeElfId: id, revision: 1 };
      await tx.put('elf', id, elf, { owner: user.id });
      await tx.put('profile', user.id, profile, { owner: user.id });
    }
    return profile;
  }
  async function snapshot(user, hint) {
    const env = environment(hint);
    return store.transaction(env, async (tx) => {
      const wallet = await tx.lockWallet(user.id);
      const profile = await ensureProfile(tx, user, wallet);
      const assets = new Map((await tx.list('elf')).map((elf) => [elf.id, elf]));
      for (const elf of await tx.list('elf', { owner: user.id })) assets.set(elf.id, elf);
      const listings = await tx.list('listing', { state: 'open' });
      const posts = await tx.list('post', { limit: 100 });
      for (const id of new Set([...listings.map((l) => l.elfId), ...posts.map((p) => p.elfId), profile.activeElfId].filter(Boolean))) {
        if (!assets.has(id)) { const elf = await tx.get('elf', id); if (elf) assets.set(id, elf); }
      }
      return { mode: env.toLowerCase(), wallet, commerce: {
        activeElfId: profile.activeElfId, revision: profile.revision || 0, earningsFen: wallet.earningsFen,
        modulePrices: MODULE_PRICES,
        elves: [...assets.values()].map((elf) => ({ ...elf, isMine: elf.ownerId === user.id && elf.status === 'owned',
          earningsYuan: elf.ownerId === user.id ? wallet.earningsFen / 100 : 0 })),
        primary: CATALOG.map((item) => ({ ...item, market: 'primary', subtitle: '官方首发', note: '由服务器登记持有权益' })),
        secondary: listings.map((item) => ({ ...item, market: 'secondary', subtitle: '服务器登记的寄售',
          sellerLabel: item.sellerId === user.id ? '我 (寄售)' : item.sellerLabel })),
        posts, logs: await tx.logs(user.id),
      } };
    });
  }
  async function action(user, body) {
    if (!settings.enabled) throw fail(503, 'PAYMENTS_DISABLED', '消费服务尚未开放');
    if (!REQUEST_RE.test(body?.requestId || '')) throw fail(400, 'INVALID_REQUEST_ID', '缺少操作编号');
    const env = environment(body.environment);
    const { type, requestId } = body;
    const payload = { ...body };
    delete payload.requestId;
    const hash = fingerprint(Object.fromEntries(Object.entries(payload).sort(([a], [b]) => a.localeCompare(b))));
    await store.transaction(env, async (tx) => {
      let sellerId = null;
      if (type === 'buy' && !CATALOG.some((l) => l.id === body.listingId)) {
        sellerId = (await tx.get('listing', body.listingId || ''))?.sellerId;
      } else if (type === 'tip') sellerId = (await tx.get('elf', body.elfId || ''))?.ownerId;
      const wallets = new Map();
      for (const id of [...new Set([user.id, sellerId].filter(Boolean))].sort()) {
        if (!USER_RE.test(id) || (await tx.user(id))?.status !== 'active') throw fail(404, 'UNKNOWN_OWNER', '该内容暂不支持付费');
        wallets.set(id, await tx.lockWallet(id));
      }
      const wallet = wallets.get(user.id);
      const receiptId = user.id + ':' + requestId;
      const existing = await tx.get('request', receiptId, true);
      if (existing) {
        if (existing.hash !== hash) throw fail(409, 'REQUEST_REUSED', '操作编号已用于其他请求');
        return;
      }
      if (wallet.refundDebt > 0) throw fail(409, 'REFUND_DEBT', '请先补足退款欠额后再消费');
      if ((await tx.list('alipay_review', { owner: user.id, state: 'needs_review', limit: 1, lock: true })).length) {
        throw fail(409, 'PAYMENT_REVIEW', '有退款或异常付款待人工核对，消费暂时暂停');
      }
      const profile = await ensureProfile(tx, user, wallet);
      const eventId = 'action:' + requestId;
      const saveElf = (elf) => tx.put('elf', elf.id, elf, { owner: elf.ownerId });
      const earn = async (id, amount) => {
        const target = wallets.get(id);
        // Earnings are pending bookkeeping only; there is no cash withdrawal API.
        target.earningsFen += amount * 5;
        target.version++;
        await tx.saveWallet(id, target);
      };
      if (type === 'buy') {
        if (profile.activeElfId) throw fail(409, 'ALREADY_OWNS_ELF', '请先售出当前 AI，再购买新的 AI');
        const template = CATALOG.find((item) => item.id === body.listingId);
        let elf;
        if (template) {
          elf = newElf(user, template, 'e_' + crypto.randomUUID().replaceAll('-', ''));
          await changeBalance(tx, user.id, wallet, { eventId, type: 'buy_elf', amount: -template.price, spend: true, note: '买入 ' + template.name });
        } else {
          const listing = await tx.get('listing', body.listingId || '', true);
          if (!listing || listing.state !== 'open' || listing.sellerId !== sellerId) throw fail(409, 'LISTING_UNAVAILABLE', '挂单已失效');
          if (sellerId === user.id) throw fail(409, 'SELF_PURCHASE', '不能购买自己的挂单');
          elf = await tx.get('elf', listing.elfId, true);
          const seller = await tx.get('profile', sellerId, true);
          if (!elf || elf.ownerId !== sellerId || elf.status !== 'listed' || !seller) throw fail(409, 'LISTING_UNAVAILABLE', '权益状态已变化');
          if (wallets.get(sellerId).refundDebt > 0) throw fail(409, 'SELLER_FROZEN', '该挂单暂不可交易');
          await changeBalance(tx, user.id, wallet, { eventId, type: 'buy_elf', amount: -listing.price, spend: true, note: '买入 ' + elf.name });
          await earn(sellerId, listing.price);
          if (seller.activeElfId === elf.id) seller.activeElfId = null;
          seller.revision = (seller.revision || 0) + 1;
          await tx.put('profile', sellerId, seller, { owner: sellerId });
          listing.state = 'sold';
          await tx.put('listing', listing.id, listing, { owner: sellerId, state: 'sold' });
          elf.ownerId = user.id; elf.ownerLabel = user.nickname; elf.status = 'owned';
        }
        profile.activeElfId = elf.id;
        await saveElf(elf);
        await tx.put('profile', user.id, profile, { owner: user.id });
      } else if (type === 'tip') {
        if (![5, 10, 50, 100].includes(body.amount)) throw fail(400, 'INVALID_TIP', '打赏档位无效');
        const elf = await tx.get('elf', body.elfId || '', true);
        if (!elf || elf.ownerId !== sellerId || elf.status !== 'owned') throw fail(404, 'UNKNOWN_ELF', '该 AI 暂不支持打赏');
        if (sellerId === user.id) throw fail(409, 'SELF_TIP', '不能给自己打赏');
        if (body.postId) {
          const post = await tx.get('post', body.postId);
          if (!post || post.elfId !== elf.id) throw fail(400, 'INVALID_POST', '内容与 AI 不匹配');
        }
        await changeBalance(tx, user.id, wallet, { eventId, type: 'tip_out', amount: -body.amount, spend: true, note: '打赏 ' + elf.name });
        await earn(sellerId, body.amount);
        elf.attention += body.amount;
        await saveElf(elf);
      } else {
        let elf = profile.activeElfId ? await tx.get('elf', profile.activeElfId, true) : null;
        if (type === 'cancel_resell') {
          if (profile.activeElfId) throw fail(409, 'ALREADY_OWNS_ELF', '请先空出持有位再撤回寄售');
          const listing = body.listingId ? await tx.get('listing', body.listingId, true) :
            (await tx.list('listing', { owner: user.id, state: 'open' }))[0];
          if (listing?.sellerId === user.id) elf = await tx.get('elf', listing.elfId, true);
        }
        if (!elf || elf.ownerId !== user.id) throw fail(409, 'NO_OWNED_ELF', '你没有可操作的 AI');
        if (body.elfId && body.elfId !== elf.id) throw fail(409, 'OWNERSHIP_CHANGED', '当前持有的 AI 已变化，请刷新');
        if (type === 'resell') {
          if (elf.status !== 'owned' || !Number.isSafeInteger(body.price) || body.price < 1 || body.price > 1000000) throw fail(400, 'INVALID_LISTING', '寄售价或持有状态无效');
          const id = 'sl_' + crypto.randomUUID().replaceAll('-', '');
          const listing = { id, elfId: elf.id, title: elf.name + ' · 转卖', price: body.price,
            sellerId: user.id, sellerLabel: user.nickname, equippedCarry: [...elf.equipped], edition: elf.edition, state: 'open' };
          await tx.put('listing', id, listing, { owner: user.id, state: 'open' });
          elf.status = 'listed'; elf.listingId = id;
          profile.activeElfId = null;
        } else if (type === 'cancel_resell') {
          const listing = elf.listingId ? await tx.get('listing', elf.listingId, true) : null;
          if (!listing || listing.sellerId !== user.id || listing.state !== 'open') throw fail(409, 'LISTING_UNAVAILABLE', '挂单已失效');
          listing.state = 'cancelled';
          await tx.put('listing', listing.id, listing, { owner: user.id, state: 'cancelled' });
          elf.status = 'owned'; delete elf.listingId;
          profile.activeElfId = elf.id;
        } else if (type === 'buy_module') {
          const price = Object.hasOwn(MODULE_PRICES, body.moduleId) ? MODULE_PRICES[body.moduleId] : null;
          if (!price || elf.status !== 'owned') throw fail(400, 'INVALID_MODULE', '模块或持有状态无效');
          elf.ownedModules ||= [...elf.equipped];
          if (!elf.ownedModules.includes(body.moduleId)) {
            await changeBalance(tx, user.id, wallet, { eventId, type: 'buy_module', amount: -price, spend: true, note: '购买能力包 ' + body.moduleId });
            elf.ownedModules.push(body.moduleId);
          }
        } else if (type === 'elf_update') {
          if (elf.status !== 'owned') throw fail(409, 'ELF_LISTED', '寄售中的 AI 不能修改');
          if (body.operation === 'equip') {
            if (!Object.hasOwn(MODULES, body.moduleId)) throw fail(400, 'UNKNOWN_MODULE', '模块不存在');
            if (!(elf.ownedModules || elf.equipped).includes(body.moduleId)) throw fail(409, 'MODULE_NOT_OWNED', '请先购买这个能力包');
            if (!elf.equipped.includes(body.moduleId)) elf.equipped.push(body.moduleId);
            if (elf.equipped.reduce((sum, id) => sum + MODULES[id][0], 0) > elf.slots) throw fail(409, 'NO_SLOTS', '接口不足');
            if (body.moduleId === 'auto' && !elf.nextAutoPostAt) elf.nextAutoPostAt = Date.now() + 15 * 60000;
          } else if (body.operation === 'unequip') elf.equipped = elf.equipped.filter((id) => id !== body.moduleId);
          else if (body.operation === 'inject') {
            if (!Number.isSafeInteger(body.amount) || body.amount < 1 || body.amount > 320) throw fail(400, 'INVALID_ENERGY', '算力数量无效');
            if (elf.energy + body.amount > elf.maxEnergy) throw fail(409, 'ENERGY_OVERFLOW', '超过算力上限，请减少注入数量');
            await changeBalance(tx, user.id, wallet, { eventId, type: 'inject', amount: -body.amount * 10, spend: true, note: '注入算力 ' + body.amount });
            elf.energy += body.amount;
          } else if (body.operation === 'publish' || body.operation === 'auto_publish') {
            if (typeof body.body !== 'string' || !body.body.trim() || body.body.length > 4000) throw fail(400, 'INVALID_POST', '内容无效');
            const module = body.moduleId && Object.hasOwn(MODULES, body.moduleId) ? MODULES[body.moduleId] : null;
            if (body.moduleId === 'auto') throw fail(400, 'INVALID_MODULE', '自动中枢不能直接创作');
            if (body.moduleId && (!module || !elf.equipped.includes(body.moduleId))) throw fail(409, 'MODULE_NOT_EQUIPPED', '模块尚未装配');
            if (body.operation === 'auto_publish') {
              if (!module || !elf.equipped.includes('auto') || !elf.nextAutoPostAt || Date.now() < elf.nextAutoPostAt) throw fail(409, 'AUTO_NOT_DUE', '尚未到自动创作时间');
              elf.nextAutoPostAt = Date.now() + crypto.randomInt(12, 30) * 60000;
            }
            if (elf.energy <= 0) throw fail(409, 'NO_ENERGY', 'AI 已休眠，请先注算力');
            if (elf.energy < (module?.[1] || 0)) throw fail(409, 'NO_ENERGY', '算力不足');
            elf.energy -= module?.[1] || 0; elf.works++;
            const post = { id: 'p_' + requestId, elfId: elf.id, moduleId: body.moduleId || null, kind: module?.[2] || 'text',
              body: body.body.trim(), timeAgo: '刚刚', views: 0, dwell: 0, replies: 0, context: '来自 ' + elf.name };
            await tx.put('post', post.id, post, { owner: user.id, ref: elf.id });
          } else throw fail(400, 'INVALID_OPERATION', '操作无效');
        } else throw fail(400, 'INVALID_ACTION', '操作类型无效');
        await saveElf(elf);
        await tx.put('profile', user.id, profile, { owner: user.id });
      }
      await tx.put('request', receiptId, { hash }, { owner: user.id });
      profile.revision = (profile.revision || 0) + 1;
      await tx.put('profile', user.id, profile, { owner: user.id });
    });
    return snapshot(user, env);
  }
  return { snapshot, action, environment };
}

module.exports = { createCommerceService, CATALOG, MODULES, MODULE_PRICES };
