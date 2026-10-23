'use strict';

const { Readable } = require('node:stream');

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MIN_IMAGE_BYTES = 512;

class IdentityError extends Error {
  constructor(code, message, statusCode = 422, cause) {
    super(message);
    this.name = 'IdentityError';
    this.code = code;
    this.statusCode = statusCode;
    this.cause = cause;
  }
}

function decodeImage(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new IdentityError('IDENTITY_IMAGE_REQUIRED', `请上传身份证${label}`);
  }
  // 2 MiB becomes about 2.8 MiB after base64 encoding. Reject oversized input
  // before allocating a Buffer.
  if (value.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 8) {
    throw new IdentityError('IDENTITY_IMAGE_TOO_LARGE', `身份证${label}不能超过 2 MB`);
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new IdentityError('IDENTITY_IMAGE_INVALID', `身份证${label}图片格式无效`);
  }

  const image = Buffer.from(value, 'base64');
  if (image.length < MIN_IMAGE_BYTES || image.length > MAX_IMAGE_BYTES) {
    throw new IdentityError(
      image.length > MAX_IMAGE_BYTES ? 'IDENTITY_IMAGE_TOO_LARGE' : 'IDENTITY_IMAGE_INVALID',
      image.length > MAX_IMAGE_BYTES
        ? `身份证${label}不能超过 2 MB`
        : `身份证${label}图片无效，请重新选择`,
    );
  }

  const jpeg = image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff;
  const png = image.subarray(0, 8).equals(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  if (!jpeg && !png) {
    throw new IdentityError('IDENTITY_IMAGE_TYPE', `身份证${label}仅支持 JPG 或 PNG`);
  }
  return image;
}

function maskName(value) {
  const name = String(value || '').trim();
  if (!name) return '已核验用户';
  if (name.includes('*')) return name.slice(0, 8);
  return `${name[0]}${'*'.repeat(Math.min(Math.max(name.length - 1, 1), 3))}`;
}

function maskIdNumber(value) {
  const id = String(value || '').trim().toUpperCase();
  if (!id) return '****';
  const compact = id.replace(/[^0-9X*]/g, '');
  if (compact.length <= 8) return '*'.repeat(Math.max(compact.length, 4));
  return `${compact.slice(0, 4)}${'*'.repeat(compact.length - 8)}${compact.slice(-4)}`;
}

function parseCardInfo(raw) {
  if (typeof raw !== 'string' || raw.length > 16_384) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch (_) {
    return {};
  }
}

function createAliyunIdentityProvider(settings, injectedClient) {
  let client = injectedClient || null;

  function getClient() {
    if (client) return client;
    if (!settings.enabled || !settings.accessKeyId || !settings.accessKeySecret) {
      throw new IdentityError(
        'IDENTITY_NOT_CONFIGURED',
        '实名认证服务尚未配置',
        503,
      );
    }
    const Cloudauth = require('@alicloud/cloudauth20190307');
    const OpenApi = require('@alicloud/openapi-client');
    const openApiConfig = new OpenApi.Config({
      accessKeyId: settings.accessKeyId,
      accessKeySecret: settings.accessKeySecret,
    });
    openApiConfig.endpoint = settings.endpoint;
    openApiConfig.regionId = settings.regionId;
    client = new Cloudauth.default(openApiConfig);
    return client;
  }

  return {
    name: 'aliyun_id2_ocr',
    async verify({ frontImage, backImage }) {
      if (!settings.enabled && !injectedClient) {
        throw new IdentityError('IDENTITY_NOT_CONFIGURED', '实名认证服务尚未配置', 503);
      }

      const Cloudauth = require('@alicloud/cloudauth20190307');
      const Util = require('@alicloud/tea-util');
      const request = new Cloudauth.Id2MetaVerifyWithOCRAdvanceRequest({
        certFileObject: Readable.from(frontImage),
        certNationalFileObject: Readable.from(backImage),
      });
      const runtime = new Util.RuntimeOptions({
        connectTimeout: settings.connectTimeoutMs,
        readTimeout: settings.readTimeoutMs,
        autoretry: false,
      });

      let response;
      try {
        response = await getClient().id2MetaVerifyWithOCRAdvance(request, runtime);
      } catch (error) {
        if (error instanceof IdentityError) throw error;
        throw new IdentityError(
          'IDENTITY_PROVIDER_ERROR',
          '实名认证服务暂时不可用，请稍后重试',
          502,
          error,
        );
      }

      const body = response?.body || {};
      if (String(body.code || '') !== '200') {
        throw new IdentityError(
          'IDENTITY_IMAGE_REJECTED',
          '身份证照片无法识别，请确认正反面清晰、完整且无遮挡',
        );
      }

      const bizCode = String(body.resultObject?.bizCode || '');
      if (bizCode === '2') {
        throw new IdentityError('IDENTITY_MISMATCH', '身份证信息核验不一致，请检查证件后重试');
      }
      if (bizCode === '3') {
        throw new IdentityError('IDENTITY_NOT_FOUND', '未查询到该身份证信息，请确认使用有效证件');
      }
      if (bizCode !== '1') {
        throw new IdentityError(
          'IDENTITY_PROVIDER_ERROR',
          '实名认证服务返回异常，请稍后重试',
          502,
        );
      }

      const card = parseCardInfo(body.resultObject?.cardInfo);
      return {
        maskedName: maskName(card.certName),
        maskedIdNumber: maskIdNumber(card.certNo),
        provider: 'aliyun_id2_ocr',
        requestId: String(body.requestId || '').slice(0, 128),
      };
    },
  };
}

module.exports = {
  IdentityError,
  MAX_IMAGE_BYTES,
  createAliyunIdentityProvider,
  decodeImage,
  maskIdNumber,
  maskName,
  parseCardInfo,
};
