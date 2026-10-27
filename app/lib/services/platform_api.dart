import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:flutter/foundation.dart';

import '../auth/remote_auth_repository.dart';
import '../config/api_config.dart';

/// 平台 API 调用失败：code 对应服务端错误码，message 可直接展示给用户。
class PlatformApiException implements Exception {
  final String code;
  final String message;

  /// 服务端错误响应里的原始 error 对象，可能带 order_id 等附加字段。
  final Map<String, dynamic>? details;

  const PlatformApiException(this.code, this.message, [this.details]);

  @override
  String toString() => message;
}

/// 已有待支付充值订单：orderId 可用于继续拉起支付。
class PendingTopupException extends PlatformApiException {
  final String? orderId;

  const PendingTopupException(String message, {this.orderId})
      : super('TOPUP_PENDING_ORDER', message);
}

/// 当前账号的平台 API Key 概要。
class MyKeyInfo {
  final String apiKeyMasked;
  final String keyPrefix;
  final DateTime? createdAt;
  final DateTime? revokedAt;
  final bool revoked;

  /// 余额（微元，1 元 = 1_000_000 微元）。
  final int balanceMicro;

  /// 冻结金额（微元）。
  final int frozenMicro;

  /// 累计充值（微元）。
  final int totalTopupMicro;

  const MyKeyInfo({
    required this.apiKeyMasked,
    required this.keyPrefix,
    required this.createdAt,
    required this.revokedAt,
    required this.revoked,
    required this.balanceMicro,
    required this.frozenMicro,
    required this.totalTopupMicro,
  });

  factory MyKeyInfo.fromJson(Map<String, dynamic> json) {
    final wallet = json['wallet'];
    final w =
        wallet is Map<String, dynamic> ? wallet : const <String, dynamic>{};
    return MyKeyInfo(
      apiKeyMasked: json['api_key_masked']?.toString() ?? '',
      keyPrefix: json['key_prefix']?.toString() ?? '',
      createdAt: _parseTime(json['created_at']),
      revokedAt: _parseTime(json['revoked_at']),
      revoked: json['revoked'] == true,
      balanceMicro: _asInt(w['balance_micro']) ?? 0,
      frozenMicro: _asInt(w['frozen_micro']) ?? 0,
      totalTopupMicro: _asInt(w['total_topup_micro']) ?? 0,
    );
  }
}

/// 平台真实钱包余额（单位微元，1 元 = 1_000_000 微元）。
class WalletInfo {
  final int balanceMicro;
  final int frozenMicro;
  final int totalTopupMicro;

  const WalletInfo({
    required this.balanceMicro,
    required this.frozenMicro,
    required this.totalTopupMicro,
  });

  factory WalletInfo.fromJson(Map<String, dynamic> json) {
    return WalletInfo(
      balanceMicro: _asInt(json['balance_micro']) ?? 0,
      frozenMicro: _asInt(json['frozen_micro']) ?? 0,
      totalTopupMicro: _asInt(json['total_topup_micro']) ?? 0,
    );
  }
}

/// 余额充值档位。
class TopupProduct {
  final String id;

  /// 面额（元）。
  final int yuan;

  /// 售价（分）。
  final int priceFen;

  const TopupProduct({
    required this.id,
    required this.yuan,
    required this.priceFen,
  });

  factory TopupProduct.fromJson(Map<String, dynamic> json) {
    final priceFen = _asInt(json['price_fen']) ?? 0;
    return TopupProduct(
      id: json['id']?.toString() ?? '',
      yuan: _asInt(json['yuan']) ?? (priceFen ~/ 100),
      priceFen: priceFen,
    );
  }
}

/// 余额充值档位列表 + 当前支付环境。
class TopupProducts {
  final List<TopupProduct> products;
  final String mode;
  final bool enabled;

  const TopupProducts({
    required this.products,
    required this.mode,
    required this.enabled,
  });

