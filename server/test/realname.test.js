'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRealnameVerifier, RealnameError } = require('../src/realname');
const { createCommerceService } = require('../src/commerce');
const { memoryStore } = require('./helpers/payment_memory');

const USER = { id: 'u_1234567890abcdef1234567890abcdef', nickname: 'A' };
const NAME = '张三';
const ID = '11010519491231002X';
// 最小 JPEG 头 + 填充：服务端只校验文件头与大小，不会真的解码图片。
const IMAGE = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 0)]).toString('base64');

function settings(overrides = {}) {
  return { enabled: true, provider: 'aliyun', mode: 'ocr', endpoint: 'cloudauth.aliyuncs.com',
    timeoutMs: 1000, accessKeyId: 'ak', accessKeySecret: 'sk', ...overrides };
}

function ocrClient(handler) {
  return {
    async id2MetaVerifyWithOCRAdvance(request) { return handler(request); },
    async id2MetaVerify(request) { return handler(request); },
  };
}

test('OCR 模式：权威源一致且照片信息与填写一致才通过', async () => {
  const client = ocrClient(() => ({ body: { code: '200', resultObject: {
    bizCode: '1', cardInfo: JSON.stringify({ certName: NAME, certNo: '1101051949123****X' }) } } }));
  const verifier = createRealnameVerifier(settings(), { client });
  assert.equal(verifier.id, 'aliyun_id2meta_ocr');
  const result = await verifier.verify({ realName: NAME, idNumber: ID,
    frontImage: Buffer.from(IMAGE, 'base64'), backImage: Buffer.from(IMAGE, 'base64') });
  assert.equal(result.status, 'match');
});

test('OCR 读出的姓名与填写不一致视为证件不符', async () => {
  const client = ocrClient(() => ({ body: { code: '200', resultObject: {
    bizCode: '1', cardInfo: JSON.stringify({ certName: '李四', certNo: '1101051949123****X' }) } } }));
  const verifier = createRealnameVerifier(settings(), { client });
  const result = await verifier.verify({ realName: NAME, idNumber: ID,
    frontImage: Buffer.from(IMAGE, 'base64'), backImage: Buffer.from(IMAGE, 'base64') });
  assert.equal(result.status, 'mismatch');
  assert.equal(result.reason, 'document');
});

test('BizCode 2/3 映射为不一致/查无此人；照片不可读单独报错', async () => {
  const mismatch = createRealnameVerifier(settings(),
    { client: ocrClient(() => ({ body: { code: '200', resultObject: { bizCode: '2' } } })) });
  assert.equal((await mismatch.verify({ realName: NAME, idNumber: ID,
    frontImage: Buffer.from(IMAGE, 'base64'), backImage: Buffer.from(IMAGE, 'base64') })).status, 'mismatch');

  const notFound = createRealnameVerifier(settings(),
    { client: ocrClient(() => ({ body: { code: '200', resultObject: { bizCode: '3' } } })) });
  assert.equal((await notFound.verify({ realName: NAME, idNumber: ID,
    frontImage: Buffer.from(IMAGE, 'base64'), backImage: Buffer.from(IMAGE, 'base64') })).status, 'notfound');

  const noCard = createRealnameVerifier(settings(),
    { client: ocrClient(() => ({ body: { code: '200', resultObject: { bizCode: '1' } } })) });
  await assert.rejects(() => noCard.verify({ realName: NAME, idNumber: ID,
    frontImage: Buffer.from(IMAGE, 'base64'), backImage: Buffer.from(IMAGE, 'base64') }),
  { code: 'REALNAME_DOCUMENT_UNREADABLE' });
});

test('上游异常、未配置密钥都不会被判成认证失败', async () => {
  const broken = createRealnameVerifier(settings(),
    { client: ocrClient(() => { throw new Error('timeout'); }) });
  await assert.rejects(() => broken.verify({ realName: NAME, idNumber: ID,
    frontImage: Buffer.from(IMAGE, 'base64'), backImage: Buffer.from(IMAGE, 'base64') }),
  (error) => error instanceof RealnameError && error.retryable
    && error.code === 'REALNAME_UPSTREAM_ERROR');

  const notConfigured = createRealnameVerifier(settings({ accessKeyId: '' }));
  await assert.rejects(() => notConfigured.verify({ realName: NAME, idNumber: ID,
    frontImage: Buffer.from(IMAGE, 'base64'), backImage: Buffer.from(IMAGE, 'base64') }),
  { code: 'REALNAME_NOT_CONFIGURED' });
});

