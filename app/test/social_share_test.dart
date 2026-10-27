import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:openelf/models/elf.dart';
import 'package:openelf/sharing/social_share.dart';
import 'package:openelf/widgets/share_card.dart';
import 'package:openelf/widgets/social_share_sheet.dart';

class FakeAdapter implements SocialShareAdapter {
  @override
  final SocialChannel channel;
  ShareAvailability status = ShareAvailability.ready;
  SocialShareOutcome outcome = SocialShareOutcome.handedOff;
  bool throws = false;
  int calls = 0;
  FakeAdapter(this.channel);
  @override
  Future<ShareAvailability> availability() async => status;
  @override
  Future<SocialShareOutcome> share(SocialShareContent content) async {
    calls++;
    if (throws) throw StateError('SDK error');
    return outcome;
  }
}

SocialShareContent content({String url = 'https://openelfai.com/e/?id=demo'}) =>
    SocialShareContent(
        title: 'AI',
        text: '内容由 AI 生成',
        link: Uri.parse(url),
        png: Uint8List.fromList([1, 2, 3]));

void main() {
  test('四渠道名称与路由一一对应，不伪造平台能力', () {
    expect(
        SocialChannel.values.map((v) => v.label), ['哔哩哔哩', '小红书', '抖音', '微信']);
    for (final action in ShareAction.values.where((a) => a.channel != null)) {
      expect(action.channel!.name, action.name);
    }
    expect(ShareAction.system.channel, isNull);
    expect(ShareAction.copyLink.channel, isNull);
  });

  test('无凭证全部未配置，即使传入SDK适配器也不调用', () async {
    for (final channel in SocialChannel.values) {
      final adapter = FakeAdapter(channel);
      final service = SocialShareService(
          config: const SocialShareConfig(), adapters: {channel: adapter});
      expect(
          await service.availability(channel), ShareAvailability.notConfigured);
      await expectLater(service.share(channel, content()), throwsStateError);
      expect(adapter.calls, 0);
    }
  });

  test('仅填写公开ID仍为待接入，不意味着官方SDK已经就绪', () async {
    for (final channel in SocialChannel.values) {
      final service = SocialShareService(
          config: SocialShareConfig(publicAppIds: {channel: 'public-id'}));
      expect(await service.availability(channel),
          ShareAvailability.integrationPending);
      await expectLater(service.share(channel, content()), throwsStateError);
    }
  });

  test('不同平台独立分派，不将交接等同发布成功', () async {
    final adapters = {for (final c in SocialChannel.values) c: FakeAdapter(c)};
    final service = SocialShareService(
        config: SocialShareConfig(publicAppIds: {
          for (final c in SocialChannel.values) c: 'public-id'
        }),
        adapters: adapters);
    for (final channel in SocialChannel.values) {
      expect(await service.share(channel, content()),
          SocialShareOutcome.handedOff);
      expect(adapters[channel]!.calls, 1);
    }
  });

  test('适配器取消或失败不返回成功；外站素材不交给SDK', () async {
    final adapter = FakeAdapter(SocialChannel.wechat);
    final service = SocialShareService(
        config: const SocialShareConfig(
            publicAppIds: {SocialChannel.wechat: 'wx-id'}),
        adapters: {SocialChannel.wechat: adapter});
    adapter.outcome = SocialShareOutcome.cancelled;
    expect(await service.share(SocialChannel.wechat, content()),
        SocialShareOutcome.cancelled);
    adapter.throws = true;
    expect(await service.share(SocialChannel.wechat, content()),
        SocialShareOutcome.failed);
    await expectLater(
        service.share(
            SocialChannel.wechat, content(url: 'https://other.example/')),
        throwsArgumentError);
    expect(adapter.calls, 2);
  });

  test('渠道不能错配，避免发往错误平台', () {
    expect(
        () => SocialShareService(adapters: {
              SocialChannel.wechat: FakeAdapter(SocialChannel.douyin)
            }),
        throwsArgumentError);
  });

  testWidgets('渠道面板展示四平台和系统/复制选项，未配置有明确提示', (tester) async {
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: SocialShareSheet(
                service:
                    SocialShareService(config: const SocialShareConfig())))));
    await tester.pumpAndSettle();
    for (final channel in SocialChannel.values) {
      expect(find.text(channel.label), findsOneWidget);
    }
    expect(find.text('未配置'), findsNWidgets(4));
    expect(find.text('更多分享'), findsOneWidget);
    expect(find.text('生成分享图'), findsOneWidget);
    expect(find.text('复制链接'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('未配置渠道需用户确认才可复制，不自动上传；取消后可再次分享', (tester) async {
    final elf = Elf(
        id: 'demo',
        serial: '#001',
        name: '演示AI',
        initial: '演',
        ownerId: 'owner',
        ownerLabel: '演示',
        isMine: false,
        generation: 1,
        edition: '初版',
        persona: '人设',
        fear: '',
        habit: '',
        status: ElfStatus.active,
        followers: 0,
        echo: 0,
        works: 0,
        attention: 0,
        baseCapacity: 2,
        learnedSkills: [],
        today: [],
        relations: []);
    final copies = <String>[];
    // This test verifies fallback UI, independently of production AppID and
    // the device's installed apps. Never send real SDK calls from widget tests.
    const wechatChannel = MethodChannel('openelf/wechat_share');
    tester.binding.defaultBinaryMessenger
        .setMockMethodCallHandler(wechatChannel, (_) async => 'notInstalled');
    addTearDown(() => tester.binding.defaultBinaryMessenger
        .setMockMethodCallHandler(wechatChannel, null));
    tester.binding.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, (call) async {
      if (call.method == 'Clipboard.setData') {
        copies.add((call.arguments as Map)['text'] as String);
      }
      return null;
    });
    addTearDown(() => tester.binding.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, null));
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: Builder(
                builder: (context) => TextButton(
                    onPressed: () => ShareHelper.shareElf(context, elf),
                    child: const Text('分享'))))));
    await tester.tap(find.text('分享'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('share-wechat')));
    await tester.pumpAndSettle();
    expect(find.text('微信暂不可用'), findsOneWidget);
    expect(copies, isEmpty);
    await tester.tap(find.text('取消'));
    await tester.pumpAndSettle();
    expect(copies, isEmpty);
    await tester.tap(find.text('分享'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('share-bilibili')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('复制链接'));
    await tester.pumpAndSettle();
    expect(copies, [shareLinkFor(elf)]);
    expect(find.text('链接已复制，请自行选择应用发送'), findsOneWidget);
    expect(tester.takeException(), isNull);

    await tester.tap(find.text('分享'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('生成分享图'));
    await tester.pumpAndSettle();
    await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 100)));
    await tester.pumpAndSettle();
    expect(find.text('分享图预览'), findsOneWidget);
    expect(find.byType(Image), findsOneWidget);
    await tester.tap(find.text('关闭'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);

    await tester.pumpWidget(MaterialApp(
        home: Scaffold(body: ShareCard(elf: elf, promotional: false))));
    expect(find.text('内容由 AI 生成'), findsOneWidget);
    expect(find.text('OpenElf'), findsNothing);
    expect(find.text(sharePathFor(elf)), findsNothing);
  });
}
