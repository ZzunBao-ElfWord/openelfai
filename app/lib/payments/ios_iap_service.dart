import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:in_app_purchase/in_app_purchase.dart';
import 'package:in_app_purchase_storekit/in_app_purchase_storekit.dart';
import 'package:in_app_purchase_storekit/store_kit_2_wrappers.dart' as sk2;

import '../auth/remote_auth_repository.dart';
import '../config/iap_config.dart';
import '../state/app_state.dart';
import 'commerce_repository.dart';

typedef IapRequest = Future<Map<String, dynamic>> Function(String path,
    {Map<String, dynamic>? body});

abstract interface class IapStore {
  Stream<List<PurchaseDetails>> get purchaseStream;
  Future<bool> isAvailable();
  Future<ProductDetailsResponse> queryProductDetails(Set<String> ids);
  Future<bool> buyConsumable({required PurchaseParam purchaseParam});
  Future<void> completePurchase(PurchaseDetails purchase);
}

class _AppleStore implements IapStore {
  InAppPurchase get _store => InAppPurchase.instance;
  @override
  Stream<List<PurchaseDetails>> get purchaseStream => _store.purchaseStream;
  @override
  Future<bool> isAvailable() => _store.isAvailable();
  @override
  Future<ProductDetailsResponse> queryProductDetails(Set<String> ids) =>
      _store.queryProductDetails(ids);
  @override
  Future<bool> buyConsumable({required PurchaseParam purchaseParam}) =>
      _store.buyConsumable(purchaseParam: purchaseParam);
  @override
  Future<void> completePurchase(PurchaseDetails purchase) =>
      _store.completePurchase(purchase);
}

/// Sandbox build integration. All crediting is performed by the server.
class IosIapService extends ChangeNotifier {
  IosIapService._(
      {IapStore? store,
      IapRequest? request,
      String? Function()? currentUserId,
      void Function(String, int, int)? applyWallet,
      Future<String> Function()? environment,
      Future<String?> Function()? storefront,
      bool? enabled})
      : _store = store ?? _AppleStore(),
        _request =
            request ?? RemoteAuthRepository.instance.authenticatedRequest,
        _currentUserId =
            currentUserId ?? (() => AppState.instance.currentUser?.id),
        _applyResponse = applyWallet == null
            ? _applyAppResponse
            : ((user, response) => applyWallet(
                user,
                response['wallet']['diamonds'] as int,
                response['wallet']['totalRecharged'] as int)),
        _environmentDetector = environment ?? _detectEnvironment,
        _storefront = storefront ?? _readStorefront,
        _usingRealBackend = request == null,
        _enabled = enabled ?? IapConfig.enabled;

  @visibleForTesting
  IosIapService.testing(
      {required IapStore store,
      required IapRequest request,
      required String? Function() currentUserId,
      required void Function(String, int, int) applyWallet,
      Future<String> Function()? environment,
      Future<String?> Function()? storefront})
      : this._(
            store: store,
            request: request,
            currentUserId: currentUserId,
            applyWallet: applyWallet,
            environment: environment ?? (() async => 'Sandbox'),
            storefront: storefront ?? (() async => 'CHN'),
            enabled: true);
  static final IosIapService instance = IosIapService._();

  final IapStore _store;
  final IapRequest _request;
  final String? Function() _currentUserId;
  final void Function(String, Map<String, dynamic>) _applyResponse;
  final Future<String> Function() _environmentDetector;
  final Future<String?> Function() _storefront;
  final bool _usingRealBackend;
  final bool _enabled;
  StreamSubscription<List<PurchaseDetails>>? _updates;
  Future<void>? _loading;
  Future<void> _queue = Future<void>.value();
  final Map<String, int> _amounts = {};
  final Map<String, ProductDetails> _products = {};
  final Map<String, PurchaseDetails> _unconfirmed = {};
  String? _ownerId;
  String? _accountToken;
  String? _buying;
  String? _environment;
  String? _storeCountry;
  final Set<String> _uncertainPrices = {};
  bool get isSandbox => _environment == 'Sandbox';
  bool loading = false;
  String? error;

  bool get supported => _enabled;
  bool get busy => _buying != null || _unconfirmed.isNotEmpty;
  bool get hasUnconfirmed => _unconfirmed.isNotEmpty;
  @visibleForTesting
  Future<void> get processingDone => _queue;
  List<ProductDetails> get products => _products.values.toList()
    ..sort((a, b) => diamondsFor(a.id).compareTo(diamondsFor(b.id)));
  int diamondsFor(String id) => _amounts[id] ?? 0;

  String priceTextFor(ProductDetails product) =>
      _uncertainPrices.contains(product.id) ? '点击查看付款价格' : product.price;

