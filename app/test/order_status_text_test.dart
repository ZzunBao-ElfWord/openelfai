import 'package:flutter_test/flutter_test.dart';
import 'package:openelf/payments/order_status_text.dart';
import 'package:openelf/payments/web_diamond_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  test('known and unknown payment codes never appear in customer wording', () {
    for (final status in [
      'paid',
      'pending',
      'closed',
      'refunded',
      'review',
      'expired',
      'failed',
      'INTERNAL_NEW_STATUS',
      null,
    ]) {
      expect(OrderStatusText.label(status), isNotEmpty);
      expect(OrderStatusText.message(status), isNotEmpty);
      if (status != null) {
        expect(OrderStatusText.label(status), isNot(contains(status)));
        expect(OrderStatusText.message(status), isNot(contains(status)));
      }
    }
  });

  for (final status in [
    'closed',
    'refunded',
    'review',
    'expired',
    'failed',
    'unknown'
  ]) {
    test(
        'wallet query shows customer wording for $status without granting diamonds',
        () async {
      SharedPreferences.setMockInitialValues({});
      var applied = 0;
      final service = WebDiamondService(
        supported: true,
        currentUser: () => 'u1',
        apply: (_, __) => applied++,
        request: (_, {body}) async => {
          'mode': 'production',
          'order': {'status': status},
        },
      );
      const id = 'OE0123456789abcdef0123456789abcdef';
      expect(await service.queryOrderStatus(id), status);
      expect(service.message, OrderStatusText.message(status));
      expect(applied,
          1); // Apply the server response only; never add funds locally.
      service.dispose();
    });
  }
}
