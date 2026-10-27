import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:openelf/sharing/douyin_share_adapter.dart';
import 'package:openelf/sharing/social_share.dart';
import 'package:openelf/widgets/social_share_sheet.dart';
import 'package:openelf_douyin_share/openelf_douyin_share.dart';

void main() {
  final binding = TestWidgetsFlutterBinding.ensureInitialized();
  final calls = <MethodCall>[];
  var nativeStatus = 'ready';
  var nativeOutcome = 'handedOff';
  setUp(() {
    calls.clear();
    nativeStatus = 'ready';
    nativeOutcome = 'handedOff';
    binding.defaultBinaryMessenger
        .setMockMethodCallHandler(OpenElfDouyinShare.channel, (call) async {
      calls.add(call);
      return call.method == 'availability' ? nativeStatus : nativeOutcome;
    });
  });
  tearDown(() {
    debugDefaultTargetPlatformOverride = null;
    binding.defaultBinaryMessenger
        .setMockMethodCallHandler(OpenElfDouyinShare.channel, null);
  });

  test('确认的Client Key正确，状态探测不会初始化分享', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    expect(OpenElfDouyinShare.clientKey, 'awf8w18qtnqq1kum');
    expect(SocialShareConfig.build.publicAppIds[SocialChannel.douyin],
        OpenElfDouyinShare.clientKey);
    expect(await DouyinShareAdapter().availability(), ShareAvailability.ready);
    expect(calls.map((c) => c.method), ['availability']);
    nativeStatus = 'notInstalled';
    expect(await DouyinShareAdapter().availability(),
        ShareAvailability.notInstalled);
  });

  test('插件缺失时明确不可用，不伪造已接通', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    binding.defaultBinaryMessenger
        .setMockMethodCallHandler(OpenElfDouyinShare.channel, null);
    expect(await DouyinShareAdapter().availability(),
        ShareAvailability.integrationPending);
  });

  test('日常与私信走不同参数，明确携带同意且不传账号密钥', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    final adapter = DouyinShareAdapter();
    for (final scene in DouyinShareScene.values) {
      final payload = SocialShareContent(
          title: 'AI',
          text: '内容由 AI 生成',
          link: Uri.parse('https://openelfai.com/e/?id=demo'),
          png: Uint8List.fromList([137, 80, 78, 71, 13, 10, 26, 10]),
          douyinScene: scene);
      expect(await adapter.share(payload), SocialShareOutcome.handedOff);
      final args = calls.last.arguments as Map;
      expect(args['scene'], scene.name);
      expect(args['privacyConsent'], true);
      expect(args['clientKey'], OpenElfDouyinShare.clientKey);
      expect(
          args.keys.toSet(), {'png', 'scene', 'privacyConsent', 'clientKey'});
    }
  });

  test('原生取消、失败、未知结果均不当成分享成功', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    final adapter = DouyinShareAdapter();
    final payload = SocialShareContent(
        title: 'AI',
        text: 'AI',
        link: Uri.parse('https://openelfai.com/e/'),
        png: Uint8List(8));
    for (final entry in {
      'cancelled': SocialShareOutcome.cancelled,
      'failed': SocialShareOutcome.failed,
      'unknown': SocialShareOutcome.failed
    }.entries) {
      nativeOutcome = entry.key;
      expect(await adapter.share(payload), entry.value);
    }
  });

  testWidgets('iOS同意页明确保存相册，取消不触发SDK', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    DouyinShareScene? selected;
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: Builder(
                builder: (context) => TextButton(
                    onPressed: () async {
                      selected = await confirmDouyinShare(context);
                    },
                    child: const Text('打开分享'))))));
    await tester.tap(find.text('打开分享'));
    await tester.pumpAndSettle();
    expect(find.textContaining('保存到系统相册'), findsOneWidget);
    await tester.tap(find.text('取消'));
    await tester.pumpAndSettle();
    expect(selected, isNull);
    expect(calls, isEmpty);
    await tester.tap(find.text('打开分享'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('日常'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('同意并继续'));
    await tester.pumpAndSettle();
    expect(selected, DouyinShareScene.story);
    expect(calls, isEmpty);
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('普通分享底部面板在窄屏无溢出，不展示虚构好友', (tester) async {
    tester.view.physicalSize = const Size(320, 600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: SocialShareSheet(
                service:
                    SocialShareService(config: const SocialShareConfig())))));
    await tester.pumpAndSettle();
    expect(find.text('分享至'), findsOneWidget);
    expect(find.text('复制链接'), findsOneWidget);
    expect(find.text('生成分享图'), findsOneWidget);
    expect(find.textContaining('已绑定'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  test('原生SDK配置与安全边界保留，不移动舞台或修改支付', () {
    final plugin = File(
            'third_party/openelf_douyin_share/android/src/main/java/cn/openelfai/sharing/OpenElfDouyinSharePlugin.java')
        .readAsStringSync();
    expect(plugin, contains('.autoStartTracker(false)'));
    expect(plugin, contains('request.shareToType = 1'));
    expect(plugin, contains('api.shareToContacts(request)'));
    expect(plugin, contains('instance.state.equals(responseState)'));
    final manifest = File(
            'third_party/openelf_douyin_share/android/src/main/res/xml/openelf_douyin_paths.xml')
        .readAsStringSync();
    expect(manifest, contains('path="douyin-share/"'));
    expect(manifest, isNot(contains('root-path')));
    final ios = File(
            'third_party/openelf_douyin_share/ios/Classes/OpenElfDouyinSharePlugin.m')
        .readAsStringSync();
    expect(ios, contains('requestAuthorizationForAccessLevel'));
    expect(ios, contains('response.state isEqual:state'));
    expect(ios, contains('request.publishStory = YES'));
    final settings = File('lib/pages/settings_page.dart').readAsStringSync();
    expect(settings, isNot(contains('SocialShareSheet')));
    expect(settings, isNot(contains('DouyinShareAdapter')));
  });
}
