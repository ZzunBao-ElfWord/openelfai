import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:openelf/sharing/poster_saver.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final png = Uint8List.fromList([137, 80, 78, 71, 13, 10, 26, 10, 0]);
  var calls = 0;
  Object? response;
  setUp(() {
    calls = 0;
    response = 'gallery';
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(PosterSaver.channel, (call) async {
      calls++;
      expect(call.method, 'save');
      expect((call.arguments as Map).keys, ['png']);
      expect((call.arguments as Map)['png'], png);
      return response;
    });
  });
  tearDown(() {
    debugDefaultTargetPlatformOverride = null;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(PosterSaver.channel, null);
  });
  test('only confirmed native success counts as saved', () async {
    for (final platform in [TargetPlatform.android, TargetPlatform.iOS]) {
      debugDefaultTargetPlatformOverride = platform;
      response = 'gallery';
      expect(await PosterSaver.save(png), PosterSaveResult.gallery);
      response = 'file';
      expect(await PosterSaver.save(png), PosterSaveResult.file);
      response = 'cancelled';
      expect(await PosterSaver.save(png), PosterSaveResult.cancelled);
      response = null;
      await expectLater(PosterSaver.save(png), throwsStateError);
    }
  });
  test('invalid or oversized PNG never enters native storage', () async {
    await expectLater(PosterSaver.save(Uint8List(8)), throwsArgumentError);
    await expectLater(
        PosterSaver.save(Uint8List(10 * 1024 * 1024 + 1)), throwsArgumentError);
    expect(calls, 0);
  });
  test('unsupported desktop does not call native storage', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.windows;
    await expectLater(PosterSaver.save(png), throwsUnsupportedError);
    expect(calls, 0);
  });
}
