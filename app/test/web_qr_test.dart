import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:openelf/payments/web_checkout.dart';
import 'package:openelf/payments/web_qr_dialog.dart';

void main() {
  const id = 'OT0123456789abcdef0123456789abcdef';
  String url({String order = id, String amount = '10.00', String mode = '4'}) =>
    Uri.https('openapi.alipay.com', '/gateway.do', {'method': 'alipay.trade.page.pay', 'app_id': '2021007112614465',
      'biz_content': jsonEncode({'qr_pay_mode': mode, 'qrcode_width': 240, 'out_trade_no': order, 'total_amount': amount})}).toString();
  test('必须为相同订单和金额的官方嵌入式二维码，拒绝旧跳转URL、金额篡改与外站', () {
    expect(WebCheckout.validateQrUrl(url(), 'production', id, 1000), url());
    for (final bad in [url(order: 'OTbad'), url(amount: '1.00'), url(mode: '2'), url().replaceFirst('openapi.alipay.com', 'evil.test')]) {
      expect(() => WebCheckout.validateQrUrl(bad, 'production', id, 1000), throwsFormatException);
    }
  });
  test('两个网页充值入口不再整页导航，iframe禁止跳出顶层页面', () {
    for (final file in ['lib/pages/api_key_page.dart', 'lib/payments/web_diamond_service.dart']) {
      expect(File(file).readAsStringSync(), isNot(contains('navigateToWebCheckout')));
    }
    final frame = File('lib/payments/web_qr_frame_web.dart').readAsStringSync();
    expect(frame, contains('sandbox')); expect(frame, isNot(contains('allow-top-navigation')));
    expect(frame, contains('no-referrer'));
  });
  testWidgets('显示金额与扫码入口，服务器确认paid后关闭；关闭不会当成已付款', (tester) async {
    late BuildContext context;
    await tester.pumpWidget(MaterialApp(home: Builder(builder: (ctx) { context = ctx; return const Scaffold(); })));
    var status = 'pending'; bool? paid;
    final result = showWebQrPayment(context, url: url(), orderId: id, amountFen: 1000, isOwner: () => true, query: () async => status).then((v) => paid = v);
    await tester.pumpAndSettle();
    expect(find.text('支付宝扫码付款 ¥10.00'), findsOneWidget); expect(paid, isNull);
    status = 'paid'; await tester.tap(find.text('我已付款，查询到账')); await tester.pumpAndSettle(); await result;
    expect(paid, true);
    final close = showWebQrPayment(context, url: url(), orderId: id, amountFen: 1000, isOwner: () => true, query: () async => 'pending');
    await tester.pumpAndSettle(); await tester.tap(find.text('关闭并保留订单')); await tester.pumpAndSettle();
    expect(await close, false);
  });
}
