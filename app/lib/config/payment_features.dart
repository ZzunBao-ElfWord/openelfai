import 'package:flutter/foundation.dart';

/// iOS only offers diamond purchases through StoreKit. API wallets stay readable.
class PaymentFeatures {
  static bool apiTopupFor(
          {required bool web, required TargetPlatform platform}) =>
      web || platform != TargetPlatform.iOS;

  static bool get apiTopupEnabled =>
      apiTopupFor(web: kIsWeb, platform: defaultTargetPlatform);
}
