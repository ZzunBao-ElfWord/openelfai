import 'auth_repository.dart';

Future<CaptchaProof?> verifyWebCaptcha() async {
  throw const AuthException('UNSUPPORTED_PLATFORM', '当前平台不支持网页图形验证');
}
