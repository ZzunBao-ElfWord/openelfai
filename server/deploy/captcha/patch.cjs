'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function insertOnce(source, anchor, addition) {
  if (source.split(anchor).length !== 2) {
    throw new Error('服务器代码与预期不一致，未进行更新，请先核对源码');
  }
  return source.replace(anchor, anchor + addition);
}

function prepare(app, config) {
  if (!app.includes("require('./captcha')")) {
    app = insertOnce(app, "const config = require('./config');",
      "\nconst { createCaptchaVerifier } = require('./captcha');");
  }
  if (!app.includes('const captcha =')) {
    app = insertOnce(app, '  const sms = options.sms || createSmsProvider(config);',
      '\n  const captcha = options.captcha || createCaptchaVerifier(config.captcha);');
  }
  if (!app.includes('await captcha.verify(request.body);')) {
    const anchor = '      const code = generateSmsCode();';
    if (app.split(anchor).length !== 2 || !app.includes("'/api/v1/auth/send-code'")) {
      throw new Error('无法安全定位短信发送入口，未进行更新');
    }
    app = app.replace(anchor, '      await captcha.verify(request.body);\n\n' + anchor);
  }
  if (!config.includes('  captcha: {')) {
    const closing = /\r?\n};\s*$/;
    if (!closing.test(config)) throw new Error('无法安全定位服务配置，未进行更新');
    config = config.replace(closing, `
  captcha: {
    enabled: bool('ALIYUN_CAPTCHA_ENABLED', false),
    allowOnError: bool('ALIYUN_CAPTCHA_ALLOW_ON_ERROR', true),
    endpoint: process.env.ALIYUN_CAPTCHA_ENDPOINT || 'https://captcha.alicaptcha.com/validate',
    timeoutMs: Number(process.env.ALIYUN_CAPTCHA_TIMEOUT_MS || 8000),
    schemes: {
      android: {
        appId: process.env.ALIYUN_CAPTCHA_ANDROID_APP_ID || '',
        appKey: process.env.ALIYUN_CAPTCHA_ANDROID_APP_KEY || '',
      },
      ios: {
        appId: process.env.ALIYUN_CAPTCHA_IOS_APP_ID || '',
        appKey: process.env.ALIYUN_CAPTCHA_IOS_APP_KEY || '',
      },
    },
  },
};
`);
  }
  new vm.Script(app, { filename: 'app.js' });
  new vm.Script(config, { filename: 'config.js' });
  return { app, config };
}

if (require.main === module) {
  const root = fs.realpathSync(process.argv[2]);
  if (root !== '/opt/openelf-api') throw new Error('仅支持 /opt/openelf-api');
  const appPath = path.join(root, 'src/app.js');
  const configPath = path.join(root, 'src/config.js');
  const result = prepare(fs.readFileSync(appPath, 'utf8'), fs.readFileSync(configPath, 'utf8'));
  if (process.argv[3] !== '--check') {
    fs.writeFileSync(appPath, result.app);
    fs.writeFileSync(configPath, result.config);
  }
  console.log(process.argv[3] === '--check' ? '源码补丁检查通过' : '图形验证补丁已应用');
}

module.exports = { prepare };
