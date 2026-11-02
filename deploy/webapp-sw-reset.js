/*
 * 自毁型 Service Worker（仅用于清理历史遗留缓存，不承担离线缓存职责）。
 *
 * 旧版部署曾注册过带 offline 缓存的 SW，它会一直吐旧 index.html 与旧
 * main.dart.js，表现为"已经发版但用户看到的还是旧界面"。这里让浏览器
 * 把该 SW 更新成这一版：接管后清空全部 Cache Storage、注销自身，
 * 再让所有窗口重新导航到线上最新构建。
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    } catch (e) { /* 忽略清理失败 */ }

    try {
      await self.registration.unregister();
    } catch (e) { /* 忽略注销失败 */ }

    const windows = await self.clients.matchAll({ type: 'window' });
    windows.forEach((client) => client.navigate(client.url));
  })());
});

// 不拦截任何请求：接管后就已注销，后续流量全部直达网络。
