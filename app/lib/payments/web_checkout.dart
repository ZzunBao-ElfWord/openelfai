import 'dart:convert';
import 'dart:math';

import 'package:shared_preferences/shared_preferences.dart';

/// Never navigate to arbitrary backend-provided URLs or trust return-page status.
class WebCheckout {
  static String validateQrUrl(
    String? raw,
    String mode,
    String orderId,
    int amountFen,
  ) {
    final safe = validateUrl(raw, mode);
    final uri = Uri.parse(safe);
    final data = jsonDecode(uri.queryParameters['biz_content'] ?? '{}');
    if (uri.queryParametersAll.values.any((v) => v.length != 1) ||
        data is! Map ||
        data['qr_pay_mode'] != '4' ||
        data['qrcode_width'] != 240 ||
        data['out_trade_no'] != orderId ||
        data['total_amount'] != (amountFen / 100).toStringAsFixed(2)) {
      throw const FormatException('二维码订单、金额或展示模式不匹配，请刷新后重试');
    }
    return safe;
  }

  static bool validOrderId(String id) =>
      RegExp(r'^OT[a-f0-9]{32}$').hasMatch(id);

  static String validateUrl(String? raw, String mode) {
    final url = raw == null ? null : Uri.tryParse(raw);
    final host = mode == 'production'
        ? 'openapi.alipay.com'
        : mode == 'sandbox'
        ? 'openapi-sandbox.dl.alipaydev.com'
        : '';
    if (url == null ||
        host.isEmpty ||
        url.scheme != 'https' ||
        url.host != host ||
        url.userInfo.isNotEmpty ||
        url.fragment.isNotEmpty ||
        (url.hasPort && url.port != 443) ||
        url.path != '/gateway.do' ||
        url.queryParameters['method'] != 'alipay.trade.page.pay' ||
        url.queryParameters['app_id'] != '2021007112614465') {
      throw const FormatException('支付宝收银台地址或应用不匹配，未跳转');
    }
    return url.toString();
  }
}

/// Only order IDs and idempotency keys are stored; never signed pay URLs/keys.
class WebTopupStore {
  static String _key(String user) => 'openelf.web-topup.2021007112614465.production.$user';
  static Future<Map<String, dynamic>?> read(String user) async {
    final raw = (await SharedPreferences.getInstance()).getString(_key(user));
    if (raw == null) return null;
    try {
      final data = jsonDecode(raw);
      if (data is Map<String, dynamic> && data['owner'] == user) return data;
    } catch (_) {}
    return null;
  }

  static Future<void> _save(String user, Map<String, dynamic> data) async {
    if (!await (await SharedPreferences.getInstance()).setString(
      _key(user),
      jsonEncode({...data, 'owner': user}),
    )) {
      throw StateError('无法保存待支付订单，未跳转支付宝');
    }
  }

  static Future<String> requestId(String user, String tier) async {
    final prior = await read(user);
    if (prior != null) {
      if (prior['tier'] != tier) {
        throw StateError('上一笔下单结果待确认，请选择原档位重试');
      }
      return prior['requestId'] as String;
    }
    final random = Random.secure();
    final nonce = List.generate(
      32,
      (_) => random.nextInt(16).toRadixString(16),
    ).join();
    final id = 'web-$nonce';
    await _save(user, {'requestId': id, 'tier': tier});
    return id;
  }

  static Future<void> rememberOrder(String user, String id) async {
    if (!WebCheckout.validOrderId(id)) throw const FormatException('订单编号无效');
    await _save(user, {...?await read(user), 'orderId': id});
  }

  static Future<void> clear(String user, String id) async {
    if ((await read(user))?['orderId'] == id) {
      await (await SharedPreferences.getInstance()).remove(_key(user));
    }
  }
}
