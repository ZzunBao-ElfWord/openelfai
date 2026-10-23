'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

for (const name of ['DB_PASSWORD', 'JWT_SECRET', 'SMS_CODE_PEPPER', 'REFRESH_TOKEN_PEPPER']) {
  process.env[name] = 'identity-test-secret-not-for-deployment';
}
process.env.NODE_ENV = 'test';
process.env.ALIYUN_CLOUDAUTH_ENABLED = 'false';

const buildApp = require('../src/app');
const config = require('../src/config');
const {
  IdentityError,
  createAliyunIdentityProvider,
  decodeImage,
  maskIdNumber,
  maskName,
} = require('../src/identity');
const { signAccessToken } = require('../src/security');
const { memoryStore } = require('./helpers/payment_memory');

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(600, 1)]);

test('证件图片只接受 2 MB 内的 JPG/PNG base64', () => {
  assert.deepEqual(decodeImage(jpeg.toString('base64'), '人像面'), jpeg);
  assert.throws(
    () => decodeImage(Buffer.alloc(600, 1).toString('base64'), '人像面'),
    (error) => error instanceof IdentityError && error.code === 'IDENTITY_IMAGE_TYPE',
  );
  assert.throws(
    () => decodeImage('not-base64', '国徽面'),
    (error) => error instanceof IdentityError && error.code === 'IDENTITY_IMAGE_INVALID',
  );
});

test('阿里云响应只输出脱敏身份信息', async () => {
  const client = {
    async id2MetaVerifyWithOCRAdvance(request) {
      assert.ok(request.certFileObject);
      assert.ok(request.certNationalFileObject);
      return {
        body: {
          code: '200',
          requestId: 'aliyun-request-id',
          resultObject: {
            bizCode: '1',
            cardInfo: JSON.stringify({ certName: '张三丰', certNo: '110101199001011234' }),
          },
        },
      };
    },
  };
  const provider = createAliyunIdentityProvider(
    {
      enabled: true,
      connectTimeoutMs: 1000,
      readTimeoutMs: 1000,
    },
    client,
  );
  const result = await provider.verify({ frontImage: jpeg, backImage: jpeg });
  assert.equal(result.maskedName, '张**');
  assert.equal(result.maskedIdNumber, '1101**********1234');
  assert.equal(result.provider, 'aliyun_id2_ocr');
  assert.equal(maskName('李雷'), '李*');
  assert.equal(maskIdNumber('32010119881212321X'), '3201**********321X');
});

test('实名认证 HTTP 接口需要登录和授权，成功结果持久化后可查询', async () => {
  const user = {
    id: 'u_identity_test_1234567890',
    phone: '13800138000',
    nickname: '测试用户',
    avatar_initial: '测',
    status: 'active',
    created_at: new Date().toISOString(),
  };
  let savedIdentity = null;
  const db = {
    async execute(sql, params) {
      if (sql.includes('FROM refresh_sessions')) {
        return [[{ user_id: user.id, expires_at: Date.now() + 60_000 }]];
      }
      if (sql.includes('FROM users')) return [[user]];
      if (sql.startsWith('SELECT * FROM identity_verifications')) {
        return [savedIdentity ? [savedIdentity] : []];
      }
      if (sql.startsWith('INSERT INTO identity_verifications')) {
        savedIdentity = {
          user_id: params[0],
          status: 'verified',
          masked_name: params[1],
          masked_id_number: params[2],
          provider: params[3],
          provider_request_id: params[4],
          verified_at: params[5],
          updated_at: params[6],
        };
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const identityProvider = {
    async verify({ frontImage, backImage }) {
      assert.equal(frontImage.length, jpeg.length);
      assert.equal(backImage.length, jpeg.length);
      return {
        maskedName: '张*',
        maskedIdNumber: '1101**********1234',
        provider: 'aliyun_id2_ocr',
        requestId: 'request-id',
      };
    },
  };
  const paymentStore = memoryStore();
  paymentStore.addUser(user);
  const app = await buildApp({
    db,
    identityProvider,
    paymentStore,
    sms: {},
    captcha: {},
    logger: false,
  });
  const token = signAccessToken({
    secret: config.jwtSecret,
    userId: user.id,
    sessionId: 'identity-session',
    ttlSec: 900,
  });
  const headers = { authorization: `Bearer ${token}` };
  const payload = {
    frontImageBase64: jpeg.toString('base64'),
    backImageBase64: jpeg.toString('base64'),
    consent: true,
  };

  try {
    assert.equal((await app.inject('/api/v1/identity/status')).statusCode, 401);
    let response = await app.inject({
      method: 'POST',
      url: '/api/v1/identity/verify',
      headers,
      payload: { ...payload, consent: false },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, 'IDENTITY_CONSENT_REQUIRED');

    response = await app.inject({
      method: 'POST',
      url: '/api/v1/identity/verify',
      headers,
      payload,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().identity.status, 'verified');
    assert.equal(response.json().identity.maskedName, '张*');
    assert.equal(response.body.includes('110101199001011234'), false);

    response = await app.inject({ url: '/api/v1/identity/status', headers });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().identity.provider, 'aliyun_id2_ocr');
  } finally {
    await app.close();
  }
});