test('plain 模式只做二要素核验，不依赖照片', async () => {
  const client = ocrClient(() => ({ body: { code: '200', resultObject: { bizCode: '1' } } }));
  const verifier = createRealnameVerifier(settings({ mode: 'plain' }), { client });
  assert.equal(verifier.id, 'aliyun_id2meta');
  const result = await verifier.verify({ realName: NAME, idNumber: ID,
    frontImage: Buffer.from(IMAGE, 'base64'), backImage: Buffer.from(IMAGE, 'base64') });
  assert.equal(result.status, 'match');
});

function commerceFixture(realname) {
  const store = memoryStore(); store.addUser(USER);
  const service = createCommerceService({
    store,
    settings: { enabled: true, sandboxOnly: false, allowSandbox: false },
    realname,
    identityPolicy: { maxFailures: 5, lockHours: 24 },
  });
  const body = { environment: 'Production', realName: NAME, idNumber: ID,
    frontImage: IMAGE, backImage: IMAGE };
  return { store, service, body };
}

test('核验通过只落脱敏结果，证件照不落库', async () => {
  const realname = { id: 'aliyun_id2meta_ocr', verify: async () => ({ status: 'match', reason: 'ocr' }) };
  const { store, service, body } = commerceFixture(realname);
  const response = await service.verifyIdentity(USER, body);
  assert.equal(response.identity.status, 'verified');
  assert.equal(response.identity.maskedName, '张*');
  assert.equal(response.identity.maskedIdNumber, '1101**********002X');
  assert.equal(response.identity.provider, 'aliyun_id2meta_ocr');
  const record = await store.transaction('Production', (tx) => tx.get('identity', USER.id));
  assert.equal(record.documents.stored, false);
  assert.ok(!JSON.stringify(record).includes(IMAGE));
});

test('连续 5 次不一致后锁定，第 6 次不再调用上游', async () => {
  let calls = 0;
  const realname = { id: 'aliyun_id2meta_ocr', async verify() { calls++; return { status: 'mismatch', reason: 'authority' }; } };
  const { service, body } = commerceFixture(realname);
  for (let i = 0; i < 4; i++) {
    await assert.rejects(() => service.verifyIdentity(USER, body), { code: 'REALNAME_MISMATCH' });
  }
  await assert.rejects(() => service.verifyIdentity(USER, body), { code: 'REALNAME_LOCKED' });
  await assert.rejects(() => service.verifyIdentity(USER, body), { code: 'REALNAME_LOCKED' });
  assert.equal(calls, 5);
});

test('上游不可用返回可重试 503，且不计入失败次数', async () => {
  let calls = 0;
  const realname = { id: 'aliyun_id2meta_ocr', async verify() {
    calls++;
    throw new RealnameError('REALNAME_UPSTREAM_ERROR', 'timeout');
  } };
  const { store, service, body } = commerceFixture(realname);
  for (let i = 0; i < 6; i++) {
    await assert.rejects(() => service.verifyIdentity(USER, body),
      { statusCode: 503, code: 'REALNAME_UNAVAILABLE' });
  }
  assert.equal(calls, 6);
  assert.equal(await store.transaction('Production', (tx) => tx.get('identityLock', USER.id)), null);
});

test('证件照缺失、过大或格式不对直接拒绝', async () => {
  const realname = { id: 'aliyun_id2meta_ocr', verify: async () => ({ status: 'match' }) };
  const { service, body } = commerceFixture(realname);
  await assert.rejects(() => service.verifyIdentity(USER, { ...body, frontImage: '' }),
    { code: 'INVALID_ID_IMAGE' });
  await assert.rejects(() => service.verifyIdentity(USER,
    { ...body, frontImage: Buffer.alloc(2 * 1024 * 1024 + 1, 0xff).toString('base64') }),
  { code: 'ID_IMAGE_TOO_LARGE' });
  await assert.rejects(() => service.verifyIdentity(USER,
    { ...body, frontImage: Buffer.from('not-an-image').toString('base64') }),
  { code: 'INVALID_ID_IMAGE' });
});
