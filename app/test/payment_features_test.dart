import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:openelf/config/payment_features.dart';
import 'package:openelf/config/iap_config.dart';
import 'package:openelf/services/platform_api.dart';

void main() {
  tearDown(() => debugDefaultTargetPlatformOverride = null);

  test('只关闭原生iOS的API余额充值，不关闭Web或安卓', () {
    expect(
        PaymentFeatures.apiTopupFor(web: false, platform: TargetPlatform.iOS),
        false);
    expect(PaymentFeatures.apiTopupFor(web: true, platform: TargetPlatform.iOS),
        true);
    expect(
        PaymentFeatures.apiTopupFor(
            web: false, platform: TargetPlatform.android),
        true);
  });

  test('iOS仍启用StoreKit钻石，API充值在网络请求前阻止', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    expect(IapConfig.enabled, true);
    expect(PaymentFeatures.apiTopupEnabled, false);
    final blocked = isA<PlatformApiException>()
        .having((e) => e.code, 'code', 'API_TOPUP_DISABLED');
    await expectLater(PlatformApi.instance.topupProducts(), throwsA(blocked));
    await expectLater(
        PlatformApi.instance
            .createTopupOrder(tierId: 'topup10', requestId: 'test'),
        throwsA(blocked));
    await expectLater(
        PlatformApi.instance.payTopupOrder('old-order'), throwsA(blocked));
  });

  test('页面入口与聊天提示受平台开关约束，原钻石面板保留', () {
    final page = File('lib/pages/api_key_page.dart').readAsStringSync();
    expect(page, contains('if (PaymentFeatures.apiTopupEnabled) ...['));
    expect(page, contains('if (!PaymentFeatures.apiTopupEnabled) return;'));
    expect(File('lib/pages/wallet_page.dart').readAsStringSync(),
        contains('const IosRechargePanel()'));
    expect(File('lib/pages/elf_chat_page.dart').readAsStringSync(),
        contains("'查看 API 账户'"));
  });
}
