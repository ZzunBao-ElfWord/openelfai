import 'package:flutter/foundation.dart';

/// API 配置。
///
/// 服务端：https://openelfai.com（Nginx 反向代理到鉴权服务）
/// 可用 --dart-define=OPENELF_API_BASE=https://... 覆盖。
class ApiConfig {
  static const String baseUrl = String.fromEnvironment(
    'OPENELF_API_BASE',
    defaultValue: kIsWeb ? '' : 'https://openelfai.com',
  );

  /// 全局请求超时（秒）。
  static const Duration timeout = Duration(seconds: 15);

  /// AI 对话超时：大模型生成较慢，单独放宽。
  static const Duration chatTimeout = Duration(seconds: 60);

  /// 请求头（JSON API）。
  static const Map<String, String> jsonHeaders = {
    'Content-Type': 'application/json; charset=UTF-8',
    'Accept': 'application/json',
  };

  /// 发送验证码（POST）。body 包含手机号、平台及图形验证凭证。
  static const String sendCodePath = '/api/v1/auth/send-code';

  /// 验证码登录（POST）。body: {"phone", "code", "deviceId"}
  static const String loginByCodePath = '/api/v1/auth/login-by-code';

  /// 刷新会话（POST）。body: {"refreshToken", "deviceId"}
  static const String refreshPath = '/api/v1/auth/refresh';

  /// 退出登录（POST）。
  static const String logoutPath = '/api/v1/auth/logout';

  /// 当前用户（GET）。header: Authorization: Bearer xxx
  static const String mePath = '/api/v1/auth/me';

  /// 当前账号的平台 API Key 概要（GET）。
  static const String myKeyPath = '/api/v1/platform/my-key';

  /// 显示完整 API Key（POST）。
  static const String revealKeyPath = '/api/v1/platform/my-key/reveal';

  /// 重置个人平台 API Key（不是支付宝密钥）。
  static const String resetKeyPath = '/api/v1/platform/my-key/reset';

  /// 平台真实钱包余额（GET）header: Authorization: Bearer xxx
  static const String walletPath = '/api/v1/platform/wallet';

  /// 余额充值档位（GET）header: Authorization: Bearer xxx
  static const String topupProductsPath = kIsWeb
      ? '/api/v1/platform/web-topup/products'
      : '/api/v1/platform/topup/products';

  /// 余额充值下单（POST）header: Authorization: Bearer xxx
  static const String topupOrdersPath = kIsWeb
      ? '/api/v1/platform/web-topup/orders'
      : '/api/v1/platform/topup/orders';

  /// 余额充值订单详情（GET）。
  static String topupOrderPath(String id) => '$topupOrdersPath/$id';

  /// 余额充值订单重新拉起支付（POST）。
  static String topupOrderPayPath(String id) => '$topupOrdersPath/$id/pay';

  /// AI 真实对话（POST）。
  static const String elfChatPath = '/api/v1/elf-chat';
}
