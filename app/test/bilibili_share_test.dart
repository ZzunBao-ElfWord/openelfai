import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:openelf/sharing/bilibili_share_adapter.dart';
import 'package:openelf/sharing/social_share.dart';

class FakeBilibiliGateway implements BilibiliShareGateway {
  var probes = 0;
  var sends = 0;
  var throws = false;
  var status = ShareAvailability.ready;
  var outcome = SocialShareOutcome.handedOff;
  String? receivedId;
  BilibiliShareMaterial? received;
  @override
  Future<ShareAvailability> availability(String clientId) async {
    probes++;
    if (throws) throw StateError('unavailable');
    return status;
  }

  @override
  Future<SocialShareOutcome> share(
      String clientId, BilibiliShareMaterial material) async {
    sends++;
    receivedId = clientId;
    received = material;
    if (throws) throw StateError('failed');
    return outcome;
  }
}

SocialShareContent material(
        {String link = 'https://openelfai.com/e/?id=demo',
        Uint8List? png,
        String title = ' 演示AI '}) =>
    SocialShareContent(
        title: title,
        text: ' 所选公开摘要 ',
        link: Uri.parse(link),
        png: png ?? Uint8List.fromList([137, 80, 78, 71, 13, 10, 26, 10]));

void main() {
  test('没有Client ID不探测或发送；只有ID仍待接入', () async {
    final gateway = FakeBilibiliGateway();
    final missing = BilibiliShareAdapter(clientId: ' ', gateway: gateway);
    expect(await missing.availability(), ShareAvailability.notConfigured);
    await expectLater(missing.share(material()), throwsStateError);
    expect(gateway.probes, 0);
    expect(gateway.sends, 0);
    final pending = BilibiliShareAdapter(clientId: 'future-public-id');
    expect(await pending.availability(), ShareAvailability.integrationPending);
    await expectLater(pending.share(material()), throwsStateError);
  });

  test('仅准备当前卡片摘要，素材字节独立只读，不传抖音场景', () async {
    final gateway = FakeBilibiliGateway();
    final adapter =
        BilibiliShareAdapter(clientId: ' public-id ', gateway: gateway);
    final content = material();
    expect(await adapter.share(content), SocialShareOutcome.handedOff);
    expect(gateway.receivedId, 'public-id');
    expect(gateway.received!.title, '演示AI');
    expect(gateway.received!.summary, '所选公开摘要');
    expect(gateway.received!.sourceLink, content.link);
    content.png[0] = 0;
    expect(gateway.received!.png.first, 137);
    expect(() => gateway.received!.png[0] = 0, throwsUnsupportedError);
  });

  test('非法素材不交给分享网关', () async {
    final gateway = FakeBilibiliGateway();
    final adapter =
        BilibiliShareAdapter(clientId: 'public-id', gateway: gateway);
    for (final invalid in [
      material(link: 'http://openelfai.com/e/'),
      material(link: 'https://external.example/'),
      material(link: 'https://user:password@openelfai.com/e/'),
      material(link: 'https://openelfai.com:8443/e/'),
      material(title: ' '),
      material(png: Uint8List(8)),
      material(png: Uint8List(8 * 1024 * 1024 + 1)),
    ]) {
      await expectLater(adapter.share(invalid), throwsArgumentError);
    }
    expect(gateway.sends, 0);
  });

  test('取消失败不伪造成功，未安装不发送', () async {
    final gateway = FakeBilibiliGateway();
    final adapter =
        BilibiliShareAdapter(clientId: 'public-id', gateway: gateway);
    for (final outcome in [
      SocialShareOutcome.cancelled,
      SocialShareOutcome.failed
    ]) {
      gateway.outcome = outcome;
      expect(await adapter.share(material()), outcome);
    }
    gateway.status = ShareAvailability.notInstalled;
    await expectLater(adapter.share(material()), throwsStateError);
    expect(gateway.sends, 2);
    gateway.throws = true;
    expect(await adapter.availability(), ShareAvailability.integrationPending);
  });

  test('注册进普通分享服务仍受配置保护，不影响抖音', () async {
    final gateway = FakeBilibiliGateway();
    final service = SocialShareService(
        config: const SocialShareConfig(
            publicAppIds: {SocialChannel.bilibili: 'public-id'}),
        adapters: {
          SocialChannel.bilibili:
              BilibiliShareAdapter(clientId: 'public-id', gateway: gateway)
        });
    expect(await service.availability(SocialChannel.douyin),
        ShareAvailability.notConfigured);
    expect(await service.share(SocialChannel.bilibili, material()),
        SocialShareOutcome.handedOff);
    expect(gateway.sends, 1);
  });
}
