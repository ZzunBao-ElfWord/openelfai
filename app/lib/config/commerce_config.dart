import 'package:flutter/foundation.dart';
import 'iap_config.dart';

/// Wallet authority is independent of the platform's payment provider.
class CommerceConfig {
  static const androidSandbox =
      bool.fromEnvironment('OPENELF_ANDROID_ALIPAY_SANDBOX');
  static String get androidMode => androidSandbox ? 'sandbox' : 'production';
  static bool get android =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.android;
  static bool get enabled => kIsWeb || android || IapConfig.enabled;
  static String? get initialMode => kIsWeb
      ? 'production'
      : android
          ? androidMode
          : null;
  static String get walletPath => kIsWeb
      ? '/api/v1/web/wallet'
      : android
          ? '/api/v1/android/wallet'
          : '/api/v1/wallet';
  static String get actionsPath => kIsWeb
      ? '/api/v1/web/commerce/actions'
      : android
          ? '/api/v1/android/commerce/actions'
          : '/api/v1/commerce/actions';
  static String get feedPath => kIsWeb
      ? '/api/v1/web/commerce/feed'
      : android
          ? '/api/v1/android/commerce/feed'
          : '/api/v1/commerce/feed';
  static String get chatPath => kIsWeb
      ? '/api/v1/web/commerce/chat'
      : android
          ? '/api/v1/android/commerce/chat'
          : '/api/v1/commerce/chat';
  static String get earningsPath =>
      android ? '/api/v1/android/earnings' : '/api/v1/earnings';
  static String get wishesPath =>
      android ? '/api/v1/android/wishes' : '/api/v1/wishes';
}