  static Future<String?> _readStorefront() async {
    try {
      return await sk2.Storefront()
          .countryCode()
          .timeout(const Duration(seconds: 3));
    } catch (_) {
      return null;
    }
  }

  Future<String?> _country() async {
    try {
      final value = await _storefront().timeout(const Duration(seconds: 3));
      return value != null && RegExp(r'^[A-Z]{3}$').hasMatch(value)
          ? value
          : null;
    } catch (_) {
      return null;
    }
  }

  bool _priceLooksWrong(ProductDetails product, String? country) {
    if (product.price.trim().isEmpty ||
        !product.rawPrice.isFinite ||
        product.rawPrice < 0) {
      return true;
    }
    if (country == 'CHN' && product.currencyCode != 'CNY') return true;
    if (country == 'USA' && product.currencyCode != 'USD') return true;
    // Known TestFlight symptom: USD metadata while the payment sheet uses a
    // non-US storefront. Do not convert an amount or guess its RMB equivalent.
    return isSandbox && product.currencyCode == 'USD' && country != 'USA';
  }

  Future<void> _refreshStorePrices(String userId) async {
    for (var attempt = 0; attempt < 2; attempt++) {
      final before = await _country();
      final response = await _store
          .queryProductDetails(_amounts.keys.toSet())
          .timeout(const Duration(seconds: 15));
      final after = await _country();
      if (_currentUserId() != userId) throw StateError('账号已切换，请重新打开充值页面');
      if (response.error != null) throw StateError('读取 App Store 商品失败');
      final changed = before != after;
      final items = response.productDetails
          .where((p) => _amounts.containsKey(p.id))
          .toList();
      final suspicious = items.any((p) => _priceLooksWrong(p, after));
      if (attempt == 0 && (changed || suspicious)) continue;
      _storeCountry = after;
      _products.clear();
      _uncertainPrices.clear();
      for (final item in items) {
        _products[item.id] = item;
        if (changed || _priceLooksWrong(item, after)) {
          _uncertainPrices.add(item.id);
        }
      }
      if (response.notFoundIDs.isNotEmpty) error = '部分商品暂不可购买';
      return;
    }
  }

  Future<void> initialize() async {
    if (!supported) return;
    _updates ??= _store.purchaseStream.listen(
      (purchases) {
        for (final purchase in purchases) {
          _queue = _queue
              .then((_) => _handlePurchase(purchase))
              .catchError((Object _) {
            error = '订单暂未确认，请刷新后重试';
            notifyListeners();
          });
        }
      },
      onError: (Object _) {
        error = 'App Store 交易更新失败，请稍后重试';
        notifyListeners();
      },
    );
    if (_buying == null) await loadProducts();
    await retryUnconfirmed();
  }

  Future<void> loadProducts() {
    if (!supported || _buying != null) return Future<void>.value();
    return _loading ??= _load().whenComplete(() => _loading = null);
  }

