import 'package:flutter/services.dart';

class OpenElfKwaiShare {
  static const channel = MethodChannel('openelf/kwai_share');
  static Future<String?> availability(String appId, String universalLink) =>
      channel.invokeMethod<String>(
          'availability', {'appId': appId, 'universalLink': universalLink});
  static Future<String?> share(
          String appId, String universalLink, Uint8List png) =>
      channel.invokeMethod<String>('shareImage', {
        'appId': appId,
        'universalLink': universalLink,
        'png': png,
        'privacyConsent': true
      }).timeout(const Duration(seconds: 190));
}
