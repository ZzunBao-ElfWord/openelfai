import 'dart:convert';
import 'dart:math';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../auth/auth_repository.dart';
import '../auth/remote_auth_repository.dart';
import '../config/commerce_config.dart';
import '../state/app_state.dart';
import 'commerce_repository.dart';

typedef AlipayRequest = Future<Map<String, dynamic>> Function(String path,
    {Map<String, dynamic>? body});
typedef AlipayNativePay = Future<Map<String, dynamic>> Function(
    String order, bool sandbox);

class AlipayService extends ChangeNotifier {
  AlipayService(
      {AlipayRequest? request,
      String? Function()? currentUser,
      void Function(String, Map<String, dynamic>)? applyResponse,
      AlipayNativePay? nativePay,
      bool? enabled,
      String? mode,
      Future<void> Function()? pollDelay})
      : _request =
            request ?? RemoteAuthRepository.instance.authenticatedRequest,
        _realBackend = request == null,
        _currentUser = currentUser ?? (() => AppState.instance.currentUser?.id),
        _applyResponse =
            applyResponse ?? AppState.instance.applyPaymentResponse,
        _nativePay = nativePay ?? _payNative,
        supported = enabled ?? CommerceConfig.android,
        mode = mode ?? CommerceConfig.androidMode,
        _pollDelay = pollDelay ??
            (() => Future<void>.delayed(const Duration(seconds: 1)));
  static final instance = AlipayService();
  final AlipayRequest _request;
  final bool _realBackend;
  final String? Function() _currentUser;
  final void Function(String, Map<String, dynamic>) _applyResponse;
  final AlipayNativePay _nativePay;
  final Future<void> Function() _pollDelay;
  final bool supported;
  final String mode;
  final List<Map<String, dynamic>> _products = [];
  List<Map<String, dynamic>> get products => List.unmodifiable(_products);
  String? _owner;
  Map<String, dynamic>? _pending;
  bool get hasPending => _pending != null && _owner == _currentUser();
  String? get pendingId => hasPending ? _pending!['id'] as String? : null;
  bool busy = false;
  bool loading = false;
  String? error;
  Future<void>? _loading;
  String _key(String user) => 'openelf.alipay.pending.$user.$mode';
  void _checkOwner(String user) {
    if (_currentUser() != user)
      throw const AuthException('ACCOUNT_CHANGED', '账号已切换，请重新打开钱包');
  }

  void _apply(String user, Map<String, dynamic> response) {
    if (response['mode'] != mode) throw StateError('钱包环境不匹配');
    _checkOwner(user);
    _applyResponse(user, response);
  }

  Future<void> initialize() {
    if (!supported || busy) return Future.value();
    return _loading ??= _load().whenComplete(() => _loading = null);
  }

