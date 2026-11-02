import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:openelf/auth/desktop_captcha_message.dart';

void main() {
  final nonce = 'a' * 64;
  final url = 'https://web.openelfai.com/desktop.html#$nonce';
  Map<String, dynamic> message() => {
        'version': 1,
        'nonce': nonce,
        'type': 'proof',
        'proof': <String, dynamic>{
          'platform': 'web',
          'lot_number': 'fixture-lot',
          'pass_token': 'fixture-pass',
          'gen_time': '12345',
          'captcha_output': 'fixture-output'
        }
      };
  test('proof envelope goes to backend as web proof, not a desktop bypass', () {
    final proof =
        decodeDesktopCaptchaMessage(jsonEncode(message()), nonce, url)!;
    expect(proof.platform, 'web');
    expect(proof.lotNumber, 'fixture-lot');
    expect(proof.toJson()['captcha_output'], 'fixture-output');
  });
  test('cancel returns no proof', () {
    expect(
        decodeDesktopCaptchaMessage(
            {'version': 1, 'nonce': nonce, 'type': 'cancel'}, nonce, url),
        isNull);
  });
  test('foreign origin, wrong page, HTTP or session are rejected', () {
    for (final candidate in [
      'https://evil.example/desktop.html#$nonce',
      'http://web.openelfai.com/desktop.html#$nonce',
      'https://web.openelfai.com:444/desktop.html#$nonce',
      'https://user@web.openelfai.com/desktop.html#$nonce',
      'https://web.openelfai.com/other.html#$nonce',
      'https://web.openelfai.com/desktop.html#wrong'
    ]) {
      expect(() => decodeDesktopCaptchaMessage(message(), nonce, candidate),
          throwsFormatException);
    }
    expect(
        () => decodeDesktopCaptchaMessage(
            {...message(), 'nonce': 'wrong'}, nonce, url),
        throwsFormatException);
  });
  test('partial, non-string, oversized, and fake platform proof never continue',
      () {
    for (final field in [
      'lot_number',
      'pass_token',
      'gen_time',
      'captcha_output'
    ]) {
      for (final value in ['', 123, 'x' * 8193]) {
        final data = message();
        (data['proof'] as Map)[field] = value;
        expect(() => decodeDesktopCaptchaMessage(data, nonce, url),
            throwsFormatException);
      }
    }
    final data = message();
    (data['proof'] as Map)['platform'] = 'desktop';
    expect(() => decodeDesktopCaptchaMessage(data, nonce, url),
        throwsFormatException);
    expect(() => decodeDesktopCaptchaMessage('x' * 65537, nonce, url),
        throwsFormatException);
    expect(
        () => decodeDesktopCaptchaMessage(
            {...message(), 'version': 2}, nonce, url),
        throwsFormatException);
  });
}
