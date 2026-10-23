import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:in_app_purchase/in_app_purchase.dart';
import 'package:in_app_purchase_storekit/in_app_purchase_storekit.dart';
import 'package:openelf/payments/ios_iap_service.dart';

const sku = 'com.ai.openelf.gems7';
const account = '12345678-90ab-cdef-1234-567890abcdef';

class FakeStore implements IapStore {
  final events = StreamController<List<PurchaseDetails>>.broadcast(sync: true);
  final completed = <String?>[];
  PurchaseParam? lastPurchase;

  @override
  Stream<List<PurchaseDetails>> get purchaseStream => events.stream;
  @override
  Future<bool> isAvailable() async => true;
  @override
  Future<ProductDetailsResponse> queryProductDetails(Set<String> ids) async =>
      ProductDetailsResponse(productDetails: [
        ProductDetails(
          id: sku,
          title: '7钻石',
          description: '7钻石',
          price: '¥1.00',
          rawPrice: 1,
          currencyCode: 'CNY',
        )
      ], notFoundIDs: []);
  @override
  Future<bool> buyConsumable({required PurchaseParam purchaseParam}) async {
    lastPurchase = purchaseParam;
    return true;
  }

  @override
  Future<void> completePurchase(PurchaseDetails purchase) async {
    completed.add(purchase.purchaseID);
  }

  PurchaseDetails purchase(
          {PurchaseStatus status = PurchaseStatus.purchased}) =>
      PurchaseDetails(
        productID: sku,
        purchaseID: '2000000001234567',
        transactionDate: '1',
        status: status,
        verificationData: PurchaseVerificationData(
            localVerificationData: '',
            serverVerificationData: '',
            source: 'app_store'),
      )..pendingCompletePurchase = true;
}

class Fixture {
  final store = FakeStore();
  String? userId = 'u_1234567890abcdef1234567890abcdef';
  String mode = 'sandbox';
  String nativeEnvironment = 'Sandbox';
  int protocol = 2;
  String orderStatus = 'credited';
  int balance = 0;
  int verifyCalls = 0;
  bool failVerify = false;
  bool malformedWallet = false;
  Completer<void>? verificationGate;
  final applied = <int>[];
  late final service = IosIapService.testing(
    store: store,
    currentUserId: () => userId,
    environment: () async => nativeEnvironment,
    applyWallet: (user, diamonds, total) => applied.add(diamonds),
    request: (path, {body}) async {
      if (path.contains('/products?')) {
        return {
          'protocol': protocol,
          'mode': mode,
          'appAccountToken': account,
          'products': [
            {'id': sku, 'diamonds': 7}
          ]
        };
      }
      if (path.endsWith('/verify')) {
        verifyCalls++;
        if (failVerify) throw StateError('network unavailable');
        await verificationGate?.future;
        balance = 7;
      }
      return {
        'mode': mode,
        'orderStatus': orderStatus,
        'wallet': malformedWallet
            ? {'diamonds': 'invalid'}
            : {'diamonds': balance, 'totalRecharged': balance}
      };
    },
  );

  Future<void> close() async {
    service.dispose();
    await store.events.close();
  }
}

void main() {
  test('正式包使用正式钱包，沙盒包仍使用沙盒钱包', () async {
    final f = Fixture()
      ..nativeEnvironment = 'Production'
      ..mode = 'production';
    addTearDown(f.close);
    await f.service.initialize();
    expect(f.service.products, isNotEmpty);
    expect(f.service.isSandbox, false);
    f.store.events.add([f.store.purchase()]);
    await f.service.processingDone;
    expect(f.applied.last, 7);
  });
  test('旧协议服务器不展示购买入口，避免使用不支持退款的客户端协议', () async {
    final f = Fixture()..protocol = 1;
    addTearDown(f.close);
    await f.service.initialize();
    expect(f.service.products, isEmpty);
  });
  test('已退款订单同步服务端余额并结束交易，不在本地发钻', () async {
    final f = Fixture()..orderStatus = 'refunded';
    addTearDown(f.close);
    await f.service.initialize();
    f.store.events.add([f.store.purchase()]);
    await f.service.processingDone;
    expect(f.service.error, contains('退款'));
    expect(f.store.completed.length, 1);
  });
  test('购买绑定 OpenElf 账号，显示服务器数量与 App Store 价格', () async {
    final f = Fixture();
    addTearDown(f.close);
    await f.service.initialize();
    expect(f.service.diamondsFor(sku), 7);
    expect(f.service.products.single.price, '¥1.00');
    await f.service.buy(sku);
    expect(f.store.lastPurchase, isA<Sk2PurchaseParam>());
    expect(f.store.lastPurchase!.applicationUserName, account);
  });

  test('重复成功回调替换余额，不在本地叠加钻石', () async {
    final f = Fixture();
    addTearDown(f.close);
    await f.service.initialize();
    f.store.events.add([f.store.purchase(), f.store.purchase()]);
    await f.service.processingDone;
    expect(f.verifyCalls, 2);
    expect(f.applied, [0, 7, 7]);
    expect(f.service.hasUnconfirmed, false);
    expect(f.store.completed.length, 2);
  });

  test('验单失败保留订单、阻止重复购买，重试成功后才完成交易', () async {
    final f = Fixture();
    addTearDown(f.close);
    await f.service.initialize();
    f.failVerify = true;
    f.store.events.add([f.store.purchase()]);
    await f.service.processingDone;
    expect(f.store.completed, isEmpty);
    expect(f.applied, [0]);
    expect(f.service.hasUnconfirmed, true);
    await expectLater(f.service.buy(sku), throwsStateError);
    f.failVerify = false;
    await f.service.retryUnconfirmed();
    expect(f.applied.last, 7);
    expect(f.store.completed.length, 1);
    expect(f.service.busy, false);
  });

  test('验单期间切换账号，不把旧账号余额写入新账号', () async {
    final f = Fixture();
    addTearDown(f.close);
    await f.service.initialize();
    f.verificationGate = Completer<void>();
    f.store.events.add([f.store.purchase()]);
    await Future<void>.delayed(Duration.zero);
    f.userId = 'u_abcdef1234567890abcdef1234567890';
    f.verificationGate!.complete();
    await f.service.processingDone;
    expect(f.applied, [0]);
    await expectLater(f.service.buy(sku), throwsStateError);
  });

  test('测试客户端拒绝生产接口，不展示可购买商品', () async {
    final f = Fixture()..mode = 'production';
    addTearDown(f.close);
    await f.service.initialize();
    expect(f.service.products, isEmpty);
    await expectLater(f.service.buy(sku), throwsStateError);
  });

  test('异常钱包响应不发钻石，也不完成付费交易', () async {
    final f = Fixture();
    addTearDown(f.close);
    await f.service.initialize();
    f.malformedWallet = true;
    f.store.events.add([f.store.purchase()]);
    await f.service.processingDone;
    expect(f.applied, [0]);
    expect(f.store.completed, isEmpty);
    expect(f.service.hasUnconfirmed, true);
  });
}