  Future<void> _load() async {
    loading = true;
    error = null;
    _products.clear();
    final user = _currentUser();
    if (_owner != user) _pending = null;
    _owner = user;
    notifyListeners();
    try {
      if (user == null) throw StateError('请先登录');
      final catalog = await _request('/api/v1/android/alipay/products');
      _checkOwner(user);
      if (catalog['protocol'] != 2 || catalog['mode'] != mode)
        throw StateError('支付宝环境或协议不匹配');
      for (final raw in catalog['products'] as List) {
        final product = Map<String, dynamic>.from(raw as Map);
        if (product['id'] is! String ||
            product['priceFen'] is! int ||
            product['diamonds'] is! int ||
            product['priceFen'] <= 0 ||
            product['diamonds'] <= 0) throw StateError('商品数据无效');
        _products.add(product);
      }
      await refreshWallet();
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_key(user));
      _pending = raw == null
          ? null
          : Map<String, dynamic>.from(jsonDecode(raw) as Map);
      // Recover server orders even after lost local storage; never create a second order automatically.
      if (_pending?['id'] == null) {
        final result = await _request('/api/v1/android/alipay/pending');
        _checkOwner(user);
        if (result['mode'] != mode) throw StateError('订单环境不符');
        final orders = result['orders'] as List;
        if (orders.isNotEmpty) {
          _pending = Map<String, dynamic>.from(orders.first as Map);
          await _persist(user);
        }
      }
      if (_pending?['id'] != null && _products.isNotEmpty) await _confirm(user);
      if (_products.isEmpty) error = '支付宝充值暂未配置；钱包消费不受支付开关影响';
    } catch (e) {
      _products.clear();
      error = e is AuthException ? e.message : '钱包暂不可用，请稍后刷新';
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  Future<void> refreshWallet() async {
    final user = _currentUser();
    if (!supported || user == null) return;
    final response = _realBackend
        ? await CommerceRepository.instance.snapshot(user, mode)
        : await _request('/api/v1/android/wallet?environment=$mode');
    _apply(user, response);
  }

  /// 用已签名的 orderString 拉起支付宝收银台。
  ///
  /// 只反映收银台结果（9000 视为成功），是否到账一律以服务端订单状态为准；
  /// 不修改钱包、不弹提示。用户取消或拉起失败返回 false。
  Future<bool> launchOrderString(
    String orderString, {
    bool sandbox = false,
  }) async {
    if (orderString.isEmpty) return false;
    Map<String, dynamic> result;
    try {
      result = await _nativePay(orderString, sandbox);
    } on PlatformException {
      return false;
    } on MissingPluginException {
      return false;
    }
    return result['resultStatus']?.toString() == '9000';
  }

  Future<void> _persist(String user) async {
    final prefs = await SharedPreferences.getInstance();
    if (!await prefs.setString(_key(user), jsonEncode(_pending)))
      throw StateError('订单编号保存失败');
  }

  Future<void> _clear(String user) async {
    await (await SharedPreferences.getInstance()).remove(_key(user));
    if (_owner == user) _pending = null;
  }

  Future<void> pay(String tierId) async {
    final user = _currentUser();
    if (!supported ||
        user == null ||
        user != _owner ||
        busy ||
        loading ||
        _products.every((p) => p['id'] != tierId)) throw StateError('请先刷新钱包');
    if (hasPending && _pending!['tierId'] != tierId)
      throw StateError('请先确认待支付订单');
    busy = true;
    error = null;
    notifyListeners();
    try {
      if (_pending == null) {
        final random = Random.secure();
        _pending = {
          'tierId': tierId,
          'requestId':
              List.generate(32, (_) => random.nextInt(16).toRadixString(16))
                  .join()
        };
        await _persist(user);
      }
      final order = _pending!['id'] == null
          ? await _request('/api/v1/android/alipay/orders',
              body: {'tierId': tierId, 'requestId': _pending!['requestId']})
          : await _request(
              '/api/v1/android/alipay/orders/${_pending!['id']}/pay',
              body: {});
      _checkOwner(user);
      if (order['mode'] != mode ||
          order['id'] is! String ||
          !RegExp(r'^OE[a-f0-9]{32}$').hasMatch(order['id']))
        throw StateError('支付订单无效');
      _pending = {..._pending!, 'id': order['id']};
      await _persist(user);
      final signedOrder = order['orderString'];
      if (signedOrder is String && signedOrder.isNotEmpty) {
        _checkOwner(user);
        await _nativePay(signedOrder, mode == 'sandbox');
      }
      // 9000/cancel/error from Android is never used to grant diamonds.
      for (var i = 0; i < 4; i++) {
        if (await _confirm(user)) break;
        if (i < 3) await _pollDelay();
      }
      if (_pending != null) error = '支付结果待确认，可刷新订单；请勿重复创建充值';
    } catch (e) {
      error = e is AuthException ? e.message : '订单结果待确认，请刷新；请勿重复付款';
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<bool> _confirm(String user) async {
    final id = _pending?['id'];
    if (id == null) return false;
    final response = await _request('/api/v1/android/alipay/orders/$id');
    _apply(user, response);
    final order = response['order'] as Map;
    if (order['id'] != id) throw StateError('订单编号不匹配');
    if (order['status'] == 'review')
      throw const AuthException('ORDER_REVIEW', '订单需人工核对，请联系支持；请勿重复付款');
    if (['paid', 'closed', 'refunded'].contains(order['status'])) {
      await _clear(user);
      error = order['status'] == 'paid'
          ? null
          : order['status'] == 'refunded'
              ? '订单已退款，余额已同步'
              : '订单已关闭，未发放钻石';
      return true;
    }
    return false;
  }

  Future<void> confirmPending() async {
    if (busy) return;
    await initialize();
  }

  Future<void> continuePayment() async {
    final tier = _pending?['tierId'];
    if (tier is String) await pay(tier);
  }

  static Future<Map<String, dynamic>> _payNative(
          String order, bool sandbox) async =>
      await const MethodChannel('openelf/alipay')
          .invokeMapMethod<String, dynamic>(
              'pay', {'orderString': order, 'sandbox': sandbox}) ??
      {};
}
