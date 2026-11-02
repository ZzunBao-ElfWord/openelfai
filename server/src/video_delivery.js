'use strict';

// Delivery-only mapping. Never rewrite stored records, signed URLs, API hosts,
// pictures, missing demo files or third-party media. false rolls back delivery
// to the retained origin URL; it does not disable video playback/generation.
function videoDeliveryUrl(value, enabled = process.env.VIDEO_CDN_ENABLED !== 'false') {
  if (!enabled || typeof value !== 'string') return value;
  let url;
  try { url = new URL(value); } catch (_) { return value; }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search
      || !['openelfai.com', 'www.openelfai.com', 'web.openelfai.com'].includes(url.hostname)
      || !/^\/api\/v1\/world-assets\/videos\/[A-Za-z0-9_-]+\.mp4$/.test(url.pathname)) return value;
  url.hostname = 'media.openelfai.com';
  return url.href;
}

module.exports = { videoDeliveryUrl };
