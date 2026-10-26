import 'package:flutter/foundation.dart';
import 'iap_config.dart';

/// Wallet authority is independent of the platform's payment provider.
class CommerceConfig {
  static const androidSandbox =
      bool.fromEnvironment('OPENELF_ANDROID_ALIPAY_SANDBOX');
  static String get androidMode => androidSandbox ? 'sandbox' : 'production';
  static bool get android =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.android;
  static bool get enabled => android || IapConfig.enabled;
  static String get walletPath =>
      android ? '/api/v1/android/wallet' : '/api/v1/wallet';
  static String get actionsPath =>
      android ? '/api/v1/android/commerce/actions' : '/api/v1/commerce/actions';
  static String get feedPath =>
      android ? '/api/v1/android/commerce/feed' : '/api/v1/commerce/feed';
  static String get chatPath =>
      android ? '/api/v1/android/commerce/chat' : '/api/v1/commerce/chat';
  static String get earningsPath =>
      android ? '/api/v1/android/earnings' : '/api/v1/earnings';
  static String get wishesPath =>
      android ? '/api/v1/android/wishes' : '/api/v1/wishes';
}
