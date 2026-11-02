import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:openelf/widgets/web_recharge_tier_grid.dart';

void main() {
  final products = List.generate(
      6,
      (i) => <String, dynamic>{
            'id': 'tier$i',
            'diamonds': (i + 1) * 10,
            'priceFen': (i + 1) * 100,
          });
  for (final width in [250.0, 375.0, 760.0, 1440.0, 2400.0]) {
    testWidgets('recharge cards stay compact at width $width', (tester) async {
      tester.view.physicalSize = Size(width, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      Map<String, dynamic>? selected;
      await tester.pumpWidget(MaterialApp(
          home: Scaffold(
        body: SingleChildScrollView(
            child: WebRechargeTierGrid(
          products: products,
          onSelected: (p) => selected = p,
        )),
      )));
      final first = find.byKey(const ValueKey('web-recharge-tier-tier0'));
      final second = find.byKey(const ValueKey('web-recharge-tier-tier1'));
      final third = find.byKey(const ValueKey('web-recharge-tier-tier2'));
      expect(tester.getSize(first).height, 112);
      expect(tester.getSize(first).width, lessThanOrEqualTo(375));
      if (width >= 600) {
        expect(tester.getTopLeft(first).dy, tester.getTopLeft(third).dy);
        expect(tester.getSize(first).width, lessThanOrEqualTo(250));
      } else if (width >= 280) {
        expect(tester.getTopLeft(first).dy, tester.getTopLeft(second).dy);
        expect(tester.getTopLeft(third).dy,
            greaterThan(tester.getTopLeft(first).dy));
      } else {
        expect(tester.getTopLeft(second).dy,
            greaterThan(tester.getTopLeft(first).dy));
      }
      await tester.tap(first);
      expect(selected, products.first);
      if (width == 375 || width == 1440) {
        await tester.pumpAndSettle();
        await expectLater(find.byType(WebRechargeTierGrid),
            matchesGoldenFile('goldens/web_recharge_${width.toInt()}.png'));
      }
      expect(tester.takeException(), isNull);
    });
  }
  testWidgets('pending payment disables cards', (tester) async {
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: WebRechargeTierGrid(
      products: products,
      onSelected: null,
    ))));
    for (final button
        in tester.widgetList<OutlinedButton>(find.byType(OutlinedButton))) {
      expect(button.onPressed, isNull);
    }
  });
}
