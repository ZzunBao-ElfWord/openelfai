import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:openelf/models/elf.dart';
import 'package:openelf/sharing/work_material.dart';
import 'package:openelf/widgets/work_share_sheet.dart';
import 'package:openelf/services/stage_bind_service.dart';
import 'package:openelf/pages/stage_bind_page.dart';
import 'package:openelf_douyin_share/openelf_douyin_share.dart';

ElfPost post(
        {String kind = 'video',
        String? url,
        String body = '这是完整的 AI 创作正文，不能变成前40字摘要'}) =>
    ElfPost(
        id: 'post_one',
        elfId: 'elf_one',
        kind: kind,
        body: body,
        timeAgo: '刚刚',
        videoUrl: kind == 'video'
            ? url ?? 'https://openelfai.com/api/v1/world-assets/videos/v.mp4'
            : null,
        imageUrl: kind == 'image'
            ? url ?? 'https://openelfai.com/api/v1/world-assets/a.png'
            : null);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
      'video work downloads original MP4 and preserves complete caption, no credentials',
      () async {
    final bytes = [0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109];
    final client = MockClient((request) async {
      expect(request.followRedirects, false);
      expect(request.headers.containsKey('authorization'), false);
      expect(request.url.path, endsWith('/v.mp4'));
      return http.Response.bytes(bytes, 200);
    });
    addTearDown(client.close);
    final material = await WorkMaterialLoader(client).load(post());
    expect(material.bytes, bytes);
    expect(material.mime, 'video/mp4');
    expect(material.text, contains(post().body));
    expect(material.text, contains('内容由 AI 生成'));
    expect(material.filename, endsWith('.mp4'));
  });
  test('text work keeps whole body and does not download a profile card',
      () async {
    final client =
        MockClient((_) async => throw StateError('must not request'));
    addTearDown(client.close);
    final p = post(kind: 'text', body: List.filled(100, '完整正文').join());
    final material = await WorkMaterialLoader(client).load(p);
    expect(material.text, startsWith(p.body));
    expect(material.bytes, isNull);
  });
  test('untrusted URLs and invalid bytes never become shareable media',
      () async {
    final client =
        MockClient((_) async => http.Response('<html>error</html>', 200));
    addTearDown(client.close);
    for (final url in [
      'http://openelfai.com/api/v1/world-assets/v.mp4',
      'https://evil.test/a.mp4',
      'https://openelfai.com/api/v1/wallet',
      'https://user:pass@openelfai.com/api/v1/world-assets/a.mp4',
      'https://openelfai.com/api/v1/world-assets/a.mp4'
    ]) {
      await expectLater(WorkMaterialLoader(client).load(post(url: url)),
          throwsFormatException);
    }
  });
  test('HTTP failure and redirects cannot silently share text instead of video',
      () async {
    for (final code in [302, 401, 404, 500]) {
      final client = MockClient((_) async => http.Response('failure', code));
      await expectLater(
          WorkMaterialLoader(client).load(post()), throwsFormatException);
      client.close();
    }
  });
  test(
      'Android publication request is distinct from contacts/story card sharing',
      () async {
    MethodCall? call;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(OpenElfDouyinShare.channel, (value) async {
      call = value;
      return 'cancelled';
    });
    addTearDown(() => TestDefaultBinaryMessengerBinding
        .instance.defaultBinaryMessenger
        .setMockMethodCallHandler(OpenElfDouyinShare.channel, null));
    await OpenElfDouyinShare.shareWork(Uint8List.fromList([1, 2, 3]),
        video: true);
    expect(call?.method, 'shareWork');
    expect(call?.arguments['video'], true);
    expect(call?.arguments['scene'], 'publish');
    expect(call?.arguments['privacyConsent'], true);
  });
  test('oversized response is rejected before sharing', () async {
    final client = MockClient.streaming((_, __) async => http.StreamedResponse(
        const Stream<List<int>>.empty(), 200,
        contentLength: WorkMaterialLoader.maxBytes + 1));
    addTearDown(client.close);
    await expectLater(
        WorkMaterialLoader(client).load(post()), throwsFormatException);
  });
  testWidgets('common platforms are sorted first without hiding other targets',
      (tester) async {
    SharedPreferences.setMockInitialValues({
      'openelf.stageBinds.preferred': '{"bilibili":"2026-10-30T00:00:00Z"}'
    });
    await StageBindService.instance.load('preferred');
    addTearDown(StageBindService.instance.reset);
    await tester
        .pumpWidget(const MaterialApp(home: Scaffold(body: WorkShareSheet())));
    expect(tester.getTopLeft(find.text('哔哩哔哩')).dy,
        lessThan(tester.getTopLeft(find.text('抖音')).dy));
    expect(find.text('快手'), findsOneWidget);
    expect(find.text('微信'), findsOneWidget);
  });
  testWidgets(
      'work panel has publication and full-caption actions, excludes deferred Xiaohongshu',
      (tester) async {
    await tester
        .pumpWidget(const MaterialApp(home: Scaffold(body: WorkShareSheet())));
    expect(find.text('分享这条 AI 作品'), findsOneWidget);
    expect(find.text('抖音'), findsOneWidget);
    expect(find.text('小红书'), findsNothing);
    expect(find.text('复制作品全文'), findsOneWidget);
    expect(find.textContaining('已授权'), findsNothing);
  });
  testWidgets(
      'old local pre-binding becomes a preference, never an OAuth claim',
      (tester) async {
    SharedPreferences.setMockInitialValues(
        {'openelf.stageBinds.user_one': '{"douyin":"2026-10-30T00:00:00Z"}'});
    await StageBindService.instance.load('user_one');
    addTearDown(StageBindService.instance.reset);
    await tester.pumpWidget(const MaterialApp(home: StageBindPage()));
    expect(find.text('作品分享平台'), findsOneWidget);
    expect(find.text('常用'), findsOneWidget);
    expect(find.textContaining('已授权发布'), findsNothing);
    expect(find.textContaining('已绑定'), findsNothing);
  });
  test(
      'feed buttons pass exact post, and native video fallback does not discard media',
      () {
    for (final file in [
      'lib/pages/world_page.dart',
      'lib/pages/video_feed_page.dart'
    ]) {
      final source = File(file).readAsStringSync();
      expect(source, contains('WorkShareHelper.share(context, p)'));
      expect(source, isNot(contains('p.body.substring(0, 40)')));
    }
    final native =
        File('android/app/src/main/kotlin/com/openelf/app/MainActivity.kt')
            .readAsStringSync();
    expect(native, contains('Do not silently replace a video with text'));
    expect(native, contains('"video/mp4" -> "mp4"'));
  });
}
