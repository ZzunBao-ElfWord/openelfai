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
    expect(ReleaseInfo.build, inInclusiveRange(1, 99));
  });

  test('Android update code advances while display counter restarts', () {
    int code(int patch, int build) => (patch - 4) * 99 + build + 1;
    // Latest delivered APK has code 22; next customer version must update it.
    expect(code(4, 22), 23);
    expect(code(4, 22), greaterThan(22));
    expect(code(4, 99), 100);
    expect(code(5, 1), code(4, 99) + 1);
    expect(code(5, 99), 199);
    expect(code(6, 1), 200);
    final gradle = File('android/app/build.gradle.kts').readAsStringSync();
    expect(
        gradle, contains('(releaseParts[2] - 4) * 99 + flutter.versionCode + 1'));
  });
}
