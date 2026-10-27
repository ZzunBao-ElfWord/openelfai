import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../auth/auth_repository.dart';
import '../auth/remote_auth_repository.dart';
import '../state/app_state.dart';
import 'web_checkout.dart';

typedef DiamondRequest = Future<Map<String, dynamic>> Function(
  String path, {
  Map<String, dynamic>? body,
});

class WebDiamondService extends ChangeNotifier {
  WebDiamondService({
    DiamondRequest? request,
    String? Function()? currentUser,
    void Function(String, Map<String, dynamic>)? apply,
    void Function(String)? onCheckoutReady,
    bool? supported,
  }) : _request = request ?? RemoteAuthRepository.instance.authenticatedRequest,
       _user = currentUser ?? (() => AppState.instance.currentUser?.id),
       _apply = apply ?? AppState.instance.applyPaymentResponse,
       _onCheckoutReady = onCheckoutReady ?? ((_) {}),
       supported = supported ?? kIsWeb;

  static final instance = WebDiamondService();
  static const _base = '/api/v1/web/alipay';
  static String _key(String user) => 'openelf.web-diamond.2021007112614465.production.$user';
  static bool _validId(dynamic id) =>
      id is String && RegExp(r'^OE[a-f0-9]{32}$').hasMatch(id);
  static Future<Map<String, dynamic>?> _saved(String user) async {
    final raw = (await SharedPreferences.getInstance()).getString(_key(user));
    if (raw == null) return null;
    try {
      final data = jsonDecode(raw);
      if (data is Map<String, dynamic> && data['owner'] == user) return data;
    } catch (_) {}
    return null;
  }

  static Future<bool> hasSavedOrder(String user) async =>
      _validId((await _saved(user))?['id']);

  final DiamondRequest _request;
  final String? Function() _user;
  final void Function(String, Map<String, dynamic>) _apply;
  final void Function(String) _onCheckoutReady;
  String? checkoutUrl;
  int? checkoutAmountFen;
  String? _lastStatus;
  final bool supported;
  String? _owner;
  Map<String, dynamic>? _record;
  final List<Map<String, dynamic>> _products = [];
  bool busy = false;
  String? message;
  List<Map<String, dynamic>> get products =>
      _owner == _user() ? List.unmodifiable(_products) : [];
  bool get hasPending => _owner == _user() && _validId(_record?['id']);
  String? get pendingId => hasPending ? _record!['id'] as String : null;
  void _check(String owner) {
    if (_user() != owner) {
      throw const AuthException('ACCOUNT_CHANGED', '账号已切换，请重新打开钱包');
    }
  }

  String _ownerNow() {
    final user = _user();
    if (user == null) throw const AuthException('UNAUTHORIZED', '请先登录');
    return user;
  }

  void _mode(Map<String, dynamic> data) {
    if (data['mode'] != 'production') throw StateError('网页钻石钱包环境不匹配');
  }

  Future<void> _save(String owner, Map<String, dynamic> data) async {
    _check(owner);
    final record = {...data, 'owner': owner};
    if (!await (await SharedPreferences.getInstance()).setString(
      _key(owner),
      jsonEncode(record),
    )) {
      throw StateError('订单无法保存，未跳转支付宝');
    }
    _check(owner);
    _record = record;
  }

  Future<void> _clear(String owner) async {
    await (await SharedPreferences.getInstance()).remove(_key(owner));
    _check(owner);
    _record = null;
  }

  Future<void> _wallet(String owner) async {
    final data = await _request('/api/v1/web/wallet?environment=production');
    _check(owner);
    _mode(data);
    _apply(owner, data);
  }

  Future<void> _confirm(String owner, String id) async {
    if (!_validId(id)) throw StateError('订单编号无效');
    _check(owner);
    final data = await _request('$_base/orders/$id');
    _check(owner);
    _mode(data);
    final status = (data['order'] as Map?)?['status'];
    _lastStatus = status as String?;
    _apply(
      owner,
      data,
    ); // Complete server snapshot; NEVER add diamonds locally.
    if (['paid', 'closed', 'refunded'].contains(status)) await _clear(owner);
    message = status == 'paid'
        ? '钻石已到账'
        : status == 'review'
        ? '订单待人工核对，请勿重复支付'
        : status == 'pending'
        ? '订单待付款，或支付结果待确认；请勿重复付款'
        : '订单状态：$status';
  }

  Future<String> queryOrderStatus(String id) async {
    final owner = _ownerNow();
    await _confirm(owner, id);
    _check(owner);
    notifyListeners();
    return _lastStatus ?? 'pending';
  }

