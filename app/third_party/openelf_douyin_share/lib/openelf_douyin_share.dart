import 'package:flutter/services.dart';

/// No startup initialization or account authorization. Native methods are lazy.
class OpenElfDouyinShare {
  static const channel = MethodChannel('openelf/douyin_share');
  static const clientKey = 'awf8w18qtnqq1kum';
  static Future<String?> availability() =>
      channel.invokeMethod<String>('availability');
  static Future<String?> share(Uint8List png, String scene) =>
      channel.invokeMethod<String>('shareImage', {
        'png': png,
        'scene': scene,
        'clientKey': clientKey,
        'privacyConsent': true,
      }).timeout(const Duration(seconds: 190));
}
