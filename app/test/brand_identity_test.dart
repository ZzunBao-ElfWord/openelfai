import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Android, iOS and Web customer-visible name is OpenElf', () {
    expect(File('android/app/src/main/AndroidManifest.xml').readAsStringSync(),
        contains('android:label="OpenElf"'));
    final plist = File('ios/Runner/Info.plist').readAsStringSync();
    for (final key in ['CFBundleDisplayName', 'CFBundleName']) {
      expect(
          RegExp('<key>$key</key>\\s*<string>OpenElf</string>').hasMatch(plist),
          isTrue);
    }
    final web = jsonDecode(File('web/manifest.json').readAsStringSync()) as Map;
    expect(web['name'], 'OpenElf');
    expect(web['short_name'], 'OpenElf');
    expect(File('web/index.html').readAsStringSync(),
        contains('<title>OpenElf</title>'));
  });

  test('all brand surfaces use the supplied P1 artwork catalog', () {
    final manifest =
        jsonDecode(File('scripts/app_icons_manifest.json').readAsStringSync())
            as Map;
    expect(manifest['original_sha256'],
        '45876b5abb4440ba9d4b69189161afb975e7d89864a7d56fb7628c600fc6613f');
    for (final source in [
      'lib/pages/login_page.dart',
      'lib/pages/home_shell.dart',
      'lib/main.dart'
    ]) {
      expect(File(source).readAsStringSync(),
          contains('assets/brand/app_icon.png'));
    }
  });
}
