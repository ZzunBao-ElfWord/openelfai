import 'package:flutter_test/flutter_test.dart';
import 'package:openelf/config/video_delivery.dart';

void main() {
  const origin =
      'https://openelfai.com/api/v1/world-assets/videos/doubao-2026-10-28-26330b01.mp4';
  final cdn = origin.replaceFirst('openelfai.com', 'media.openelfai.com');
  test('public MP4 playback maps without changing APIs or protected URLs', () {
    expect(VideoDelivery.url(origin), cdn);
    expect(VideoDelivery.url(cdn), cdn);
    expect(VideoDelivery.url(origin, useCdn: false), origin);
    for (final url in [
      null,
      '',
      'invalid',
      origin.replaceFirst('https:', 'http:'),
      origin.replaceFirst('openelfai.com', 'evil.test'),
      '$origin?token=private',
      origin.replaceFirst('https://', 'https://user:password@'),
      origin.replaceFirst('.mp4', '.jpg'),
      'https://openelfai.com/app/media/sample.mp4',
      'https://openelfai.com/api/v1/account',
      origin.replaceFirst('openelfai.com', 'openelfai.com:444'),
    ]) {
      expect(VideoDelivery.url(url), url);
    }
  });
}
