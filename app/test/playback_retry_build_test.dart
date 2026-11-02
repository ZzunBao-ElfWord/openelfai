import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:openelf/config/release_info.dart';

void main() {
  test('retry test is explicitly gated and does not bump display version', () {
    final gradle = File('android/build.gradle.kts').readAsStringSync();
    expect(gradle, contains('OPENELF_MEDIA3_RETRY_TEST'));
    expect(gradle, contains('.getOrElse(false)'));
    expect(gradle, contains('if (playbackRetryTest)'));
    expect(gradle, contains('requested.group == "androidx.media3"'));
    expect(gradle, contains('useVersion("1.12.0-alpha02")'));
    expect(gradle, contains('it.compileSdkMinor = 0'));
    final appGradle = File('android/app/build.gradle.kts').readAsStringSync();
    expect(
        appGradle,
        contains(
            'compileSdk = if (playbackRetryTest) 37 else flutter.compileSdkVersion'));
    expect(appGradle, contains('targetSdk = flutter.targetSdkVersion'));
    expect(appGradle, contains('minSdk = flutter.minSdkVersion'));
    final pubspec = File('pubspec.yaml').readAsStringSync();
    expect(pubspec,
        contains('version: ${ReleaseInfo.version}+${ReleaseInfo.build}'));
    expect(ReleaseInfo.build, inInclusiveRange(1, 99));
  });
  test('old video completion/error cannot overwrite a replacement controller',
      () {
    final feed = File('lib/pages/video_feed_page.dart').readAsStringSync();
    expect(RegExp(r'!identical\(_vc, c\)').allMatches(feed).length, 2);
    expect(feed, contains('if (widget.active) c.play();'));
    final viewer = File('lib/pages/media_viewer_page.dart').readAsStringSync();
    expect(viewer, contains('!identical(_c, c)'));
    expect(viewer, contains('mounted && identical(_c, c)'));
    expect(feed, isNot(contains('debugPrint(url)')));
  });
}
