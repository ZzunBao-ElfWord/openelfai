/* Reusable PNVS Web adapter. No application secret is stored in browser code. */
(function () {
  'use strict';
  let running = false;
  window.OpenElfWebCaptcha = {
    requestProof: function (appId) {
      if (!/^[a-f0-9]{32}$/i.test(appId || '')) return Promise.reject(new Error('网页图形验证 AppID 无效'));
      if (running) return Promise.reject(new Error('图形验证正在进行'));
      if (typeof window.initAlicom4 !== 'function') return Promise.reject(new Error('图形验证 SDK 未加载，请刷新重试'));
      running = true;
      return new Promise(function (resolve, reject) {
        let captcha;
        let finished = false;
        const timer = setTimeout(function () { finish(new Error('图形验证已超时，请重试')); }, 120000);
        function finish(error, proof) {
          if (finished) return;
          finished = true;
          running = false;
          clearTimeout(timer);
          if (captcha) { try { captcha.destroy(); } catch (_) {} }
          if (error) reject(error); else resolve(proof);
        }
        try {
          window.initAlicom4({ captchaId: appId, product: 'bind', language: 'zho', https: true,
            onError: function () { finish(new Error('图形验证初始化失败，请检查域名配置及网络')); }
          }, function (instance) {
            if (finished) { try { instance.destroy(); } catch (_) {} return; }
            captcha = instance;
            let shown = false;
            function show() { if (!shown && !finished) { shown = true; captcha.showCaptcha(); } }
            captcha.onNextReady(show);
            captcha.onSuccess(function () {
              const data = captcha.getValidate();
              const proof = { platform: 'web' };
              for (const name of ['lot_number', 'pass_token', 'gen_time', 'captcha_output']) {
                if (!data || typeof data[name] !== 'string' || !data[name] || data[name].length > 8192) {
                  finish(new Error('图形验证结果无效，请重试')); return;
                }
                proof[name] = data[name];
              }
              finish(null, proof);
            });
            captcha.onError(function () { finish(new Error('图形验证资源加载失败，请重试')); });
            captcha.onClose(function () { finish(new Error('已取消图形验证')); });
          });
        } catch (_) { finish(new Error('图形验证初始化失败，请重试')); }
      });
    }
  };
}());
