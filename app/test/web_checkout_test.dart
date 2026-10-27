import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:openelf/payments/web_checkout.dart';
import 'package:openelf/services/platform_api.dart';

void main() {
  test('新网页应用不接受旧应用付款链接，旧待支付记录不被覆盖或用于新应用', () async {
    SharedPreferences.setMockInitialValues({'openelf.web-topup.production.u1': '{"owner":"u1","requestId":"old","orderId":"OTaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'});
    expect(await WebTopupStore.read('u1'), isNull);
    await WebTopupStore.requestId('u1', 'topup10');
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString('openelf.web-topup.production.u1'), contains('old'));
    expect(() => WebCheckout.validateUrl('https://openapi.alipay.com/gateway.do?method=alipay.trade.page.pay&app_id=2021000105658450', 'production'), throwsFormatException);
  });
  const id = 'OT0123456789abcdef0123456789abcdef';
  const url =
      'https://openapi.alipay.com/gateway.do?method=alipay.trade.page.pay&app_id=2021007112614465';
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('只允许所选网页应用的HTTPS支付宝收银台，环境不能混用', () {
    expect(WebCheckout.validateUrl(url, 'production'), url);
    for (final bad in [
      'javascript:alert(1)',
      url.replaceFirst('https:', 'http:'),
      url.replaceFirst('openapi.alipay.com', 'openapi.alipay.com.evil.test'),
      url.replaceFirst('openapi.alipay.com', 'user@openapi.alipay.com'),
      url.replaceFirst('2021007112614465', '2021007111696426'),
      url.replaceFirst('page.pay', 'app.pay'),
      '$url#fragment',
    ]) {
      expect(() => WebCheckout.validateUrl(bad, 'production'),
          throwsFormatException);
    }
    expect(
        () => WebCheckout.validateUrl(url, 'sandbox'), throwsFormatException);
  });
  test('同一账号同档位重试复用操作编号，防止网络中断重复下单', () async {
    final first = await WebTopupStore.requestId('u1', 'topup10');
    expect(await WebTopupStore.requestId('u1', 'topup10'), first);
    expect(() => WebTopupStore.requestId('u1', 'topup20'), throwsStateError);
  });
  test('待支付记录按账号隔离，只保存订单编号，不保存收银台链接', () async {
    await WebTopupStore.requestId('u1', 'topup10');
    await WebTopupStore.rememberOrder('u1', id);
    expect((await WebTopupStore.read('u1'))?['orderId'], id);
    expect(await WebTopupStore.read('u2'), null);
    expect((await WebTopupStore.read('u1'))?.containsKey('payUrl'), false);
    await WebTopupStore.clear('u1', 'OTaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(await WebTopupStore.read('u1'), isNotNull);
    await WebTopupStore.clear('u1', id);
    expect(await WebTopupStore.read('u1'), null);
  });
  test('非法订单编号不能保存；回跳参数本身不作为成功凭证', () async {
    expect(() => WebTopupStore.rememberOrder('u1', 'paid=true'),
        throwsFormatException);
    expect(await WebTopupStore.read('u1'), null);
  });
  test('网页payUrl和安卓orderString独立解析，付费结果仍来自服务器状态', () {
    final web =
        TopupOrder.fromJson({'id': id, 'payUrl': url, 'status': 'pending'});
    expect(web.payUrl, url);
    expect(web.orderString, null);
    expect(web.status, 'pending');
    final app = TopupOrder.fromJson({'id': id, 'orderString': 'signed-order'});
    expect(app.orderString, 'signed-order');
    expect(app.payUrl, null);
  });
}
