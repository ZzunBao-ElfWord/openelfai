/* Flutter Web only: no fetch interception, SMS calls, secrets or console changes. */
(function () {
  'use strict';
  const loaders = new Map();
  let running = false;
  function load(name, ready) {
    if (ready()) return Promise.resolve();
    if (loaders.has(name)) return loaders.get(name);
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timer = setTimeout(() => {
        script.remove(); reject(new Error('图形验证资源加载超时，请重试'));
      }, 15000);
      script.src = '/auth-assets/' + name;
      script.onload = () => {
        clearTimeout(timer);
        ready() ? resolve() : reject(new Error('图形验证资源初始化失败'));
      };
      script.onerror = () => {
        clearTimeout(timer); script.remove();
        reject(new Error('图形验证资源加载失败，请重试'));
      };
      document.head.appendChild(script);
    }).catch(error => { loaders.delete(name); throw error; });
    loaders.set(name, promise);
    return promise;
  }
  window.OpenElfCaptcha = {
    async requestJson() {
      if (running) return JSON.stringify({ error: '图形验证正在进行' });
      running = true;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        let config;
        try {
          const response = await fetch('/api/v1/auth/captcha/config', {
            cache: 'no-store', credentials: 'omit', signal: controller.signal
          });
          if (!response.ok) throw new Error('无法读取图形验证配置');
          config = await response.json();
        } finally { clearTimeout(timer); }
        if (!config.enabled || config.platform !== 'web' ||
            !/^[a-f0-9]{32}$/i.test(config.appId || '')) {
          throw new Error('网页图形验证尚未配置，请联系管理员');
        }
        await load('ct4.js', () => typeof window.initAlicom4 === 'function');
        await load('web-captcha.js', () => Boolean(window.OpenElfWebCaptcha));
        // User challenge precedes Dart's SMS HTTP timeout. Do not consume proof
        // via the diagnostic check endpoint; send-code validates it once.
        const proof = await window.OpenElfWebCaptcha.requestProof(config.appId);
        return JSON.stringify(proof);
      } catch (error) {
        if (error.message === '已取消图形验证') return JSON.stringify({ cancelled: true });
        return JSON.stringify({ error: error.name === 'AbortError'
          ? '读取图形验证配置超时，请重试'
          : (error.message || '图形验证失败，请重试') });
      } finally { running = false; }
    }
  };
}());
