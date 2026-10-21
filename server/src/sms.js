'use strict';

class SmsError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'SmsError';
    this.code = code;
    this.cause = cause;
  }
}

function maskPhone(phone) {
  return phone.length === 11 ? `${phone.slice(0, 3)}****${phone.slice(7)}` : '***';
}

function createAliyunProvider(settings) {
  let client = null;

  function getClient() {
    if (client) return client;
    const Dysmsapi = require('@alicloud/dysmsapi20170525');
    const OpenApi = require('@alicloud/openapi-client');
    const openApiConfig = new OpenApi.Config({
      accessKeyId: settings.accessKeyId,
      accessKeySecret: settings.accessKeySecret,
    });
    openApiConfig.endpoint = 'dysmsapi.aliyuncs.com';
    client = new Dysmsapi.default(openApiConfig);
    return client;
  }

  return {
    name: 'aliyun',
    exposesCode: false,
    async sendCode({ phone, code }) {
      if (
        !settings.accessKeyId ||
        !settings.accessKeySecret ||
        !settings.signName ||
        !settings.templateCode
      ) {
        throw new SmsError('SMS_NOT_CONFIGURED', '短信通道尚未配置');
      }

      const Dysmsapi = require('@alicloud/dysmsapi20170525');
      const Util = require('@alicloud/tea-util');
      const request = new Dysmsapi.SendSmsRequest({
        phoneNumbers: phone,
        signName: settings.signName,
        templateCode: settings.templateCode,
        templateParam: JSON.stringify({ code }),
      });
      const runtime = new Util.RuntimeOptions({
        connectTimeout: 5000,
        readTimeout: 10000,
      });

      try {
        const response = await getClient().sendSmsWithOptions(request, runtime);
        const body = response?.body || {};
        if (body.code !== 'OK') {
          throw new SmsError(
            'SMS_SEND_FAILED',
            `短信发送失败：${body.message || body.code || '未知错误'}`,
          );
        }
      } catch (error) {
        if (error instanceof SmsError) throw error;
        throw new SmsError('SMS_SEND_FAILED', '短信发送失败，请稍后重试', error);
      }
    },
  };
}

function createWhitelistProvider(settings) {
  return {
    name: 'whitelist',
    exposesCode: true,
    async sendCode({ phone, code }) {
      if (settings.whitelistPhones.length === 0) {
        throw new SmsError('SMS_NOT_CONFIGURED', '短信白名单尚未配置');
      }
      if (!settings.whitelistPhones.includes(phone)) {
        throw new SmsError('SMS_NOT_ALLOWED', '该手机号暂未加入内测白名单');
      }
      console.log(`[sms:whitelist] ${maskPhone(phone)} code=${code}`);
    },
  };
}

function createMockProvider() {
  return {
    name: 'mock',
    exposesCode: true,
    async sendCode({ phone, code }) {
      console.log(`[sms:mock] ${maskPhone(phone)} code=${code}`);
    },
  };
}

function createSmsProvider(config) {
  const settings = config.sms;
  switch (settings.provider) {
    case 'aliyun':
      return createAliyunProvider(settings.aliyun);
    case 'whitelist':
      return createWhitelistProvider(settings);
    case 'mock':
      if (config.isProduction) {
        throw new Error('生产环境禁止使用 mock 短信通道');
      }
      return createMockProvider();
    default:
      throw new Error(`未知的 SMS_PROVIDER: ${settings.provider}`);
  }
}

module.exports = { SmsError, createSmsProvider, maskPhone };
