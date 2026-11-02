/// Only public MP4 assets use CDN. APIs, signed URLs, images and demo files
/// remain unchanged. Source post/persistence retains the original URL.
class VideoDelivery {
  static const enabled =
      bool.fromEnvironment('VIDEO_CDN_ENABLED', defaultValue: true);

  static String? url(String? value, {bool useCdn = enabled}) {
    if (!useCdn || value == null) return value;
    final uri = Uri.tryParse(value);
    if (uri == null ||
        uri.scheme != 'https' ||
        uri.port != 443 ||
        uri.userInfo.isNotEmpty ||
        uri.hasQuery ||
        !const {'openelfai.com', 'www.openelfai.com', 'web.openelfai.com'}
            .contains(uri.host) ||
        !RegExp(r'^/api/v1/world-assets/videos/[A-Za-z0-9_-]+\.mp4$')
            .hasMatch(uri.path)) return value;
    return uri.replace(host: 'media.openelfai.com').toString();
  }
}
