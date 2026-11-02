/* Real vendor proof only. This page never sends SMS, logs in, or receives account tokens. */
(function () {
  'use strict';
  const nonce = location.hash.slice(1);
  const button = document.getElementById('verify');
  const status = document.getElementById('status');
  let busy = false;
  let finished = false;
  function send(type, extra = {}) {
    if (finished) return;
    finished = true;
    window.chrome.webview.postMessage({ version: 1, nonce, type, ...extra });
  }
  if (location.origin !== 'https://web.openelfai.com' || !/^[a-f0-9]{64}$/.test(nonce) ||
      !window.chrome?.webview || !window.OpenElfWebCaptcha || typeof window.initAlicom4 !== 'function') {
    status.textContent = '桌面验证环境未就绪，请关闭后重试。';
    return;
  }
  button.disabled = false;
  button.textContent = '开始图形验证';
  button.addEventListener('click', async () => {
    if (busy || finished) return;
    busy = true; button.disabled = true;
    status.textContent = '正在读取验证配置…';
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 15000);
    try {
      let config;
      try {
        const response = await fetch('https://openelfai.com/api/v1/auth/captcha/config', {
          credentials: 'omit', cache: 'no-store', signal: abort.signal,
        });
        if (!response.ok || !String(response.headers.get('content-type') || '').includes('application/json')) {
          throw Error('无法读取图形验证配置，请稍后重试');
        }
        config = await response.json();
      } finally { clearTimeout(timer); }
      if (config.enabled !== true || config.mode !== 'enforce' || config.platform !== 'web' ||
          !/^[a-f0-9]{32}$/i.test(config.appId || '')) throw Error('网页图形验证配置未就绪');
      status.textContent = '请完成弹出的图形验证';
      const proof = await window.OpenElfWebCaptcha.requestProof(config.appId);
      send('proof', { proof });
      status.textContent = '验证完成，正在返回桌面应用…';
    } catch (error) {
      if (error.message === '已取消图形验证') { send('cancel'); return; }
      status.textContent = error.name === 'AbortError' ? '读取配置超时，请重试' : error.message;
      busy = false; button.disabled = false;
    }
  });
}());
