/* Source-controlled console auth, loaded before Next hydration on both site variants. */
(function () {
  'use strict';
  // Root layout also runs on the homepage; keep auth ready for client-side navigation to /console/.
  if (window.__openelfConsoleAuth) return;
  const API = 'https://api.openelfai.com';
  const AUTH = 'openelf:console:auth';
  const DEVICE = 'openelf:console:device';
  const VERSION = '20261102-source-v2';
  const nativeFetch = window.fetch.bind(window);
  let refreshPromise = null;
  let sending = false;
  let signingOut = false;
  let revision = 0;
  const loaders = new Map();
  function read() {
    try { return JSON.parse(localStorage.getItem(AUTH) || 'null'); } catch (_) { return null; }
  }
  function save(session) { localStorage.setItem(AUTH, JSON.stringify(session)); }
  function clear() { revision++; localStorage.removeItem(AUTH); }
  function device() {
    let id = localStorage.getItem(DEVICE);
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(id || '')) {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      id = 'web-console-' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(DEVICE, id);
    }
    return id;
  }
  function problem(status, code, message) {
    return new Response(JSON.stringify({ error: { code, message } }), {
      status, headers: { 'Content-Type': 'application/json' }
    });
  }
  async function raw(input, init) {
    const request = new Request(input, init);
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    request.signal.addEventListener('abort', onAbort, { once: true });
    if (request.signal.aborted) controller.abort();
    const timer = setTimeout(() => controller.abort(), 20000);
    try { return await nativeFetch(new Request(request, { signal: controller.signal, credentials: 'omit' })); }
    finally { clearTimeout(timer); request.signal.removeEventListener('abort', onAbort); }
  }
  function loadScript(url, available) {
    if (available()) return Promise.resolve();
    if (loaders.has(url)) return loaders.get(url);
    const pending = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timer = setTimeout(() => { script.remove(); reject(new Error('验证资源加载超时，请刷新重试')); }, 15000);
      script.src = url;
      script.onload = () => { clearTimeout(timer); available() ? resolve() : reject(new Error('验证资源初始化失败')); };
      script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('验证资源加载失败，请重试')); };
      document.head.appendChild(script);
    }).catch(error => { loaders.delete(url); throw error; });
    loaders.set(url, pending);
    return pending;
  }
  async function proof() {
    const response = await raw(API + '/api/v1/auth/captcha/config');
    if (!response.ok) throw new Error('无法读取图形认证配置，请稍后重试');
    const config = await response.json();
    if (!config.enabled || config.platform !== 'web' || config.appId !== '83a70a4cfa97f37954692b81c2055b90') {
      throw new Error('网页图形认证配置尚未就绪');
    }
    await loadScript('/console/auth/ct4.js', () => typeof window.initAlicom4 === 'function');
    await loadScript('/console/auth/web-captcha.js', () => Boolean(window.OpenElfWebCaptcha));
    return window.OpenElfWebCaptcha.requestProof(config.appId);
  }
  async function revoke(session) {
    if (!session?.refreshToken && !session?.accessToken) return true;
    const response = await raw(API + '/api/v1/auth/logout', {
      method: 'POST', headers: { 'Content-Type': 'application/json',
        ...(session.accessToken ? { Authorization: 'Bearer ' + session.accessToken } : {}) },
      body: JSON.stringify({ refreshToken: session.refreshToken || '' }), keepalive: true
    });
    return response.ok;
  }
  async function refresh() {
    if (refreshPromise) return refreshPromise;
    const original = read();
    if (!original?.refreshToken || signingOut) return false;
    // The backend rotates refresh tokens. Serialize across tabs; never knowingly
    // reuse a rotated token on browsers lacking Web Locks (re-login instead).
    if (!navigator.locks?.request) return false;
    const currentRevision = revision;
    refreshPromise = navigator.locks.request('openelf-console-refresh', async () => {
      const latest = read();
      if (currentRevision !== revision || signingOut || !latest?.refreshToken) return false;
      if (latest.refreshToken !== original.refreshToken) return Boolean(latest.accessToken);
      let response;
      try {
        response = await raw(API + '/api/v1/auth/refresh', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: latest.refreshToken, deviceId: device() })
        });
      } catch (_) { return false; }
      if (!response.ok) {
        if (response.status === 401 && currentRevision === revision) clear();
        return false;
      }
      const session = await response.json();
      if (!session.accessToken || !session.refreshToken) return false;
      if (currentRevision !== revision || signingOut || read()?.refreshToken !== latest.refreshToken) {
        // A logout or a new account won the race. Revoke the discarded new token.
        try { await revoke(session); } catch (_) {}
        return false;
      }
      save({ accessToken: session.accessToken, refreshToken: session.refreshToken, user: session.user || latest.user });
      return true;
    }).finally(() => { refreshPromise = null; });
    return refreshPromise;
  }
  window.fetch = async function (input, init) {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== API || !url.pathname.startsWith('/api/v1/')) return nativeFetch(input, init);
    try {
      if (url.pathname === '/api/v1/auth/send-code' && request.method === 'POST') {
        if (sending) return problem(409, 'CAPTCHA_BUSY', '图形验证或短信发送正在进行，请勿重复点击');
        sending = true;
        try {
          const body = await request.clone().json();
          if (!/^1[3-9]\d{9}$/.test(String(body.phone || '').trim())) return problem(400, 'INVALID_PHONE', '请输入正确的11位手机号');
          const validated = await proof();
          // Do NOT call diagnostic captcha/check here: it would consume the proof.
          const response = await raw(request, { body: JSON.stringify({ phone: String(body.phone).trim(), ...validated }) });
          const data = await response.clone().json().catch(() => null);
          if (data && 'debugCode' in data) {
            delete data.debugCode; // Never expose a development bypass in this console.
            return new Response(JSON.stringify(data), { status: response.status, headers: { 'Content-Type': 'application/json' } });
          }
          return response;
        } finally { sending = false; }
      }
      if (url.pathname === '/api/v1/auth/login-by-code' && request.method === 'POST') {
        const body = await request.clone().json();
        if (!/^1[3-9]\d{9}$/.test(String(body.phone || '').trim()) || !/^\d{6}$/.test(String(body.code || '').trim())) {
          return problem(400, 'INVALID_LOGIN', '请输入正确的手机号和6位验证码');
        }
        const response = await raw(request, { body: JSON.stringify({ ...body, phone: body.phone.trim(), code: body.code.trim(), deviceId: device() }) });
        if (response.ok) revision++;
        return response;
      }
      const protectedRequest = request.headers.has('Authorization') &&
        (url.pathname.startsWith('/api/v1/platform/') || url.pathname === '/api/v1/auth/me');
      if (!protectedRequest) return raw(request);
      function withCurrentToken() {
        const headers = new Headers(request.headers);
        const session = read();
        if (session?.accessToken) headers.set('Authorization', 'Bearer ' + session.accessToken);
        return new Request(request.clone(), { headers });
      }
      const owner = read()?.user?.id;
      let response = await raw(withCurrentToken());
      if (response.status === 401 && await refresh()) {
        if (read()?.user?.id !== owner || signingOut) return problem(401, 'ACCOUNT_CHANGED', '账号已变化，请重新登录');
        response = await raw(withCurrentToken());
      }
      return response;
    } catch (error) {
      return problem(503, 'CONSOLE_AUTH_UNAVAILABLE', error.name === 'AbortError'
        ? '请求超时，请稍后重试' : (error.message || '登录服务暂不可用，请重试'));
    }
  };
  // Capture before React's existing local-only logout handler. Never inspect keys.
  document.addEventListener('click', async function (event) {
    const button = event.target.closest?.('button.console-side-link');
    if (!button || button.textContent.trim() !== '退出登录') return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (signingOut) return;
    signingOut = true;
    button.disabled = true;
    button.textContent = '退出中…';
    const old = read();
    clear(); // Prevent outstanding requests/refresh from repopulating the account.
    try {
      const ok = await revoke(old);
      if (!ok) sessionStorage.setItem('openelf:console:logout-warning', '本机已退出，但服务端注销未确认，请稍后重新登录并退出。');
    } catch (_) {
      sessionStorage.setItem('openelf:console:logout-warning', '本机已退出；网络异常，服务端注销未确认。');
    }
    location.reload();
  }, true);
  window.addEventListener('storage', event => {
    if (event.key === AUTH && !event.newValue) { revision++; location.reload(); }
    if (event.key === AUTH && event.newValue) {
      try {
        const previous = JSON.parse(event.oldValue || 'null');
        const next = JSON.parse(event.newValue);
        if (previous?.user?.id !== next?.user?.id) { revision++; location.reload(); }
      } catch (_) { location.reload(); }
    }
  });
  document.addEventListener('DOMContentLoaded', function () {
    const warning = sessionStorage.getItem('openelf:console:logout-warning');
    if (!warning) return;
    sessionStorage.removeItem('openelf:console:logout-warning');
    const notice = document.createElement('p');
    notice.setAttribute('role', 'alert'); notice.textContent = warning;
    notice.style.cssText = 'position:fixed;bottom:16px;left:16px;right:16px;z-index:10000;padding:12px;background:#fff4d5;color:#654400;border-radius:8px';
    document.body.appendChild(notice);
  });
  window.__openelfConsoleAuth = { version: VERSION };
}());
