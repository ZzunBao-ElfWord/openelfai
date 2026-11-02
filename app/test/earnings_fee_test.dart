import 'package:flutter_test/flutter_test.dart';
import 'package:openelf/models/elf.dart';

void main() {
  test('提现手续费和服务端四舍五入到分一致', () {
    const summary = EarningsSummary();
    expect(summary.withdrawalFeeCents(0), 0);
    expect(summary.withdrawalFeeCents(1000), 6);
    expect(summary.withdrawalFeeCents(1099), 7);
    expect(summary.withdrawalFeeCents(1250), 8);
    expect(summary.withdrawalFeeCents(200000), 1200);
  });
}
