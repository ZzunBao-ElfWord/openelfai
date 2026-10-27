import 'package:flutter/services.dart';

class OpenElfWechatShare {
  static const channel = MethodChannel('openelf/wechat_share');
  static Future<String?> availability(String appId, String universalLink) =>
      channel.invokeMethod<String>(
          'availability', {'appId': appId, 'universalLink': universalLink});
  static Future<String?> share(
          {required String appId,
          required String universalLink,
          required Uint8List png,
          required String scene}) =>
      channel.invokeMethod<String>('shareImage', {
        'appId': appId,
        'universalLink': universalLink,
        'png': png,
        'scene': scene,
        'privacyConsent': true
      }).timeout(const Duration(seconds: 190));
}
