'use strict';

const { Readable } = require('node:stream');

/// 实名核验结果只有三种业务状态；上游异常一律抛出 [RealnameError]，由调用方转成可重试错误。
const RESULT = { MATCH: 'match', MISMATCH: 'mismatch', NOT_FOUND: 'notfound' };

class RealnameError extends Error {
  constructor(code, message, { retryable = true, cause } = {}) {
    super(message);
    this.name = 'RealnameError';
    this.code = code;
    this.retryable = retryable;
    if (cause) this.cause = cause;
  }
}

/// 姓名比对：去掉空格后逐字相同。
function sameName(cardName, realName) {
  const a = String(cardName || '').replace(/\s+/g, '');
  const b = String(realName || '').replace(/\s+/g, '');
  return a.length > 0 && a === b;
}

/// 证件号比对：OCR 返回的证件号可能被打码，只在可见位上比对。
function sameIdNumber(cardNo, idNumber) {
  const a = String(cardNo || '').toUpperCase();
  const b = String(idNumber || '').toUpperCase();
  if (!a) return true; // 未返回证件号时跳过，权威源已核验照片上的信息。
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== '*' && a[i] !== b[i]) return false;
  }
  return true;
}

function parseCardInfo(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

/// 把 Buffer 包成二进制可读流：Advance 接口需要的是图片输入流。
function streamOf(buffer) {
  return new Readable({
    read() {
      this.push(buffer);
      this.push(null);
    },
  });
}

/// 阿里云实人认证（Cloudauth）适配层：
/// - ocr：Id2MetaVerifyWithOCR，正面 + 国徽面，一次调用完成 OCR 与权威源核验；
/// - plain：Id2MetaVerify，只做姓名 + 证件号二要素核验，不上传照片。
/// 两种模式都只把结果收敛成 match / mismatch / notfound。
function createAliyunVerifier(settings, injected = {}) {
  let client = injected.client || null;

  function sdk() {
    return require('@alicloud/cloudauth20190307');
  }

  function getClient() {
    if (client) return client;
    const Cloudauth = sdk();
    const Config = require('@alicloud/openapi-client').Config;
    // 带图片的 Advance 接口需要通过 credential 取凭证，不能用裸 AK 字段。
    const Credential = require('@alicloud/credentials').default;
    client = new Cloudauth.default(new Config({
      credential: new Credential({
        type: 'access_key',
        accessKeyId: settings.accessKeyId,
        accessKeySecret: settings.accessKeySecret,
      }),
      endpoint: settings.endpoint,
    }));
    return client;
  }

  function runtime() {
    const Util = require('@alicloud/tea-util');
    return new Util.RuntimeOptions({
      connectTimeout: 3000,
      readTimeout: Number(settings.timeoutMs) || 20000,
    });
  }

  async function call(method, request) {
    let response;
    try {
      response = await getClient()[method](request, runtime());
    } catch (error) {
      // 超时、网络、5xx 一律按「服务不可用」处理，绝不能当成认证失败。
      throw new RealnameError('REALNAME_UPSTREAM_ERROR', '实名核验服务调用失败', { cause: error });
    }
    const body = response?.body || {};
    if (String(body.code) !== '200') {
      throw new RealnameError('REALNAME_UPSTREAM_ERROR',
        `实名核验服务返回异常：${body.message || body.code || '未知错误'}`);
    }
    return body;
  }

  function bizStatus(bizCode) {
    if (String(bizCode) === '1') return RESULT.MATCH;
    if (String(bizCode) === '2') return RESULT.MISMATCH;
    if (String(bizCode) === '3') return RESULT.NOT_FOUND;
    throw new RealnameError('REALNAME_UPSTREAM_ERROR', '实名核验结果无法识别');
  }

  async function verifyWithOcr({ realName, idNumber, frontImage, backImage }) {
    const request = new (sdk().Id2MetaVerifyWithOCRAdvanceRequest)({
      certFileObject: streamOf(frontImage),
      certNationalFileObject: streamOf(backImage),
    });
    const body = await call('id2MetaVerifyWithOCRAdvance', request);
    const status = bizStatus(body.resultObject?.bizCode);
    if (status !== RESULT.MATCH) return { status, reason: 'authority' };

    // 照片读出的姓名/证件号必须与用户填写的一致，否则视为「填写内容与证件不符」。
    const card = parseCardInfo(body.resultObject?.cardInfo);
    if (!card) {
      throw new RealnameError('REALNAME_DOCUMENT_UNREADABLE',
        '身份证照片不清晰，请重新上传清晰的人像面与国徽面', { retryable: false });
    }
    if (!sameName(card.certName, realName) || !sameIdNumber(card.certNo, idNumber)) {
      return { status: RESULT.MISMATCH, reason: 'document' };
    }
    return { status: RESULT.MATCH, reason: 'ocr' };
  }

  async function verifyPlain({ realName, idNumber }) {
    const request = new (sdk().Id2MetaVerifyRequest)({
      paramType: 'normal',
      userName: realName,
      identifyNum: idNumber,
    });
    const body = await call('id2MetaVerify', request);
    return { status: bizStatus(body.resultObject?.bizCode), reason: 'authority' };
  }

  return {
    id: settings.mode === 'plain' ? 'aliyun_id2meta' : 'aliyun_id2meta_ocr',
    async verify({ realName, idNumber, frontImage, backImage }) {
      if (!settings.enabled) {
        throw new RealnameError('REALNAME_DISABLED', '实名核验服务尚未开放', { retryable: false });
      }
      if (!settings.accessKeyId || !settings.accessKeySecret) {
        throw new RealnameError('REALNAME_NOT_CONFIGURED', '实名核验服务尚未配置', { retryable: false });
      }
      return settings.mode === 'plain'
        ? verifyPlain({ realName, idNumber })
        : verifyWithOcr({ realName, idNumber, frontImage, backImage });
    },
  };
}

function createRealnameVerifier(settings, injected) {
  switch (settings.provider) {
    case 'aliyun':
      return createAliyunVerifier(settings, injected);
    default:
      throw new Error(`未知的实名核验通道: ${settings.provider}`);
  }
}

module.exports = { createRealnameVerifier, RealnameError, RESULT, sameName, sameIdNumber };
