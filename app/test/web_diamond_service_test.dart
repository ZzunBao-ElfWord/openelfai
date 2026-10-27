import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:openelf/auth/auth_repository.dart';
import 'package:openelf/payments/web_diamond_service.dart';

import 'dart:io';

void main() {
  const id = 'OE0123456789abcdef0123456789abcdef';
  final url = Uri.https('openapi.alipay.com', '/gateway.do', {
    'method': 'alipay.trade.page.pay',
    'app_id': '2021007112614465',
    'biz_content': jsonEncode({
      'qr_pay_mode': '4',
      'qrcode_width': 240,
      'out_trade_no': id,
      'total_amount': '1.00',
    }),
  }).toString();
  setUp(() => SharedPreferences.setMockInitialValues({}));
  ({
    WebDiamondService service,
    List<String> urls,
    List<Map<String, dynamic>> posts,
    List<int> balances,
    void Function(bool) paid,
    void Function() switchUser,
    void Function() failNext,
  })
  fixture({bool badUrl = false, bool switchOnPost = false}) {
    var owner = 'u1', paid = false, fail = false;
    final urls = <String>[],
        posts = <Map<String, dynamic>>[],
        balances = <int>[];
    final service = WebDiamondService(
      supported: true,
      currentUser: () => owner,
      onCheckoutReady: urls.add,
      apply: (user, data) {
        expect(user, owner);
        balances.add((data['wallet'] as Map)['diamonds'] as int);
      },
      request: (path, {body}) async {
        expect(path, isNot(contains('/platform/')));
        if (path.endsWith('/products')) {
          return {
            'protocol': 2,
            'mode': 'production',
            'products': [
              {'id': 'diamonds10', 'priceFen': 100, 'diamonds': 10},
            ],
          };
        }
        if (path.endsWith('/pending')) {
          return {'mode': 'production', 'orders': []};
        }
        if (body != null) {
          posts.add(Map.of(body));
          if (fail) {
            fail = false;
            throw const AuthException('NETWORK_ERROR', '网络失败');
          }
          if (switchOnPost) owner = 'u2';
          return {
            'id': id,
            'tierId': 'diamonds10',
            'priceFen': 100,
            'diamonds': 10,
            'status': 'pending',
            'mode': 'production',
            'payUrl': badUrl ? 'https://evil.test/' : url,
          };
        }
        return {
          'mode': 'production',
          'wallet': {'diamonds': paid ? 10 : 0},
          'order': {'id': id, 'status': paid ? 'paid' : 'pending'},
        };
      },
    );
    return (
      service: service,
      urls: urls,
      posts: posts,
      balances: balances,
      paid: (value) => paid = value,
      switchUser: () => owner = 'u2',
      failNext: () => fail = true,
    );
  }

  test('网页钻石下单后仅跳转，不本地加钻，也不调用平台余额接口', () async {
    final f = fixture();
    await f.service.initialize();
    await f.service.pay('diamonds10');
    expect(f.urls, [url]);
    expect(f.balances, [0]);
    expect(f.posts.single.keys, unorderedEquals(['requestId', 'tierId']));
    final prefs = await SharedPreferences.getInstance();
    final record = jsonDecode(
      prefs.getString('openelf.web-diamond.2021007112614465.production.u1')!,
    );
    expect(record['id'], id);
    expect(record.containsKey('payUrl'), false);
  });
  test('网络中断后由用户重试时复用幂等编号，不自动重试付款请求', () async {
    final f = fixture();
    await f.service.initialize();
    f.failNext();
    await f.service.pay('diamonds10');
    expect(f.posts.length, 1);
    expect(f.urls, isEmpty);
    await f.service.pay('diamonds10');
    expect(f.posts[1]['requestId'], f.posts[0]['requestId']);
    expect(f.urls, [url]);
  });
  test('服务器确认paid才刷新到账并清待处理记录，回跳本身不发钻', () async {
    final f = fixture();
    await f.service.initialize();
    await f.service.pay('diamonds10');
    await f.service.refreshPending();
    expect(f.balances.last, 0);
    f.paid(true);
    await f.service.refreshPending();
    expect(f.balances.last, 10);
    expect(await WebDiamondService.hasSavedOrder('u1'), false);
    expect(await WebDiamondService.hasSavedOrder('u2'), false);
  });
  test('账号切换或非法收银台链接均不跳转、不把余额写入新账号', () async {
    for (final options in [false, true]) {
      SharedPreferences.setMockInitialValues({});
      final f = fixture(badUrl: !options, switchOnPost: options);
      await f.service.initialize();
      await f.service.pay('diamonds10');
      expect(f.urls, isEmpty);
      expect(f.balances, [0]);
    }
  });
  test('保留原有重置个人API Key功能；Web钱包显示独立钻石充值面板', () {
    final keyPage = File('lib/pages/api_key_page.dart').readAsStringSync();
    expect(keyPage, contains('重置密钥'));
    expect(keyPage, contains('_resetButton()'));
    final wallet = File('lib/pages/wallet_page.dart').readAsStringSync();
    expect(wallet, contains('WebDiamondRechargePanel()'));
    expect(wallet, contains('AlipayRechargePanel()'));
    expect(wallet, contains('IosRechargePanel()'));
  });
}
