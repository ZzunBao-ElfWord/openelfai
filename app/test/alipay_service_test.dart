import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:openelf/payments/alipay_service.dart';
import 'package:openelf/config/commerce_config.dart';
import 'package:openelf/config/iap_config.dart';
import 'package:openelf/state/app_state.dart';
import 'package:openelf/models/user.dart';
import 'package:flutter/foundation.dart';
import 'package:openelf/persistence/data_repository.dart';

const orderId = 'OE1234567890abcdef1234567890abcdef';

class Fixture {
  String? user = 'u_test';
  String mode = 'production';
  String status = 'pending';
  bool enabled = true;
  bool created = false;
  bool payConfirms = false;
  bool queryFails = false;
  bool switchAfterCreate = false;
  int creates = 0;
  int nativeCalls = 0;
  final applied = <int>[];
  Map<String, dynamic> wallet() => {
        'mode': mode,
        'wallet': {'diamonds': status == 'paid' ? 60 : 0}
      };
  late final service = AlipayService(
      enabled: true,
      currentUser: () => user,
      applyResponse: (user, value) =>
          applied.add(value['wallet']['diamonds'] as int),
      pollDelay: () async {},
      nativePay: (_, sandbox) async {
        nativeCalls++;
        if (payConfirms) status = 'paid';
        return {'resultStatus': '9000'};
      },
      request: (path, {body}) async {
        if (path.endsWith('/products'))
          return {
            'protocol': 2,
            'mode': mode,
            'products': enabled
                ? [
                    {'id': 'diamonds60', 'priceFen': 600, 'diamonds': 60}
                  ]
                : []
          };
        if (path.contains('/wallet')) return wallet();
        if (path.endsWith('/pending'))
          return {
            'mode': mode,
            'orders': created && status == 'pending'
                ? [
                    {'id': orderId, 'tierId': 'diamonds60'}
                  ]
                : []
          };
        if (path.endsWith('/orders') || path.endsWith('/pay')) {
          created = true;
          creates++;
          if (switchAfterCreate) user = 'other';
          return {
            'mode': mode,
            'id': orderId,
            'tierId': 'diamonds60',
            'status': status,
            'orderString': 'signed-test-order'
          };
        }
        if (queryFails) throw StateError('network unavailable');
        return {
          ...wallet(),
          'order': {'id': orderId, 'status': status}
        };
      });
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => SharedPreferences.setMockInitialValues({}));
  test('服务端自动运营时间戳可以解析为客户端时间', () {
    final elf = DataRepository.instance.decodePaymentElf({
      'id': 'e_test',
      'serial': '#test',
      'name': 'test',
      'initial': 't',
      'ownerId': 'u_test',
      'ownerLabel': 'test',
      'isMine': true,
      'generation': 1,
      'edition': '初版',
      'persona': '',
      'fear': '',
      'habit': '',
      'energy': 160,
      'maxEnergy': 320,
      'followers': 0,
      'echo': 0,
      'works': 0,
      'attention': 0,
      'slots': 4,
      'equipped': ['sharp', 'rhythm', 'auto'],
      'today': <String>[],
      'relations': [],
      'nextAutoPostAt': 1800000000000,
    });
    expect(elf.nextAutoPostAt!.millisecondsSinceEpoch, 1800000000000);
  });
  test('SDK返回9000不直接发钻，服务端仍待支付就保留订单', () async {
    final f = Fixture();
    await f.service.initialize();
    await f.service.pay('diamonds60');
    expect(f.nativeCalls, 1);
    expect(f.applied.every((n) => n == 0), true);
    expect(f.service.hasPending, true);
    expect(f.creates, 1);
  });
  test('服务端确认后替换余额，清理待支付记录', () async {
    final f = Fixture()..payConfirms = true;
    await f.service.initialize();
    await f.service.pay('diamonds60');
    expect(f.applied.last, 60);
    expect(f.service.hasPending, false);
  });
  test('查询失败保留订单，重启恢复并继续核对，不重复创建', () async {
    final f = Fixture()..queryFails = true;
    await f.service.initialize();
    await f.service.pay('diamonds60');
    expect(f.service.hasPending, true);
    final restored = Fixture()
      ..created = true
      ..status = 'paid';
    await restored.service.initialize();
    expect(restored.applied.last, 60);
    expect(restored.creates, 0);
    expect(restored.service.hasPending, false);
  });
  test('无本地记录时找回服务端待支付订单，不自动唤起SDK', () async {
    final f = Fixture()..created = true;
    await f.service.initialize();
    expect(f.service.pendingId, orderId);
    expect(f.nativeCalls, 0);
    expect(f.creates, 0);
  });
  test('商户资料占位时不展示充值商品，但仍刷新服务端钱包', () async {
    final f = Fixture()..enabled = false;
    await f.service.initialize();
    expect(f.service.products, isEmpty);
    expect(f.applied, [0]);
    expect(f.nativeCalls, 0);
    await expectLater(f.service.pay('diamonds60'), throwsStateError);
  });
  test('服务器模式不匹配时关闭入口', () async {
    final f = Fixture()..mode = 'sandbox';
    await f.service.initialize();
    expect(f.service.products, isEmpty);
    expect(f.applied, isEmpty);
  });
  test('下单过程中换账号不能唤起旧账号付款或覆盖余额', () async {
    final f = Fixture()..switchAfterCreate = true;
    await f.service.initialize();
    await f.service.pay('diamonds60');
    expect(f.nativeCalls, 0);
    expect(f.applied, [0]);
  });
  test('安卓只能用服务端消费，不能本地充值和免费获得能力；不会开启Apple内购', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    addTearDown(() => debugDefaultTargetPlatformOverride = null);
    final state = AppState.instance..bootstrapSync();
    state.currentUser = User(
        id: 'u_test',
        phone: '',
        nickname: 't',
        avatarInitial: 't',
        createdAt: DateTime(2026));
    expect(CommerceConfig.enabled, true);
    expect(IapConfig.enabled, false);
    expect(CommerceConfig.walletPath, '/api/v1/android/wallet');
    state.recharge(diamonds: 999);
    expect(state.wallet.diamonds, 0);
    expect(state.ownsModule('video'), false);
    expect(await state.equip('video', state.myElf!.id), contains('服务端权益'));
    expect(await state.buyModule('video', state.myElf!.id), contains('服务端权益'));
    expect(await state.purchaseModule('video'), contains('服务端权益'));
    expect(state.ownedModules.contains('video'), false);
    expect(await state.inject(state.myElf!.id, 1), contains('服务端权益'));
    expect(state.wallet.diamonds, 0);
    state.currentUser = null;
  });
}
