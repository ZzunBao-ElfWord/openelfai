import 'dart:io';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('stage sharing has its own provider without replacing SDK providers',
      () {
    final manifest =
        File('android/app/src/main/AndroidManifest.xml').readAsStringSync();
    expect(manifest, contains('android:name=".StageShareFileProvider"'));
    expect(
        manifest,
        contains(
            r'android:authorities="${applicationId}.openelf.fileprovider"'));
    expect(manifest, isNot(contains('tools:replace="android:authorities"')));
    expect(
        File('android/app/src/main/kotlin/com/openelf/app/StageShareFileProvider.kt')
            .readAsStringSync(),
        contains('class StageShareFileProvider : FileProvider()'));
  });
}