  Future<void> _load() async {
    loading = true;
    error = null;
    _products.clear();
    _uncertainPrices.clear();
    _storeCountry = null;
    _amounts.clear();
    _accountToken = null;
    notifyListeners();
    final userId = _currentUserId();
    try {
      if (userId == null) throw StateError('请先登录');
      _environment = await _environmentDetector();
      if (!['Production', 'Sandbox'].contains(_environment)) {
        throw StateError('请在真机测试 App Store 内购');
      }
      final body =
          await _request('/api/v1/ios/products?environment=$_environment');
      if (_currentUserId() != userId) return;
      if (body['protocol'] != 2 ||
          body['mode'] != _environment!.toLowerCase()) {
        throw StateError('充值暂未开放');
      }
      final token = body['appAccountToken'];
      if (token is! String || !_isUuid(token)) throw StateError('账号绑定信息异常');
      _ownerId = userId;
      _accountToken = token;
      final entries = body['products'] as List<dynamic>? ?? [];
      for (final raw in entries) {
        final item = raw as Map<String, dynamic>;
        final id = item['id'];
        final amount = item['diamonds'];
        if (id is String && amount is int && amount > 0) _amounts[id] = amount;
      }
      await refreshWallet();
      if (_amounts.isNotEmpty) {
        if (!await _store.isAvailable()) throw StateError('App Store 暂不可用');
        await _refreshStorePrices(userId);
      }
    } catch (_) {
      _products.clear();
      _accountToken = null;
      error = '充值暂不可用，请稍后刷新';
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  Future<void> refreshWallet() async {
    final userId = _currentUserId();
    if (!supported || userId == null) return;
    if (_environment == null) return;
    final body = _usingRealBackend
        ? await CommerceRepository.instance.snapshot(userId, _environment!)
        : await _request('/api/v1/wallet?environment=$_environment');
    if (body['mode'] != _environment!.toLowerCase()) {
      throw StateError('钱包环境不匹配');
    }
    _applyWallet(userId, body);
  }

  Future<void> buy(String id) async {
    var product = _products[id];
    if (!supported ||
        busy ||
        loading ||
        product == null ||
        _accountToken == null ||
        _ownerId != _currentUserId()) {
      throw StateError('请刷新商品或先确认已有订单');
    }
    _buying = id;
    error = null;
    notifyListeners();
    String? priceWarning;
    try {
      final oldPrice = priceTextFor(product);
      final oldCountry = _storeCountry;
      final userId = _ownerId!;
      await _refreshStorePrices(userId);
      product = _products[id];
      if (product == null) throw StateError('商品暂不可购买');
      if (oldCountry != _storeCountry || oldPrice != priceTextFor(product)) {
        priceWarning = '商品价格已更新，请核对后重新选择';
        throw StateError(priceWarning);
      }
      final started = await _store.buyConsumable(
        purchaseParam: Sk2PurchaseParam(
          productDetails: product,
          applicationUserName: _accountToken,
        ),
      );
      if (!started) throw StateError('无法启动 App Store 付款');
    } catch (_) {
      _buying = null;
      error = priceWarning ?? '无法启动付款，请刷新商品后重试';
      notifyListeners();
      rethrow;
    }
  }

  Future<void> _handlePurchase(PurchaseDetails purchase) async {
    final id = purchase.purchaseID;
    if (purchase.status == PurchaseStatus.pending) {
      _buying = purchase.productID;
      notifyListeners();
      return;
    }
    if (purchase.status == PurchaseStatus.canceled ||
        purchase.status == PurchaseStatus.error) {
      _buying = null;
      error = purchase.status == PurchaseStatus.error ? '付款未完成，请稍后重试' : null;
      if (purchase.pendingCompletePurchase) {
        await _store.completePurchase(purchase);
      }
      notifyListeners();
      return;
    }
    if (purchase.status != PurchaseStatus.purchased &&
        purchase.status != PurchaseStatus.restored) {
      return;
    }
    if (id == null) {
      error = '订单编号暂未取得，请重新打开钱包';
      notifyListeners();
      return;
    }
    _unconfirmed[id] = purchase;
    _buying = null;
    final userId = _currentUserId();
    try {
      if (userId == null) throw StateError('请先登录');
      final body = await _request('/api/v1/ios/verify', body: {
        'productId': purchase.productID,
        'transactionId': id,
      });
      if (body['mode'] != _environment?.toLowerCase()) {
        throw StateError('交易环境不符');
      }
      _applyWallet(userId, body);
      // Finish only after the server confirms the idempotent ledger write.
      if (purchase.pendingCompletePurchase) {
        await _store.completePurchase(purchase);
      }
      _unconfirmed.remove(id);
      error = body['orderStatus'] == 'refunded' ? '该订单已退款，余额已同步' : null;
    } catch (_) {
      error = '付款结果待确认，请点击确认订单；请勿重复付款';
    }
    notifyListeners();
  }

  Future<void> retryUnconfirmed() async {
    _queue = _queue.then((_) async {
      for (final purchase in List<PurchaseDetails>.of(_unconfirmed.values)) {
        await _handlePurchase(purchase);
      }
    });
    await _queue;
  }

  void _applyWallet(String userId, Map<String, dynamic> body) {
    final raw = body['wallet'];
    if (raw is! Map<String, dynamic> ||
        raw['diamonds'] is! int ||
        raw['totalRecharged'] is! int ||
        (raw['diamonds'] as int) < 0 ||
        (raw['totalRecharged'] as int) < 0) {
      throw StateError('钱包响应异常');
    }
    if (_currentUserId() == userId) {
      _applyResponse(userId, body);
    }
  }

  static void _applyAppResponse(String userId, Map<String, dynamic> body) =>
      AppState.instance.applyPaymentResponse(userId, body);

  static Future<String> _detectEnvironment() async {
    final value = await const MethodChannel('openelf/payments')
        .invokeMethod<String>('getEnvironment');
    if (IapConfig.testBuild && value != 'Sandbox') {
      throw StateError('当前包只用于沙盒测试');
    }
    if (value != 'Production' && value != 'Sandbox') {
      throw StateError('无法确认 App Store 环境');
    }
    return value!;
  }

  @override
  void dispose() {
    unawaited(_updates?.cancel());
    super.dispose();
  }

  static bool _isUuid(String token) => RegExp(
        r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        caseSensitive: false,
      ).hasMatch(token);
}