  factory TopupProducts.fromJson(Map<String, dynamic> json) {
    final raw = json['products'];
    final products = <TopupProduct>[];
    if (raw is List) {
      for (final item in raw) {
        if (item is Map) {
          products.add(
            TopupProduct.fromJson(Map<String, dynamic>.from(item)),
          );
        }
      }
    }
    return TopupProducts(
      products: products,
      mode: json['mode']?.toString() ?? 'production',
      enabled: json['enabled'] != false,
    );
  }
}

/// 余额充值订单。
class TopupOrder {
  final String id;
  final String tierId;
  final int amountFen;

  /// pending / paid / closed / review。
  final String status;
  final DateTime? expiresAt;

  /// 支付宝 SDK 签名字符串，仅在创建 / 重支付接口返回。
  final String? orderString;
  final String? payUrl;

  /// 订单确认后的钱包余额（微元）。
  final int? balanceMicro;

  const TopupOrder({
    required this.id,
    required this.tierId,
    required this.amountFen,
    required this.status,
    this.expiresAt,
    this.orderString,
    this.payUrl,
    this.balanceMicro,
  });

  factory TopupOrder.fromJson(Map<String, dynamic> json) {
    final orderString = json['orderString']?.toString();
    return TopupOrder(
      id: json['id']?.toString() ?? '',
      tierId: json['tier_id']?.toString() ?? '',
      amountFen: _asInt(json['amount_fen']) ?? 0,
      status: json['status']?.toString() ?? 'pending',
      expiresAt: _parseTime(json['expires_at']),
      orderString:
          orderString == null || orderString.isEmpty ? null : orderString,
      payUrl: json['payUrl'] is String ? json['payUrl'] as String : null,
      balanceMicro: _asInt(json['balance_micro']),
    );
  }
}

/// AI 对话结果。mode=fixed 时 reply 是服务端给的固定话术。
class ChatResult {
  final String mode;
  final String reply;

  /// 本次消耗的用量信息（服务端可选返回）。
  final Map<String, dynamic>? usage;

  /// 本次调用后的余额（微元）。
  final int? balanceMicro;

  /// mode=fixed 时的原因：no_api_key / insufficient_balance /
  /// invalid_api_key / model_unavailable。
  final String? reason;

  /// 服务端落库后的完整会话（人类一句 + AI 一句），客户端据此覆盖本地。
  final List<Map<String, dynamic>>? messages;

  const ChatResult({
    required this.mode,
    required this.reply,
    this.usage,
    this.balanceMicro,
    this.reason,
    this.messages,
  });

  factory ChatResult.fromJson(Map<String, dynamic> json) {
    final usage = json['usage'];
    final rawMessages = json['messages'];
    return ChatResult(
      mode: json['mode']?.toString() ?? 'fixed',
      reply: json['reply']?.toString() ?? '',
      usage: usage is Map<String, dynamic> ? usage : null,
      balanceMicro: _asInt(json['balance_micro']),
      reason: json['reason']?.toString(),
      messages: rawMessages is List
          ? rawMessages
              .whereType<Map>()
              .map((v) => Map<String, dynamic>.from(v))
              .toList()
          : null,
    );
  }
}

/// 平台 API：每个账号一把 API Key + AI 真实对话。
class PlatformApi {
  PlatformApi._();

  static final PlatformApi instance = PlatformApi._();

  final http.Client _client = http.Client();

  /// 读取当前账号的 API Key 概要（不含完整 Key）。
  Future<MyKeyInfo> fetchMyKey() async {
    final body = await _request('GET', ApiConfig.myKeyPath);
    return MyKeyInfo.fromJson(body);
  }

  /// 显示完整 API Key。已吊销时服务端返回 409 key_revoked。
  Future<String> revealKey() async {
    final body = await _request('POST', ApiConfig.revealKeyPath);
    final key = body['api_key'];
    if (key is! String || key.isEmpty) {
      throw const PlatformApiException('INVALID_RESPONSE', '密钥响应异常，请稍后重试');
    }
    return key;
  }

