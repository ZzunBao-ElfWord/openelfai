import 'dart:convert';
import 'auth_repository.dart';

/// The page only supplies a vendor proof. The existing backend must verify it.
CaptchaProof? decodeDesktopCaptchaMessage(
    dynamic raw, String nonce, String url) {
  final uri = Uri.tryParse(url);
  if (uri == null ||
      uri.scheme != 'https' ||
      uri.host != 'web.openelfai.com' ||
      uri.port != 443 ||
      uri.userInfo.isNotEmpty ||
      uri.path != '/desktop.html' ||
      uri.fragment != nonce ||
      !RegExp(r'^[a-f0-9]{64}$').hasMatch(nonce)) {
    throw const FormatException('Invalid captcha origin');
  }
  if (raw is String && raw.length > 65536) {
    throw const FormatException('Oversized message');
  }
  final data = raw is String ? jsonDecode(raw) : raw;
  if (data is! Map || data['version'] != 1 || data['nonce'] != nonce) {
    throw const FormatException('Invalid captcha session');
  }
  if (data['type'] == 'cancel') return null;
  if (data['type'] != 'proof' || data['proof'] is! Map) {
    throw const FormatException('Invalid captcha message');
  }
  final proof = Map<String, dynamic>.from(data['proof'] as Map);
  if (proof['platform'] != 'web') {
    throw const FormatException('Invalid proof platform');
  }
  for (final key in [
    'lot_number',
    'pass_token',
    'gen_time',
    'captcha_output'
  ]) {
    final value = proof[key];
    if (value is! String || value.isEmpty || value.length > 8192) {
      throw const FormatException('Invalid proof field');
    }
  }
  return CaptchaProof.fromJson('web', proof);
}
