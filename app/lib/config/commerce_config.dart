import 'package:flutter/foundation.dart';
import 'iap_config.dart';

/// Wallet authority is independent of the platform's payment provider.
class CommerceConfig {
  static const androidSandbox =
      bool.fromEnvironment('OPENELF_ANDROID_ALIPAY_SANDBOX');
  static String get androidMode => androidSandbox ? 'sandbox' : 'production';

  /// 网页端钻石钱包只保留正式账本，服务端 /api/v1/web/alipay/* 会拒绝其它环境。
  static const String webMode = 'production';

  static bool get android =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.android;
  static bool get web => kIsWeb;

  /// 走支付宝的端：Android 用原生 SDK，Web 用网页收银台。
  static bool get alipay => android || web;

  /// 当前端默认账本环境；没有钱包能力的端返回 null（由支付服务自己确定）。
  static String? get defaultMode => web
      ? webMode
      : android
          ? androidMode
          : null;
  // Retain the released callers while accepting main's platform-mode API.
  static String? get initialMode => defaultMode;
  static bool get enabled => alipay || IapConfig.enabled;
  static String get walletPath => web
      ? '/api/v1/web/wallet'
      : android
          ? '/api/v1/android/wallet'
          : '/api/v1/wallet';
  static String get actionsPath => web
      ? '/api/v1/web/commerce/actions'
      : android
          ? '/api/v1/android/commerce/actions'
          : '/api/v1/commerce/actions';
  static String get feedPath => web
      ? '/api/v1/web/commerce/feed'
      : android
          ? '/api/v1/android/commerce/feed'
          : '/api/v1/commerce/feed';
  static String get chatPath => web
      ? '/api/v1/web/commerce/chat'
      : android
          ? '/api/v1/android/commerce/chat'
          : '/api/v1/commerce/chat';
  static String get earningsPath =>
      android ? '/api/v1/android/earnings' : '/api/v1/earnings';
  static String get wishesPath =>
      android ? '/api/v1/android/wishes' : '/api/v1/wishes';
}
