import 'dart:convert';
import 'dart:js_interop';

import 'auth_repository.dart';

@JS('OpenElfCaptcha.requestJson')
external JSPromise<JSString> _requestCaptcha();

Future<CaptchaProof?> verifyWebCaptcha() async {
  try {
    final raw = (await _requestCaptcha().toDart).toDart;
    final data = jsonDecode(raw);
    if (data is! Map<String, dynamic>) {
      throw const FormatException('Invalid proof');
    }
    if (data['cancelled'] == true) return null;
    if (data['error'] is String) {
      throw AuthException('CAPTCHA_UNAVAILABLE', data['error'] as String);
    }
    return CaptchaProof.fromJson('web', data);
  } on AuthException {
    rethrow;
  } catch (_) {
    throw const AuthException('CAPTCHA_UNAVAILABLE', '图形验证加载失败，请强制刷新网页后重试');
  }
}