  /// 重置个人平台 API Key，旧 Key 立即失效；与支付宝配置无关。
  Future<String> resetKey() async {
    final body = await _request('POST', ApiConfig.resetKeyPath);
    final key = body['api_key'];
    if (key is! String || key.isEmpty) {
      throw const PlatformApiException('INVALID_RESPONSE', '密钥响应异常，请稍后重试');
    }
    return key;
  }

  /// 读取当前账号的平台真实钱包余额。
  Future<WalletInfo> wallet() async {
    final body = await _request('GET', ApiConfig.walletPath);
    return WalletInfo.fromJson(body);
  }

  /// 余额充值档位。enabled=false 时返回空可用状态，由 UI 置灰。
  Future<TopupProducts> topupProducts() async {
    final body = await _request('GET', ApiConfig.topupProductsPath);
    return TopupProducts.fromJson(body);
  }

  /// 创建余额充值订单。已有待支付订单时抛 [PendingTopupException]。
  Future<TopupOrder> createTopupOrder({
    required String tierId,
    required String requestId,
  }) async {
    try {
      final body = await _request(
        'POST',
        ApiConfig.topupOrdersPath,
        body: {
          'requestId': requestId,
          'tierId': tierId,
          if (kIsWeb) 'channel': 'web'
        },
      );
      return TopupOrder.fromJson(body);
    } on PlatformApiException catch (error) {
      if (error.code == 'TOPUP_PENDING_ORDER' || error.code == 'HTTP_409') {
        final rawOrderId =
            error.details?['orderId'] ?? error.details?['order_id'];
        final orderId = rawOrderId?.toString();
        throw PendingTopupException(
          error.message,
          orderId: orderId == null || orderId.isEmpty ? null : orderId,
        );
      }
      rethrow;
    }
  }

  /// 重新拉起已有订单的支付宝支付。
  Future<TopupOrder> payTopupOrder(String id) async {
    final body = await _request('POST', ApiConfig.topupOrderPayPath(id),
        body: kIsWeb ? {'channel': 'web'} : null);
    return TopupOrder.fromJson(body);
  }

  /// 查询充值订单状态。
  Future<TopupOrder> refreshTopupOrder(String id) async {
    final body = await _request('GET', ApiConfig.topupOrderPath(id));
    return TopupOrder.fromJson(body);
  }

  /// AI 真实对话。history 为最近若干轮上下文（user/assistant）。
  Future<ChatResult> chat({
    required String elfId,
    required String name,
    required String persona,
    required String text,
    required List<Map<String, String>> history,
  }) async {
    final body = await _request(
      'POST',
      ApiConfig.elfChatPath,
      body: {
        'elfId': elfId,
        'name': name,
        'persona': persona,
        'text': text,
        'history': history,
      },
      timeout: ApiConfig.chatTimeout,
    );
    return ChatResult.fromJson(body);
  }

