import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:openelf/config/release_info.dart';

void main() {
  test('customer version, pubspec and iOS workflow agree', () {
    expect(File('pubspec.yaml').readAsStringSync(),
        contains('version: ${ReleaseInfo.version}+${ReleaseInfo.build}'));
    final workflow =
        File('../.github/workflows/build-ios.yml').readAsStringSync();
    expect(workflow, contains('BUILD_NAME: ${ReleaseInfo.version}'));
    expect(workflow, contains("BUILD_NUMBER: '${ReleaseInfo.build}'"));
    expect(ReleaseInfo.build, inInclusiveRange(1, 20));
  });

  test('Android update code advances while display counter restarts', () {
    int code(int patch, int build) => (patch - 4) * 20 + build;
    expect(code(4, 20), 20);
    expect(code(5, 1), 21);
    expect(code(5, 20), 40);
    expect(code(6, 1), 41);
    final gradle = File('android/app/build.gradle.kts').readAsStringSync();
    expect(
        gradle, contains('(releaseParts[2] - 4) * 20 + flutter.versionCode'));
  });
}
