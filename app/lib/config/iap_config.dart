import 'package:flutter/foundation.dart';

/// StoreKit on iOS only. The server controls availability and accepted ledgers.
class IapConfig {
  static const bool testBuild = bool.fromEnvironment('OPENELF_IOS_IAP_TEST');
  static const bool disabled = bool.fromEnvironment('OPENELF_IOS_IAP_DISABLED');

  static bool get enabled =>
      !disabled && !kIsWeb && defaultTargetPlatform == TargetPlatform.iOS;
}
