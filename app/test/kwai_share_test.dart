import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:openelf/sharing/social_share.dart';
import 'package:openelf/sharing/pending_share_config.dart';
import 'package:openelf/sharing/kwai_share_adapter.dart';
import 'package:openelf/widgets/social_share_sheet.dart';
import 'package:openelf_kwai_share/openelf_kwai_share.dart';

const testId =
    'ks123456789012345678'; // Test-only placeholder, never production.
SocialShareContent card({Uint8List? png}) => SocialShareContent(
    title: 'AI',
    text: '公开摘要',
    link: Uri.parse('https://openelfai.com/e/?id=test'),
    png: png ?? Uint8List.fromList([137, 80, 78, 71, 13, 10, 26, 10]));
void main() {
  final binding = TestWidgetsFlutterBinding.ensureInitialized();
  final calls = <MethodCall>[];
  var status = 'ready';
  var outcome = 'handedOff';
  setUp(() {
    calls.clear();
    status = 'ready';
    outcome = 'handedOff';
    binding.defaultBinaryMessenger
        .setMockMethodCallHandler(OpenElfKwaiShare.channel, (call) async {
      calls.add(call);
      return call.method == 'availability' ? status : outcome;
    });
  });
  tearDown(() {
    debugDefaultTargetPlatformOverride = null;
    binding.defaultBinaryMessenger
        .setMockMethodCallHandler(OpenElfKwaiShare.channel, null);
  });
  test('待审核AppID留空，不探测或初始化SDK', () async {
    expect(KwaiShareConfig.appId, isEmpty);
    expect(
        SocialShareConfig.build.publicAppIds[SocialChannel.kuaishou], isEmpty);
    expect(await const KwaiShareAdapter().availability(),
        ShareAvailability.notConfigured);
    await expectLater(const KwaiShareAdapter().share(card()), throwsStateError);
    expect(calls, isEmpty);
  });
  test('无效ID及iOS关联未部署时不可用', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    expect(await const KwaiShareAdapter(appId: 'bad').availability(),
        ShareAvailability.integrationPending);
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    expect(await const KwaiShareAdapter(appId: testId).availability(),
        ShareAvailability.integrationPending);
    expect(
        await const KwaiShareAdapter(
                appId: testId,
                iosAssociationReady: true,
                universalLink: 'https://other.example/app/')
            .availability(),
        ShareAvailability.integrationPending);
    expect(calls, isEmpty);
  });
  test('安装检查不分享，缺少插件不假装可用', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    const adapter = KwaiShareAdapter(appId: testId);
    status = 'notInstalled';
    expect(await adapter.availability(), ShareAvailability.notInstalled);
    expect(calls.map((c) => c.method), ['availability']);
    binding.defaultBinaryMessenger
        .setMockMethodCallHandler(OpenElfKwaiShare.channel, null);
    expect(await adapter.availability(), ShareAvailability.integrationPending);
  });
  test('仅传本次PNG和公开标识，不传Secret、openID、登录或自动发布参数', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    expect(await const KwaiShareAdapter(appId: testId).share(card()),
        SocialShareOutcome.handedOff);
    final args = calls.last.arguments as Map;
    expect(
        args.keys.toSet(), {'appId', 'universalLink', 'png', 'privacyConsent'});
    expect(args['privacyConsent'], true);
    expect(args['appId'], testId);
  });
  test('取消失败未知不当成功；无效图片不调用SDK', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    const adapter = KwaiShareAdapter(appId: testId);
    for (final item in {
      'cancelled': SocialShareOutcome.cancelled,
      'failed': SocialShareOutcome.failed,
      'unknown': SocialShareOutcome.failed
    }.entries) {
      outcome = item.key;
      expect(await adapter.share(card()), item.value);
    }
    final count = calls.where((c) => c.method == 'shareImage').length;
    for (final bytes in [
      Uint8List(2),
      Uint8List(8),
      Uint8List(8 * 1024 * 1024 + 1)
    ]) {
      await expectLater(adapter.share(card(png: bytes)), throwsArgumentError);
    }
    expect(calls.where((c) => c.method == 'shareImage').length, count);
  });
  testWidgets('iOS分享前说明相册留图，取消无SDK调用', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    bool? accepted;
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: Builder(
                builder: (context) => TextButton(
                    onPressed: () async {
                      accepted = await confirmKwaiShare(context);
                    },
                    child: const Text('打开'))))));
    await tester.tap(find.text('打开'));
    await tester.pumpAndSettle();
    expect(find.textContaining('图片会留在相册'), findsOneWidget);
    await tester.tap(find.text('取消'));
    await tester.pumpAndSettle();
    expect(accepted, false);
    expect(calls, isEmpty);
    debugDefaultTargetPlatformOverride = null;
  });
  test('原生只用图片编辑，缓存权限独立且回调匹配；待填配置不造假', () {
    final android = File(
            'third_party/openelf_kwai_share/android/src/main/java/cn/openelfai/kwai/OpenElfKwaiSharePlugin.java')
        .readAsStringSync();
    expect(android, contains('new SinglePictureEdit.Req()'));
    expect(android, isNot(contains('SinglePicturePublish')));
    expect(android, isNot(contains('KwaiAuthAPI.init')));
    expect(android, contains('setGoToMargetAppNotInstall(false)'));
    expect(android, contains('transaction.equals(response.transaction)'));
    expect(android, contains('session.equals(response.sessionId)'));
    final manifest = File(
            'third_party/openelf_kwai_share/android/src/main/AndroidManifest.xml')
        .readAsStringSync();
    expect(manifest, contains('cn.openelfai.kwai.KwaiShareFileProvider'));
    expect(
        File('third_party/openelf_kwai_share/android/src/main/res/xml/openelf_kwai_paths.xml')
            .readAsStringSync(),
        contains('path="kwai-share/"'));
    final ios = File(
            'third_party/openelf_kwai_share/ios/Classes/OpenElfKwaiSharePlugin.m')
        .readAsStringSync();
    expect(ios, contains('KSShareMediaFeature_PictureEdit'));
    expect(ios, contains('response.state isEqual:self.state'));
    expect(ios, isNot(contains('KSAuthRequest')));
    expect(File('ios/Flutter/KwaiShare.xcconfig').readAsStringSync(),
        matches(RegExp(r'OPENELF_KWAI_APP_ID =\s*$')));
    expect(File('android/gradle.properties').readAsStringSync(),
        matches(RegExp(r'^OPENELF_KWAI_APP_ID=\s*$', multiLine: true)));
  });
}
