import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:openelf/config/iap_config.dart';
import 'package:openelf/models/user.dart';
import 'package:openelf/state/app_state.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  Map<String, dynamic> snapshot(int version, int diamonds,
          {int debt = 0, String mode = 'sandbox'}) =>
      {
        'mode': mode,
        'wallet': {
          'version': version,
          'diamonds': diamonds,
          'totalRecharged': 7,
          'totalSpent': 0,
          'refundDebt': debt
        },
        'commerce': {
          'revision': version,
          'earningsFen': 0,
          'elves': [],
          'primary': [],
          'secondary': [],
          'posts': [],
          'logs': [],
          'modulePrices': <String, int>{}
        },
      };

  test('旧响应不覆盖新余额，环境和账号不混用，退款欠额冻结消费', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    addTearDown(() => debugDefaultTargetPlatformOverride = null);
    final state = AppState.instance..bootstrapSync();
    state.currentUser = User(
        id: 'u_a',
        phone: '',
        nickname: 'test',
        avatarInitial: 't',
        createdAt: DateTime(2026));
    state.applyPaymentResponse('u_a', snapshot(2, 7));
    state.applyPaymentResponse('u_a', snapshot(1, 999));
    state.applyPaymentResponse('u_b', snapshot(3, 999));
    expect(state.wallet.diamonds, 7);
    expect(
        () => state.applyPaymentResponse(
            'u_a', snapshot(3, 999, mode: 'production')),
        throwsStateError);
    state.applyPaymentResponse('u_a', snapshot(3, 0, debt: 5));
    expect(await state.buy('pm_001'), contains('欠额'));
    expect(state.wallet.refundDebt, 5);
    final malformed = snapshot(4, 999)..['commerce'] = {};
    expect(
        () => state.applyPaymentResponse('u_a', malformed), throwsStateError);
    expect(state.wallet.diamonds, 0);
    state.currentUser = null;
  });

  test('沙盒余额只同步给当前用户，不允许通过本地模拟方法充值或消费', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    final state = AppState.instance;
    addTearDown(() {
      state.currentUser = null;
      debugDefaultTargetPlatformOverride = null;
    });
    state.bootstrapSync();
    state.currentUser = User(
        id: 'u_a',
        phone: '',
        nickname: 'test',
        avatarInitial: 't',
        createdAt: DateTime(2026));
    state.applyVerifiedAppleWallet(
        userId: 'u_a', diamonds: 7, totalRecharged: 7);
    expect(state.wallet.diamonds, 7);
    state.applyVerifiedAppleWallet(
        userId: 'u_b', diamonds: 999, totalRecharged: 999);
    expect(state.wallet.diamonds, 7);
    state.recharge(diamonds: 999);
    expect(state.wallet.diamonds, 7);
    expect(await state.buy('anything'), isNotNull);
    expect(await state.tip(elfId: 'anything', amount: 5), isNotNull);
    expect(state.wallet.diamonds, 7);
    expect(state.wallet.totalSpent, 0);
  }, skip: !IapConfig.testBuild);

  test('即使启用了沙盒编译参数，Android 也不会开启苹果支付', () {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    addTearDown(() => debugDefaultTargetPlatformOverride = null);
    expect(IapConfig.enabled, false);
  });
}
