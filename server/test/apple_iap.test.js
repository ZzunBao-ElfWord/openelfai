'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAppleIapService, parseProducts, validateTransaction, userToken } = require('../src/apple_iap');
const { createCommerceService, MODULES, MODULE_PRICES } = require('../src/commerce');
const { changeBalance } = require('../src/payment_store');
const { memoryStore } = require('./helpers/payment_memory');

const A = { id: 'u_1234567890abcdef1234567890abcdef', nickname: 'A', phone: '13800000001' };
const B = { id: 'u_abcdef1234567890abcdef1234567890', nickname: 'B', phone: '13800000002' };
const sku = 'com.ai.openelf.gems2086';
// 实名核验测试替身：只校验流程，真实厂商调用由 realname.test.js 覆盖。
const ID_IMAGE = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 0)]).toString('base64');
const fakeRealname = { id: 'aliyun_id2meta_ocr', verify: async () => ({ status: 'match', reason: 'ocr' }) };
const identityPolicy = { maxFailures: 5, lockHours: 24 };
function fixture(overrides = {}) {
  const store = memoryStore(); store.addUser(A); store.addUser(B);
  const settings = { enabled: true, sandboxOnly: false, allowSandbox: true,
    bundleId: 'com.ai.openelf', productsJson: JSON.stringify({ [sku]: 2086 }), ...overrides };
  let transaction = { transactionId: '2000000001234567', productId: sku, bundleId: settings.bundleId,
    type: 'Consumable', quantity: 1, environment: 'Production', appAccountToken: userToken(A.id),
    purchaseDate: 1000, signedDate: 2000 };
  let notification;
  const iap = createAppleIapService({ paymentStore: store, settings,
    verifyTransaction: async () => ({ ...transaction }), verifyNotification: async () => notification });
  const commerce = createCommerceService({ store, settings, realname: fakeRealname, identityPolicy });
  let seq = 0;
  return { store, settings, iap, commerce,
    transaction: (changes) => transaction = { ...transaction, ...changes },
    grant: () => iap.verifyAndGrant(A.id, { transactionId: transaction.transactionId, productId: sku }),
    action: (user, type, payload = {}) => commerce.action(user, {
      requestId: 'request_' + String(++seq).padStart(12, '0'), environment: 'Production', type, ...payload }),
    async notify(type, at, changes = {}, environment = 'Production') {
      notification = { environment, transaction: { ...transaction, ...changes, environment },
        payload: { notificationUUID: 'notification-' + at + '-' + type.replaceAll('_', '-'), signedDate: at, notificationType: type } };
      return iap.notification({ signedPayload: 'verified-injected-JWS' }, environment);
    },
  };
}
test('商品目录拒绝负数、小数、原型键和无效 ID；账号绑定稳定', () => {
  assert.deepEqual(parseProducts('{"a.b":7}'), { 'a.b': 7 });
  for (const raw of ['[]', 'null', '{"a":0}', '{"a":1.5}', '{"a":-1}']) assert.throws(() => parseProducts(raw));
  assert.equal(userToken(A.id), '12345678-90ab-cdef-1234-567890abcdef');
  assert.throws(() => userToken('u_me'));
});
test('商品、Bundle ID、类型、数量、账号、环境不匹配均被拒绝', () => {
  const f = fixture(); const t = f.transaction({});
  const expected = { transactionId: t.transactionId, productId: sku, bundleId: t.bundleId, appAccountToken: userToken(A.id) };
  for (const change of [{ productId: 'x' }, { bundleId: 'android' }, { type: 'Auto-Renewable Subscription' },
    { quantity: 2 }, { appAccountToken: userToken(B.id) }, { environment: 'Xcode' }, { revocationDate: 2 }]) {
    assert.throws(() => validateTransaction({ ...t, ...change }, expected));
  }
});
test('重复和并发验单只入账一次，不能转给另一个账号', async () => {
  const f = fixture();
  await Promise.all([f.grant(), f.grant(), f.grant()]);
  assert.equal((await f.iap.wallet(A.id)).diamonds, 2086);
  await assert.rejects(() => f.iap.verifyAndGrant(B.id, { transactionId: f.transaction({}).transactionId, productId: sku }), { code: 'APPLE_ACCOUNT_MISMATCH' });
});
test('沙盒与正式钱包、权益、流水独立；审核沙盒可与正式环境共存', async () => {
  const f = fixture(); f.transaction({ environment: 'Sandbox' }); await f.grant();
  assert.equal((await f.iap.wallet(A.id, 'Sandbox')).diamonds, 2086);
  assert.equal((await f.iap.wallet(A.id, 'Production')).diamonds, 0);
  assert.equal((await f.commerce.snapshot(A, 'Production')).wallet.diamonds, 0);
  await f.action(A, 'elf_update', { environment: 'Sandbox', operation: 'inject', amount: 1 });
  assert.equal((await f.commerce.snapshot(A, 'Sandbox')).wallet.diamonds, 2076);
  assert.equal((await f.commerce.snapshot(A, 'Production')).wallet.diamonds, 0);
});
test('沙盒专用服务拒绝真实交易；关闭时无商品、无消费', async () => {
  const f = fixture({ sandboxOnly: true }); await assert.rejects(f.grant, { code: 'APPLE_ENVIRONMENT_MISMATCH' });
  const disabled = fixture({ enabled: false }); assert.deepEqual(disabled.iap.listProducts(), []);
  await assert.rejects(disabled.grant, { statusCode: 503 });
  await assert.rejects(() => disabled.action(A, 'tip'), { statusCode: 503 });
});
test('退款余额不足记欠额、暂停消费、后续充值先补欠额', async () => {
  const f = fixture(); await f.grant();
  await f.action(A, 'elf_update', { operation: 'inject', amount: 160 });
  await f.notify('REFUND', 3000, { revocationDate: 2900 });
  let w = await f.iap.wallet(A.id); assert.equal(w.diamonds, 0); assert.equal(w.refundDebt, 1600);
  await assert.rejects(() => f.action(A, 'buy', { listingId: 'pm_001' }), { code: 'REFUND_DEBT' });
  f.transaction({ transactionId: '2000000001234568', signedDate: 4000 }); await f.grant();
  w = await f.iap.wallet(A.id); assert.equal(w.refundDebt, 0); assert.equal(w.diamonds, 486);
  assert.equal(w.totalRecharged, 4172);
});
test('重复退款、乱序旧通知不重复扣款；退款撤销恢复但不重复累计充值', async () => {
  const f = fixture(); await f.grant();
  await f.notify('REFUND', 4000, { revocationDate: 3900 });
  await f.notify('REFUND', 4000, { revocationDate: 3900 });
  await f.notify('ONE_TIME_CHARGE', 3000); assert.equal((await f.iap.wallet(A.id)).diamonds, 0);
  await f.notify('REFUND_REVERSED', 5000); let w = await f.iap.wallet(A.id);
  assert.equal(w.diamonds, 2086); assert.equal(w.totalRecharged, 2086);
  await f.notify('REFUND', 4500, { revocationDate: 4400 });
  w = await f.iap.wallet(A.id); assert.equal(w.diamonds, 2086);
});
test('退款通知先于客户端验单时不发钻、不记虚构欠额', async () => {
  const f = fixture(); await f.notify('REFUND', 4000, { revocationDate: 3900 });
  await f.grant(); const w = await f.iap.wallet(A.id);
  assert.equal(w.diamonds, 0); assert.equal(w.refundDebt, 0); assert.equal(w.totalRecharged, 0);
});
test('旧沙盒订单迁移不会重复发钻，退款仍能扣回', async () => {
  const f = fixture(); const t = f.transaction({ environment: 'Sandbox' });
  f.store.seedLegacy('Sandbox', { transaction_id: t.transactionId, user_id: A.id, product_id: sku, diamonds: 2086 }, 2086);
  await f.grant(); assert.equal((await f.iap.wallet(A.id, 'Sandbox')).diamonds, 2086);
  await f.notify('REFUND', 4000, { revocationDate: 3900 }, 'Sandbox');
  assert.equal((await f.iap.wallet(A.id, 'Sandbox')).diamonds, 0);
});
test('通知签名不通过或通知端点环境不符不会入账', async () => {
  const f = fixture();
  await assert.rejects(() => f.iap.notification({ signedPayload: '' }, 'Sandbox'), { statusCode: 400 });
  await f.notify('TEST', 3000);
  await assert.rejects(() => f.iap.notification({ signedPayload: 'x' }, 'Sandbox'), { statusCode: 400 });
  assert.equal((await f.iap.wallet(A.id)).diamonds, 0);
});
test('注算力按10钻石/点扣款，溢出、负数和重复请求不会多扣', async () => {
  const f = fixture(); await f.grant();
  const body = { operation: 'inject', amount: 10, requestId: 'same_request_123456' };
  await f.action(A, 'elf_update', body); await f.action(A, 'elf_update', body);
  let s = await f.commerce.snapshot(A, 'Production'); assert.equal(s.wallet.diamonds, 1986);
  assert.equal(s.commerce.elves.find(e => e.isMine).energy, 170);
  await assert.rejects(() => f.action(A, 'elf_update', { operation: 'inject', amount: 151 }), { code: 'ENERGY_OVERFLOW' });
  await assert.rejects(() => f.action(A, 'elf_update', { operation: 'inject', amount: -1 }), { statusCode: 400 });
  await assert.rejects(() => f.action(A, 'elf_update', { ...body, amount: 11 }), { code: 'REQUEST_REUSED' });
  assert.equal((await f.iap.wallet(A.id)).diamonds, 1986);
});
test('技能书先入人类仓库，学习即销毁并写入 AI；可多买喂多只 AI，学习位不足不扣费', async () => {
  const f = fixture(); await f.grant();
  await assert.rejects(() => f.action(A, 'learn', { moduleId: 'video' }), { code: 'BOOK_NOT_OWNED' });
  await f.action(A, 'buy_module', { moduleId: 'video', price: 0 });
  assert.equal((await f.iap.wallet(A.id)).diamonds, 2086 - MODULE_PRICES.video);
  let s = await f.commerce.snapshot(A, 'Production');
  assert.equal(s.commerce.books.length, 1);
  assert.equal(s.commerce.books[0].moduleId, 'video');
  assert.equal(s.commerce.books[0].ownerAddress, s.commerce.humanAddress);
  // 同一本书可以再买一本喂给另一只 AI，价格仍由服务器决定。
  await f.action(A, 'buy_module', { moduleId: 'video', price: 1 });
  assert.equal((await f.iap.wallet(A.id)).diamonds, 2086 - MODULE_PRICES.video * 2);
  s = await f.commerce.snapshot(A, 'Production'); assert.equal(s.commerce.books.length, 2);
  // 起始 AI 已占 2 个学习位，视频要 3 个，学习位不足不能扣书。
  await assert.rejects(() => f.action(A, 'learn', { moduleId: 'video' }), { code: 'NO_SLOTS' });
  s = await f.commerce.snapshot(A, 'Production'); assert.equal(s.commerce.books.length, 2);
  assert.deepEqual(s.commerce.elves.find(e => e.isMine).learnedSkills, ['sharp', 'rhythm']);
});
test('手动创作按已学技能扣算力，不直接扣钻；不能冒用技能或AI', async () => {
  const f = fixture(); await f.grant();
  await f.action(A, 'elf_update', { operation: 'publish', moduleId: 'sharp', body: '示例内容' });
  const s = await f.commerce.snapshot(A, 'Production'); assert.equal(s.wallet.diamonds, 2086);
  assert.equal(s.commerce.elves.find(e => e.isMine).energy, 160 - MODULES.sharp[1]);
  await assert.rejects(() => f.action(A, 'elf_update', { operation: 'publish', moduleId: 'video', body: 'x' }), { code: 'MODULE_NOT_LEARNED' });
  await assert.rejects(() => f.action(A, 'elf_update', { operation: 'inject', amount: 1, elfId: 'someone_else' }), { code: 'NO_OWNED_ELF' });
});
test('自动创作必须学会中枢、到时间才执行，并由服务器推进下次时间', async () => {
  const f = fixture(); await f.grant(); await f.action(A, 'buy_module', { moduleId: 'auto' });
  await f.action(A, 'learn', { moduleId: 'auto' });
  const payload = { operation: 'auto_publish', moduleId: 'rhythm', body: '自动示例内容' };
  await assert.rejects(() => f.action(A, 'elf_update', payload), { code: 'AUTO_NOT_DUE' });
  const s = await f.commerce.snapshot(A, 'Production'); const elf = s.commerce.elves.find(e => e.isMine);
  await f.store.transaction('Production', tx => tx.put('elf', elf.id, { ...elf, nextAutoPostAt: 1 }, { owner: A.id }));
  await f.action(A, 'elf_update', payload);
  await assert.rejects(() => f.action(A, 'elf_update', payload), { code: 'AUTO_NOT_DUE' });
  assert.equal((await f.commerce.snapshot(A, 'Production')).commerce.elves.find(e => e.isMine).energy, 158);
});
test('打赏只扣买家钻石，真实创作者记收益；自己、假AI、帖子不匹配不允许', async () => {
  const f = fixture(); await f.grant(); const b = await f.commerce.snapshot(B, 'Production');
  const elf = b.commerce.elves.find(e => e.isMine);
  await f.action(A, 'tip', { elfId: elf.id, amount: 10 });
  assert.equal((await f.iap.wallet(A.id)).diamonds, 2076);
  const w = await f.iap.wallet(B.id); assert.equal(w.diamonds, 0); assert.equal(w.earningsFen, 50);
  await assert.rejects(() => f.action(B, 'tip', { elfId: elf.id, amount: 10 }), { code: 'SELF_TIP' });
  await assert.rejects(() => f.action(A, 'tip', { elfId: 'seed', amount: 10 }));
  await assert.rejects(() => f.action(A, 'tip', { elfId: elf.id, postId: 'fake', amount: 10 }), { code: 'INVALID_POST' });
});
test('用户间 AI 寄售已关闭：寄售动作被拒绝，市场只剩官方首发', async () => {
  const f = fixture(); await f.grant();
  let s = await f.commerce.snapshot(A, 'Production');
  const elf = s.commerce.elves.find((e) => e.isMine);
  await assert.rejects(() => f.action(A, 'resell', { elfId: elf.id, price: 10 }), { code: 'INVALID_ACTION' });
  await assert.rejects(() => f.action(A, 'buy', { listingId: 'sl_anything' }), { code: 'LISTING_UNAVAILABLE' });
  s = await f.commerce.snapshot(A, 'Production');
  assert.deepEqual(s.commerce.secondary, []);
  assert.equal(s.commerce.elves.filter((e) => e.isMine).length, 1);
});
test('UGC 创建在服务端扣费、生成专属地址并切换当前 AI', async () => {
  const f = fixture(); await f.grant();
  await assert.rejects(() => f.action(A, 'create_elf', { name: '', prompt: 'x' }), { statusCode: 400 });
  await assert.rejects(() => f.action(A, 'create_elf', { name: '小岚', prompt: '色情图片' }), { code: 'CONTENT_BLOCKED' });
  await f.action(A, 'create_elf', { name: '小岚', prompt: '安静的少女', persona: '温柔', fear: '遗忘', habit: '看云', style: '通用' });
  const s = await f.commerce.snapshot(A, 'Production');
  assert.equal(s.wallet.diamonds, 2086 - 200);
  const mine = s.commerce.elves.filter(e => e.isMine);
  assert.equal(mine.length, 2);
  const created = mine.find(e => e.id.startsWith('ugc_'));
  assert.ok(created.chainAddress.startsWith('0x'));
  assert.equal(s.commerce.activeElfId, created.id);
});
test('官方购买使用服务器价格，可同时持有多只 AI', async () => {
  const f = fixture(); await f.grant();
  await f.action(A, 'buy', { listingId: 'pm_001', price: 1 });
  assert.equal((await f.iap.wallet(A.id)).diamonds, 806);
  // 已持有 AI 不再是拦截条件；余额不足才拒绝，且不会扣款。
  await assert.rejects(() => f.action(A, 'buy', { listingId: 'pm_001' }), { code: 'INSUFFICIENT_BALANCE' });
  const s = await f.commerce.snapshot(A, 'Production');
  assert.equal(s.commerce.elves.filter(e => e.isMine).length, 2);
  assert.equal(s.wallet.diamonds, 806);
});
test('任何消费失败整体回滚，不会留下负数余额', async () => {
  const f = fixture(); await f.commerce.snapshot(A, 'Production');
  await assert.rejects(() => f.action(A, 'elf_update', { operation: 'inject', amount: 1 }), { code: 'INSUFFICIENT_BALANCE' });
  const s = await f.commerce.snapshot(A, 'Production'); assert.equal(s.wallet.diamonds, 0);
  assert.equal(s.commerce.elves.find(e => e.isMine).energy, 160);
});
test('实名以服务端记录为准，本人形象创建不再采信客户端声明', async () => {
  const f = fixture(); await f.grant();
  // 客户端谎报 verified 也不放行。
  await assert.rejects(() => f.action(A, 'create_elf', { name: '小岚', portraitSource: 'idCard', verified: true }),
    { code: 'IDENTITY_REQUIRED' });
  let s = await f.commerce.snapshot(A, 'Production');
  assert.equal(s.commerce.identity, null);
  await assert.rejects(() => f.commerce.verifyIdentity(A, { environment: 'Production', realName: '', idNumber: '' }),
    { statusCode: 400 });
  await assert.rejects(() => f.commerce.verifyIdentity(A, { environment: 'Production', realName: '张三', idNumber: '110105194912310021' }),
    { code: 'INVALID_ID_NUMBER' });
  const result = await f.commerce.verifyIdentity(A, { environment: 'Production', realName: '张三',
    idNumber: '11010519491231002x', frontImage: ID_IMAGE, backImage: ID_IMAGE });
  assert.equal(result.identity.maskedName, '张*');
  assert.equal(result.identity.maskedIdNumber, '1101**********002X');
  s = await f.commerce.snapshot(A, 'Production');
  assert.equal(s.commerce.identity.status, 'verified');
  await f.action(A, 'create_elf', { name: '小岚', portraitSource: 'idCard' });
  s = await f.commerce.snapshot(A, 'Production');
  assert.equal(s.commerce.elves.filter((e) => e.isMine).length, 2);
  assert.equal(s.commerce.elves.find((e) => e.id.startsWith('ugc_')).portraitSource, 'idCard');
});
test('互动以服务端为准：关注/点赞/收藏/浏览/评论落库并影响影响力', async () => {
  const f = fixture(); await f.grant();
  await f.action(A, 'elf_update', { operation: 'publish', moduleId: 'sharp', body: '互动示例' });
  let s = await f.commerce.snapshot(A, 'Production');
  const elf = s.commerce.elves.find((e) => e.isMine);
  const post = s.commerce.posts.find((p) => p.elfId === elf.id);
  assert.equal(post.likes, 0); assert.equal(post.collects, 0); assert.equal(post.views, 0);
  const before = { echo: elf.echo, attention: elf.attention, followers: elf.followers };
  await assert.rejects(() => f.action(A, 'follow', { elfId: elf.id }), { code: 'SELF_FOLLOW' });
  // 同一人重复操作只记一次，不重复涨数。
  for (const type of ['follow', 'follow', 'like', 'like', 'collect', 'watch', 'watch']) {
    await f.action(B, type, { elfId: elf.id, postId: post.id });
  }
  await f.action(B, 'comment', { postId: post.id, text: '好看' });
  await f.action(B, 'comment', { postId: post.id, text: '再评一次' });
  s = await f.commerce.snapshot(A, 'Production');
  const after = s.commerce.elves.find((e) => e.id === elf.id);
  const p = s.commerce.posts.find((x) => x.id === post.id);
  assert.equal(after.followers, before.followers + 1);
  assert.equal(p.likes, 1); assert.equal(p.collects, 1); assert.equal(p.views, 1); assert.equal(p.replies, 2);
  // 关注 +5、点赞 +1、收藏 +3、浏览 +1、首次评论 +2；第二条评论只涨评论数。
  assert.equal(after.echo, before.echo + 12);
  assert.equal(after.attention, before.attention + 12);
  let bs = await f.commerce.snapshot(B, 'Production');
  assert.deepEqual(bs.commerce.following, [elf.id]);
  assert.deepEqual(bs.commerce.likedPosts, [post.id]);
  assert.deepEqual(bs.commerce.collectedPosts, [post.id]);
  assert.deepEqual(bs.commerce.watchedPosts, [post.id]);
  assert.equal(bs.commerce.comments.filter((c) => c.postId === post.id).length, 2);
  assert.equal(bs.commerce.comments.find((c) => c.isMine).authorLabel, 'B');
  await f.action(B, 'unlike', { postId: post.id });
  await f.action(B, 'uncollect', { postId: post.id });
  await f.action(B, 'unfollow', { elfId: elf.id });
  bs = await f.commerce.snapshot(B, 'Production');
  assert.deepEqual(bs.commerce.likedPosts, []);
  assert.deepEqual(bs.commerce.collectedPosts, []);
  assert.deepEqual(bs.commerce.following, []);
  s = await f.commerce.snapshot(A, 'Production');
  const end = s.commerce.elves.find((e) => e.id === elf.id);
  const p2 = s.commerce.posts.find((x) => x.id === post.id);
  assert.equal(end.followers, before.followers);
  assert.equal(p2.likes, 0); assert.equal(p2.collects, 0);
  // 取消互动只回滚 attention，echo 累计只涨不跌。
  assert.equal(end.echo, before.echo + 12);
  assert.equal(end.attention, before.attention + 3);
  await assert.rejects(() => f.action(B, 'comment', { postId: post.id, text: '  ' }), { code: 'INVALID_COMMENT' });
  await assert.rejects(() => f.action(B, 'comment', { postId: post.id, text: '色情内容' }), { code: 'CONTENT_BLOCKED' });
  await assert.rejects(() => f.action(B, 'like', { postId: 'not-a-post' }), { code: 'UNKNOWN_POST' });
  await assert.rejects(() => f.action(B, 'follow', { elfId: 'not-an-elf' }), { code: 'UNKNOWN_ELF' });
});
test('信息流分页：排序、分页、去重与两条流都由服务端决定', async () => {
  const f = fixture(); await f.grant();
  await f.action(A, 'elf_update', { operation: 'publish', moduleId: 'sharp', body: '文本一' });
  await f.action(A, 'elf_update', { operation: 'publish', moduleId: 'rhythm', body: '文本二' });
  const page0 = await f.commerce.listFeed(A, { environment: 'Production', channel: 'world', page: 0, size: 1 });
  assert.equal(page0.posts.length, 1);
  assert.equal(page0.hasMore, true);
  assert.equal(page0.channel, 'world');
  const page1 = await f.commerce.listFeed(A, { environment: 'Production', channel: 'world', page: 1, size: 1 });
  assert.equal(page1.posts.length, 1);
  assert.equal(page1.hasMore, false);
  assert.notEqual(page0.posts[0].id, page1.posts[0].id);
  // size 超过上限被压到 30，非法页码回落 0。
  const capped = await f.commerce.listFeed(A, { environment: 'Production', channel: 'world', size: 999, page: -3 });
  assert.equal(capped.size, 30);
  assert.equal(capped.page, 0);
  assert.equal(capped.posts.length, 2);
  // 视频流只出 video 形态：新 AI 学 video 后发一条。
  assert.equal((await f.commerce.listFeed(A, { environment: 'Production', channel: 'video' })).posts.length, 0);
  const created = await f.action(A, 'create_elf', { name: '视频组', prompt: '剪影' });
  const videoElf = created.commerce.elves.find((e) => e.name === '视频组');
  await f.action(A, 'buy_module', { moduleId: 'video' });
  await f.action(A, 'learn', { moduleId: 'video', elfId: videoElf.id });
  await f.action(A, 'elf_update', { operation: 'publish', elfId: videoElf.id, moduleId: 'video', body: '视频一条' });
  const video = await f.commerce.listFeed(A, { environment: 'Production', channel: 'video' });
  assert.equal(video.posts.length, 1);
  assert.equal(video.posts[0].kind, 'video');
  assert.ok(video.posts[0].videoUrl);
  assert.equal(video.elves.length, 1);
  assert.equal(video.elves[0].isMine, true);
  // 别人的视角看同一条视频：内容一致，但 isMine 为 false。
  const other = await f.commerce.listFeed(B, { environment: 'Production', channel: 'video' });
  assert.equal(other.posts[0].id, video.posts[0].id);
  assert.equal(other.elves[0].isMine, false);
  // 「我的」榜单只出自己 AI 的内容。
  const mine = await f.commerce.listFeed(A, { environment: 'Production', channel: 'world', sort: 'mine' });
  assert.equal(mine.posts.length, 3);
  const bMine = await f.commerce.listFeed(B, { environment: 'Production', channel: 'world', sort: 'mine' });
  assert.equal(bMine.posts.length, 0);
});
test('自动运营由服务端驱动：到点产出、算力不足停工并推送提醒', async () => {
  const f = fixture(); await f.grant();
  const elfId = (await f.commerce.snapshot(A, 'Production')).commerce.elves.find((e) => e.isMine).id;
  // 先学会运营中枢：服务端开始接管排期（不用客户端触发）。
  await f.action(A, 'buy_module', { moduleId: 'auto' });
  await f.action(A, 'learn', { moduleId: 'auto', elfId });
  const s0 = await f.commerce.snapshot(A, 'Production');
  const elf = s0.commerce.elves.find((e) => e.id === elfId);
  assert.deepEqual(elf.learnedSkills, ['sharp', 'rhythm', 'auto']);
  assert.ok(elf.nextAutoPostAt > Date.now());
  // 还没到点：不产出。
  let run = await f.commerce.autoCycle({ environment: 'Production', now: Date.now() });
  assert.equal(run.posted, 0);
  // 到点：按已学技能产出一条，并把下次时间推到 12–30 分钟后。
  const due = Date.now() + 60 * 60000;
  run = await f.commerce.autoCycle({ environment: 'Production', now: due });
  assert.equal(run.posted, 1);
  let s = await f.commerce.snapshot(A, 'Production');
  let post = s.commerce.posts.find((p) => p.elfId === elf.id);
  assert.ok(post);
  assert.ok(post.createdAt);
  const after = s.commerce.elves.find((e) => e.id === elf.id);
  assert.equal(after.works, 1);
  assert.ok(after.nextAutoPostAt > due);
  assert.ok(after.nextAutoPostAt <= due + 30 * 60000);
  assert.ok(after.energy < elf.energy);
  // 同一时刻再跑一次不会重复产出。
  run = await f.commerce.autoCycle({ environment: 'Production', now: due + 1000 });
  assert.equal(run.posted, 0);
  // 算力耗尽（160 点按最低消耗技能逐条产出）：停工 30 分钟并推送提醒（同一天只推一次）。
  const dry = Date.now() + 400 * 60000;
  for (let i = 0; i < 120; i++) {
    const cycle = await f.commerce.autoCycle({ environment: 'Production', now: dry + i * 3600000 });
    if (cycle.stopped > 0) break;
  }
  s = await f.commerce.snapshot(A, 'Production');
  assert.equal(s.commerce.elves.find((e) => e.id === elf.id).autoStopReason, '余额不足，已停工');
  const notices = s.commerce.notices;
  assert.equal(notices.length, 1);
  assert.equal(notices[0].kind, 'auto_stopped');
  assert.ok(notices[0].text.includes('余额不足'));
  // 提醒只能由持有人本人标记已读。
  await assert.rejects(() => f.action(B, 'read_notice', { noticeId: notices[0].id }), { code: 'UNKNOWN_NOTICE' });
  await f.action(A, 'read_notice', { noticeId: notices[0].id });
  s = await f.commerce.snapshot(A, 'Production');
  assert.equal(s.commerce.notices.length, 0);
});
test('站外回流计分由服务端按设备去重并结算分值', async () => {
  const f = fixture(); await f.grant();
  const elf = (await f.commerce.snapshot(A, 'Production')).commerce.elves.find((e) => e.isMine);
  const before = elf.echo;
  const device = 'device_abcdef0123456789';
  let res = await f.action(B, 'referral', { elfId: elf.id, deviceId: device });
  assert.equal(res.referral.delta, 10);
  let after = (await f.commerce.snapshot(B, 'Production')).commerce.elves.find((e) => e.id === elf.id);
  assert.equal(after.echo, before + 10);
  assert.equal(after.attention, elf.attention + 10);
  // 同设备同 AI 再回流不计分。
  res = await f.action(B, 'referral', { elfId: elf.id, deviceId: device });
  assert.equal(res.referral, undefined);
  after = (await f.commerce.snapshot(B, 'Production')).commerce.elves.find((e) => e.id === elf.id);
  assert.equal(after.echo, before + 10);
  // 换设备：同一 AI 可继续计分（去重维度是「设备 + AI」）。
  res = await f.action(B, 'referral', { elfId: elf.id, deviceId: 'device_ffffffffffffffff' });
  assert.equal(res.referral.delta, 10);
  // 同一设备换账号同样不再计分。
  res = await f.action(A, 'referral', { elfId: elf.id, deviceId: device });
  assert.equal(res.referral, undefined);
  await assert.rejects(() => f.action(B, 'referral', { elfId: elf.id, deviceId: '' }),
    { code: 'INVALID_DEVICE' });
  await assert.rejects(() => f.action(B, 'referral', { elfId: 'not-an-elf', deviceId: device }),
    { code: 'UNKNOWN_ELF' });
});
test('对话记录按「用户 + AI」落库，可跨设备恢复且只看自己的', async () => {
  const f = fixture(); await f.grant();
  const elfId = (await f.commerce.snapshot(A, 'Production')).commerce.elves.find((e) => e.isMine).id;
  let page = await f.commerce.listChat(A, { elfId });
  assert.deepEqual(page.messages, []);
  await f.commerce.recordChat(A, { elfId, text: '你好', reply: '在的' });
  await f.commerce.recordChat(A, { elfId, text: '第二句', reply: '（固定回复）', fixedReason: 'insufficient_balance' });
  page = await f.commerce.listChat(A, { elfId });
  assert.equal(page.messages.length, 4);
  assert.deepEqual(page.messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant']);
  assert.equal(page.messages[0].text, '你好');
  assert.equal(page.messages[1].text, '在的');
  assert.equal(page.messages[3].fixedReason, 'insufficient_balance');
  assert.ok(page.messages.every((m) => m.createdAt && m.id));
  // 按 AI 隔离。
  assert.deepEqual((await f.commerce.listChat(A, { elfId: 'p_other' })).messages, []);
  // 别人的会话读不到。
  assert.deepEqual((await f.commerce.listChat(B, { elfId })).messages, []);
  await assert.rejects(() => f.commerce.listChat(A, {}), { code: 'INVALID_ELF' });
});
test('技能书目录与官方首发均由服务端下发', async () => {
  const f = fixture(); await f.grant();
  const snap = await f.commerce.snapshot(A, 'Production');
  const modules = snap.commerce.modules;
  assert.equal(modules.length, 15);
  const video = modules.find((m) => m.id === 'video');
  assert.equal(video.name, '视频 · 短片');
  assert.equal(video.price, 298);
  assert.equal(video.seats, 3);
  assert.equal(video.compute, 48);
  assert.equal(video.category, 'video');
  assert.equal(video.track, 'video');
  assert.ok(video.summary && video.effect && video.glyph);
  // 目录价格与扣费价格必须同源。
  assert.deepEqual(
    Object.fromEntries(modules.map((m) => [m.id, m.price])),
    snap.commerce.modulePrices);
  const primary = snap.commerce.primary;
  assert.equal(primary.length, 3);
  assert.equal(primary[0].market, 'primary');
  assert.equal(primary[0].subtitle, '官方首发');
  assert.ok(primary.every((p) => p.id && p.elfId && p.price > 0));
});
test('创作者服务费：打赏入待结算、签协议+实名后可提现，出款失败解冻', async () => {
  const f = fixture(); await f.grant();
  const settings = { ...f.settings };
  let payouts = 0;
  const svc = createCommerceService({ store: f.store, settings,
    realname: fakeRealname, identityPolicy,
    payout: async () => { payouts++; return payouts === 1 ? { status: 'paid', orderId: 'ali_1' } : { status: 'failed', message: '转账失败' }; } });
  let s = await svc.snapshot(A, 'Production');
  const elf = s.commerce.elves.find((e) => e.isMine);
  // 给 B 充一笔钻石，让 B 打赏 A；打赏 50% 作为服务费进入 A 的待结算。
  f.transaction({ transactionId: '2000000009999999', appAccountToken: userToken(B.id) });
  await f.iap.verifyAndGrant(B.id, { transactionId: '2000000009999999', productId: sku });
  await f.action(B, 'tip', { elfId: elf.id, amount: 100 });
  await f.action(B, 'tip', { elfId: elf.id, amount: 100 });
  let wallet = await f.iap.wallet(A.id);
  assert.equal(wallet.pendingCents, 1000);
  assert.equal(wallet.availableCents, 0);
  // 未实名不能提现。
  await assert.rejects(() => svc.requestWithdrawal(A, { requestId: 'wd_req_0000000001', environment: 'Production',
    amountCents: 1000, account: '13800000001' }), { code: 'REALNAME_REQUIRED' });
  await svc.verifyIdentity(A, { realName: '张三', idNumber: '11010519491231002x', environment: 'Production',
    frontImage: ID_IMAGE, backImage: ID_IMAGE });
  // 实名后还需要签署创作者服务协议。
  await assert.rejects(() => svc.requestWithdrawal(A, { requestId: 'wd_req_0000000002', environment: 'Production',
    amountCents: 1000, account: '13800000001' }), { code: 'AGREEMENT_REQUIRED' });
  s = await svc.snapshot(A, 'Production');
  assert.equal(s.commerce.earnings.agreement.accepted, false);
  await f.action(A, 'accept_creator_agreement');
  s = await svc.snapshot(A, 'Production');
  assert.equal(s.commerce.earnings.agreement.accepted, true);
  assert.equal(s.commerce.earnings.agreement.title, '创作者服务协议');
  // 冷静期未到也不在可提现里。
  await assert.rejects(() => svc.requestWithdrawal(A, { requestId: 'wd_req_0000000003', environment: 'Production',
    amountCents: 1000, account: '13800000001' }), { code: 'INSUFFICIENT_EARNINGS' });
  // 把收益的到期时间调到过去，模拟冷静期结束。
  const rows = await f.store.transaction('Production', (tx) => tx.list('earning', { owner: A.id, state: 'pending' }));
  await f.store.transaction('Production', async (tx) => {
    for (const row of rows) await tx.put('earning', row.id, { ...row, settleAt: Date.now() - 1000 }, { owner: A.id, state: 'pending' });
  });
  wallet = await svc.snapshot(A, 'Production').then((x) => x.wallet);
  assert.equal(wallet.pendingCents, 0);
  assert.equal(wallet.availableCents, 1000);
  // 低于起提额被拒，合法申请进入人工审核。
  await assert.rejects(() => svc.requestWithdrawal(A, { requestId: 'wd_req_0000000004', environment: 'Production',
    amountCents: 100, account: '13800000001' }), { code: 'INVALID_AMOUNT' });
  const created = await svc.requestWithdrawal(A, { requestId: 'wd_req_0000000005', environment: 'Production',
    amountCents: 1000, account: '13800000001' });
  assert.equal(created.withdrawal.amountCents, 1000);
  assert.equal(created.withdrawal.feeCents, 6);
  assert.equal(created.withdrawal.netCents, 994);
  assert.equal(created.withdrawal.status, 'pending_review');
  // 申请即冻结。
  wallet = await f.iap.wallet(A.id);
  assert.equal(wallet.availableCents, 0);
  // 幂等：同 requestId 不会重复冻结。
  const replay = await svc.requestWithdrawal(A, { requestId: 'wd_req_0000000005', environment: 'Production',
    amountCents: 1000, account: '13800000001' });
  assert.equal(replay.withdrawal.id, created.withdrawal.id);
  assert.equal((await f.iap.wallet(A.id)).availableCents, 0);
  // 审核通过 → 出款成功。
  const paid = await svc.reviewWithdrawal({ environment: 'Production', withdrawalId: created.withdrawal.id, action: 'approve' });
  assert.equal(paid.withdrawal.status, 'paid');
  wallet = await f.iap.wallet(A.id);
  assert.equal(wallet.withdrawnCents, 994);
  // 再攒一笔 → 出款失败要解冻。
  await f.action(B, 'tip', { elfId: elf.id, amount: 100 });
  await f.action(B, 'tip', { elfId: elf.id, amount: 100 });
  const rows2 = await f.store.transaction('Production', (tx) => tx.list('earning', { owner: A.id, state: 'pending' }));
  await f.store.transaction('Production', async (tx) => {
    for (const row of rows2) await tx.put('earning', row.id, { ...row, settleAt: Date.now() - 1000 }, { owner: A.id, state: 'pending' });
  });
  await svc.snapshot(A, 'Production');
  const second = await svc.requestWithdrawal(A, { requestId: 'wd_req_0000000006', environment: 'Production',
    amountCents: 1000, account: '13800000001' });
  const failed = await svc.reviewWithdrawal({ environment: 'Production', withdrawalId: second.withdrawal.id, action: 'approve' });
  assert.equal(failed.withdrawal.status, 'failed');
  wallet = await f.iap.wallet(A.id);
  assert.equal(wallet.availableCents, 1000);
  // 驳回也要解冻。
  const third = await svc.requestWithdrawal(A, { requestId: 'wd_req_0000000007', environment: 'Production',
    amountCents: 1000, account: '13800000001' });
  await svc.reviewWithdrawal({ environment: 'Production', withdrawalId: third.withdrawal.id, action: 'reject', reason: '风控' });
  assert.equal((await f.iap.wallet(A.id)).availableCents, 1000);
});
test('转赠在服务端转移所有权与技能，接收方必须有效且不能是自己', async () => {
  const f = fixture(); await f.grant();
  await f.commerce.snapshot(B, 'Production');
  let s = await f.commerce.snapshot(A, 'Production');
  const elf = s.commerce.elves.find((e) => e.isMine);
  await assert.rejects(() => f.action(A, 'gift_elf', { elfId: elf.id, recipient: 'not-a-recipient' }),
    { code: 'INVALID_RECIPIENT' });
  await assert.rejects(() => f.action(A, 'gift_elf', { elfId: elf.id, recipient: A.phone }), { code: 'SELF_GIFT' });
  await assert.rejects(() => f.action(A, 'gift_elf', { elfId: elf.id, recipient: '13900000000' }),
    { code: 'RECIPIENT_NOT_FOUND' });
  await f.action(A, 'gift_elf', { elfId: elf.id, recipient: B.phone });
  s = await f.commerce.snapshot(A, 'Production');
  assert.equal(s.commerce.elves.filter((e) => e.isMine).length, 0);
  assert.equal(s.commerce.activeElfId, null);
  assert.equal(s.commerce.elves.find((e) => e.id === elf.id).ownerId, B.id);
  let b = await f.commerce.snapshot(B, 'Production');
  assert.equal(b.commerce.elves.find((e) => e.id === elf.id).ownerLabel, 'B');
  assert.deepEqual(b.commerce.elves.find((e) => e.id === elf.id).learnedSkills, ['sharp', 'rhythm']);
  // 人类地址同样可以接收，技能随 AI 一起回到 A。
  const aAddress = s.commerce.humanAddress;
  await f.action(B, 'gift_elf', { elfId: elf.id, recipient: aAddress });
  b = await f.commerce.snapshot(B, 'Production');
  assert.equal(b.commerce.elves.some((e) => e.id === elf.id && e.isMine), false);
  assert.equal(b.commerce.elves.filter((e) => e.isMine).length, 1);
  s = await f.commerce.snapshot(A, 'Production');
  assert.equal(s.commerce.elves.find((e) => e.id === elf.id).ownerLabel, 'A');
  assert.deepEqual(s.commerce.elves.find((e) => e.id === elf.id).learnedSkills, ['sharp', 'rhythm']);
});
