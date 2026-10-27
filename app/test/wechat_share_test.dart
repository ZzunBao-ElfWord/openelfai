import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:openelf/sharing/social_share.dart';
import 'package:openelf/sharing/wechat_share_config.dart';
import 'package:openelf/sharing/wechat_share_adapter.dart';
import 'package:openelf/widgets/social_share_sheet.dart';
import 'package:openelf_wechat_share/openelf_wechat_share.dart';

const testAppId = 'wx0123456789abcdef'; // Test-only, never a real registration.
SocialShareContent card(
        {WechatShareScene scene = WechatShareScene.session, Uint8List? png}) =>
    SocialShareContent(
        title: 'AI',
        text: '公开摘要',
        link: Uri.parse('https://openelfai.com/e/?id=test'),
        png: png ?? Uint8List.fromList([137, 80, 78, 71, 13, 10, 26, 10]),
        wechatScene: scene);

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
        .setMockMethodCallHandler(OpenElfWechatShare.channel, (call) async {
      calls.add(call);
      return call.method == 'availability' ? status : outcome;
    });
  });
  tearDown(() {
    debugDefaultTargetPlatformOverride = null;
    binding.defaultBinaryMessenger
        .setMockMethodCallHandler(OpenElfWechatShare.channel, null);
  });
  test('空AppID不探测或初始化SDK，未使用身份未确认的公众号ID', () async {
    expect(WechatShareConfig.appId, isEmpty);
    expect(SocialShareConfig.build.publicAppIds[SocialChannel.wechat], isEmpty);
    expect(await const WechatShareAdapter().availability(),
        ShareAvailability.notConfigured);
    await expectLater(
        const WechatShareAdapter().share(card()), throwsStateError);
    expect(calls, isEmpty);
  });
  test('非法AppID与未配置iOS关联时不可用', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    expect(
        await const WechatShareAdapter(appId: 'not-an-app-id').availability(),
        ShareAvailability.integrationPending);
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    expect(await const WechatShareAdapter(appId: testAppId).availability(),
        ShareAvailability.integrationPending);
    expect(
        await const WechatShareAdapter(
                appId: testAppId,
                iosAssociationReady: true,
                universalLink: 'https://other.example/app/')
            .availability(),
        ShareAvailability.integrationPending);
    expect(calls, isEmpty);
  });
  test('仅检查安装和配置，不触发分享；插件缺失不假装可用', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    const adapter = WechatShareAdapter(appId: testAppId);
    status = 'notInstalled';
    expect(await adapter.availability(), ShareAvailability.notInstalled);
    expect(calls.map((c) => c.method), ['availability']);
    binding.defaultBinaryMessenger
        .setMockMethodCallHandler(OpenElfWechatShare.channel, null);
    expect(await adapter.availability(), ShareAvailability.integrationPending);
  });
  test('好友和朋友圈独立分派，不传Secret、账号或抖音场景', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    const adapter = WechatShareAdapter(appId: testAppId);
    for (final scene in WechatShareScene.values) {
      expect(await adapter.share(card(scene: scene)),
          SocialShareOutcome.handedOff);
      final args = calls.last.arguments as Map;
      expect(args['scene'], scene.name);
      expect(args['privacyConsent'], true);
      expect(args.keys.toSet(),
          {'appId', 'universalLink', 'png', 'scene', 'privacyConsent'});
      expect(args['appId'], testAppId);
    }
  });
  test('取消、失败、未知结果不当成功，非法PNG不发送', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    const adapter = WechatShareAdapter(appId: testAppId);
    for (final item in {
      'cancelled': SocialShareOutcome.cancelled,
      'failed': SocialShareOutcome.failed,
      'unknown': SocialShareOutcome.failed
    }.entries) {
      outcome = item.key;
      expect(await adapter.share(card()), item.value);
    }
    final count = calls.where((c) => c.method == 'shareImage').length;
    await expectLater(
        adapter.share(card(png: Uint8List(8))), throwsArgumentError);
    await expectLater(adapter.share(card(png: Uint8List(8 * 1024 * 1024 + 1))),
        throwsArgumentError);
    expect(calls.where((c) => c.method == 'shareImage').length, count);
  });
  testWidgets('微信确认页可取消且不调用SDK，可选择朋友圈', (tester) async {
    WechatShareScene? selected;
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: Builder(
                builder: (context) => TextButton(
                    onPressed: () async {
                      selected = await confirmWechatShare(context);
                    },
                    child: const Text('打开'))))));
    await tester.tap(find.text('打开'));
    await tester.pumpAndSettle();
    expect(find.textContaining('不申请相册权限'), findsOneWidget);
    await tester.tap(find.text('取消'));
    await tester.pumpAndSettle();
    expect(selected, isNull);
    expect(calls, isEmpty);
    await tester.tap(find.text('打开'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('朋友圈'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('同意并继续'));
    await tester.pumpAndSettle();
    expect(selected, WechatShareScene.timeline);
    expect(calls, isEmpty);
  });
  test('原生配置只分享，签名校验、请求匹配、回跳与原推送保留', () {
    final android = File(
            'third_party/openelf_wechat_share/android/src/main/java/cn/openelfai/wechat/OpenElfWechatSharePlugin.java')
        .readAsStringSync();
    expect(android, contains('createWXAPI(context, appId, true)'));
    expect(
        android, contains('instance.transaction.equals(response.transaction)'));
    expect(android, contains('WXSceneTimeline'));
    expect(android, isNot(contains('PayReq')));
    expect(android, isNot(contains('SendAuthReq')));
    final ios = File(
            'third_party/openelf_wechat_share/ios/Classes/OpenElfWechatSharePlugin.m')
        .readAsStringSync();
    expect(ios, contains('handleOpenUniversalLink'));
    expect(ios, contains('SendMessageToWXResp.class'));
    expect(ios, isNot(contains('PHPhotoLibrary')));
    expect(ios, isNot(contains('PayReq')));
    final entitlements =
        File('ios/Runner/Runner.entitlements').readAsStringSync();
    expect(entitlements, contains('aps-environment'));
    expect(entitlements, contains('applinks:openelfai.com'));
    final scene = File('ios/Runner/SceneDelegate.swift').readAsStringSync();
    expect(scene, contains('OpenElfDouyinSharePlugin.handleOpenURL'));
    expect(scene, contains('OpenElfWechatSharePlugin.handleUniversalLink'));
  });
}