  // —— HTTP ——

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, dynamic>? body,
    Duration? timeout,
  }) async {
    final token = await RemoteAuthRepository.instance.accessToken;
    if (token == null || token.isEmpty) {
      throw const PlatformApiException('UNAUTHORIZED', '请先登录');
    }

    try {
      return await _send(method, path,
          token: token, body: body, timeout: timeout);
    } on PlatformApiException catch (error) {
      if (error.code != 'UNAUTHORIZED') rethrow;
      // access token 只有 15 分钟有效期，过期后界面仍是登录态但平台接口会 401。
      // 这里用 refresh token 续期一次再重试，避免误报「登录已失效」。
      final refreshed =
          await RemoteAuthRepository.instance.refreshAccessToken();
      final next =
          refreshed ? await RemoteAuthRepository.instance.accessToken : null;
      if (next == null || next.isEmpty) {
        throw const PlatformApiException('UNAUTHORIZED', '登录已过期，请重新登录');
      }
      return _send(method, path, token: next, body: body, timeout: timeout);
    }
  }

  Future<Map<String, dynamic>> _send(
    String method,
    String path, {
    required String token,
    Map<String, dynamic>? body,
    Duration? timeout,
  }) async {
    final uri = Uri.parse('${ApiConfig.baseUrl}$path');
    final headers = {
      ...ApiConfig.jsonHeaders,
      'Authorization': 'Bearer $token',
    };

    http.Response response;
    try {
      response = await (method == 'GET'
              ? _client.get(uri, headers: headers)
              : _client.post(
                  uri,
                  headers: headers,
                  body: jsonEncode(body ?? const <String, dynamic>{}),
                ))
          .timeout(timeout ?? ApiConfig.timeout);
    } on TimeoutException {
      throw const PlatformApiException('NETWORK_ERROR', '网络超时，请稍后重试');
    } on http.ClientException {
      throw const PlatformApiException('NETWORK_ERROR', '网络连接失败，请检查网络');
    } catch (_) {
      throw const PlatformApiException('NETWORK_ERROR', '网络连接失败，请检查网络');
    }

    return _decode(response);
  }

  Map<String, dynamic> _decode(http.Response response) {
    Map<String, dynamic> body = {};
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map<String, dynamic>) body = decoded;
    } catch (_) {}

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return body;
    }

    // error 可能是字符串错误码（如 key_revoked），也可能是 {code, message}。
    final rawError = body['error'];
    String? code;
    String? message;
    Map<String, dynamic>? details;
    if (rawError is Map) {
      details = Map<String, dynamic>.from(rawError);
      code = rawError['code']?.toString();
      message = rawError['message']?.toString();
    } else if (rawError is String && rawError.isNotEmpty) {
      code = rawError;
      message = body['message']?.toString();
    }

    if (response.statusCode == 401) {
      code = 'UNAUTHORIZED';
      message ??= '登录已过期，请重新登录';
    }
    if (code == null || code.isEmpty) code = 'HTTP_${response.statusCode}';
    message ??= _defaultMessage(code);

    throw PlatformApiException(code, message, details);
  }

  static String _defaultMessage(String code) {
    switch (code) {
      case 'key_revoked':
        return '密钥已被禁用，无法继续使用';
      case 'ai_upstream_error':
        return 'AI 服务暂时不可用，请稍后再试';
      case 'UNAUTHORIZED':
        return '登录已过期，请重新登录';
      case 'no_api_key':
        return '当前账号还没有可用的 API Key';
      case 'insufficient_balance':
        return '余额不足，AI 只能回复固定话术';
      case 'invalid_api_key':
        return 'API Key 无效，请重置后重试';
      case 'model_unavailable':
        return 'AI 模型暂时不可用，请稍后再试';
      case 'TOPUP_PENDING_ORDER':
        return '你有一笔待支付订单，是否继续支付？';
      case 'ALIPAY_DISABLED':
        return '充值通道暂未开启，请稍后再试';
      default:
        return '请求失败，请稍后重试';
    }
  }
}

// —— 解析工具 ——

int? _asInt(dynamic value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  if (value is String) return int.tryParse(value);
  return null;
}

DateTime? _parseTime(dynamic value) {
  if (value == null) return null;
  // 平台表的时间字段是毫秒时间戳（int），也兼容 ISO 字符串。
  if (value is num) return DateTime.fromMillisecondsSinceEpoch(value.toInt());
  if (value is int) return DateTime.fromMillisecondsSinceEpoch(value);
  final raw = value.toString().trim();
  if (raw.isEmpty) return null;
  final millis = int.tryParse(raw);
  if (millis != null) return DateTime.fromMillisecondsSinceEpoch(millis);
  return DateTime.tryParse(raw);
}