  Future<void> _run(Future<void> Function(String) task) async {
    if (!supported || busy) return;
    busy = true;
    checkoutUrl = null;
    checkoutAmountFen = null;
    message = null;
    notifyListeners();
    try {
      final owner = _ownerNow();
      if (_owner != owner) {
        _record = null;
        _products.clear();
      }
      _owner = owner;
      await task(owner);
    } on AuthException catch (e) {
      message = e.message;
    } on FormatException catch (e) {
      message = e.message.toString();
    } on StateError catch (e) {
      message = e.message.toString();
    } catch (_) {
      message = '结果暂未确认，请刷新钱包，勿重复付款';
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<void> initialize() => _run((owner) async {
    _record = await _saved(owner);
    _check(owner);
    _products.clear();
    final catalog = await _request('$_base/products');
    _check(owner);
    _mode(catalog);
    if (catalog['protocol'] != 2) throw StateError('网页钻石充值协议不匹配');
    for (final value in catalog['products'] as List) {
      final p = Map<String, dynamic>.from(value as Map);
      if (p['id'] is! String ||
          p['diamonds'] is! int ||
          p['priceFen'] is! int ||
          p['diamonds'] <= 0 ||
          p['priceFen'] <= 0) {
        throw StateError('充值商品数据无效');
      }
      _products.add(p);
    }
    await _wallet(owner);
    final pending = await _request('$_base/pending');
    _check(owner);
    _mode(pending);
    if (!_validId(_record?['id'])) {
      final orders = pending['orders'] as List;
      if (orders.isNotEmpty) {
        final first = Map<String, dynamic>.from(orders.first as Map);
        if (!_validId(first['id'])) throw StateError('待支付订单数据异常');
        await _save(owner, first);
      }
    }
    if (_validId(_record?['id']) && _products.isNotEmpty) {
      await _confirm(owner, _record!['id'] as String);
    } else if (_products.isEmpty) {
      message = '网页钻石充值暂未开启；钻石余额仍从服务器读取';
    }
  });
  Future<void> refreshPending() => _run((owner) async {
    _record = await _saved(owner);
    _check(owner);
    if (_validId(_record?['id'])) {
      await _confirm(owner, _record!['id'] as String);
    } else {
      await _wallet(owner);
    }
  });
  Future<void> _checkout(String owner, Map<String, dynamic> order) async {
    _check(owner);
    _mode(order);
    if (!_validId(order['id'])) throw StateError('充值订单编号无效');
    await _save(
      owner,
      {...order}
        ..remove('payUrl')
        ..remove('orderString'),
    );
    if (order['status'] == 'paid') {
      await _confirm(owner, order['id'] as String);
      return;
    }
    if (order['status'] != 'pending' || order['payUrl'] == null) {
      throw StateError('订单不可继续付款，请先刷新确认状态');
    }
    final price = order['priceFen'];
    if (price is! int || price <= 0) throw StateError('充值金额无效');
    final url = WebCheckout.validateQrUrl(
      order['payUrl'] as String?,
      'production',
      order['id'] as String,
      price,
    );
    _check(owner);
    checkoutUrl = url;
    checkoutAmountFen = price;
    _onCheckoutReady(url);
  }

  Future<void> pay(String tierId) => _run((owner) async {
    if (_products.every((p) => p['id'] != tierId)) {
      throw StateError('请先刷新充值档位');
    }
    _record = await _saved(owner);
    _check(owner);
    if (_validId(_record?['id'])) throw StateError('请先确认或继续已有订单，勿重复下单');
    if (_record?['tierId'] != null && _record?['tierId'] != tierId) {
      throw StateError('上一笔下单结果待确认，请重试原充值档位');
    }
    var requestId = _record?['requestId'] as String?;
    if (requestId == null) {
      final random = Random.secure();
      requestId =
          'webdiamond-${List.generate(32, (_) => random.nextInt(16).toRadixString(16)).join()}';
      await _save(owner, {'requestId': requestId, 'tierId': tierId});
    }
    final order = await _request(
      '$_base/orders',
      body: {'requestId': requestId, 'tierId': tierId},
    );
    await _checkout(owner, order);
  });
  Future<void> resume() => _run((owner) async {
    _record = await _saved(owner);
    _check(owner);
    final id = _record?['id'];
    if (!_validId(id)) throw StateError('没有待处理的钻石订单');
    final order = await _request('$_base/orders/$id/pay', body: {});
    await _checkout(owner, order);
  });
}
