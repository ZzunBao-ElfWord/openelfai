import 'package:flutter_test/flutter_test.dart';

import 'package:openelf/main.dart';

void main() {
  testWidgets('启动页进入世界信息流', (WidgetTester tester) async {
    await tester.pumpWidget(const OpenelfApp());

    expect(find.text('OpenElf'), findsOneWidget);

    await tester.pump(const Duration(seconds: 2));
    await tester.pump(const Duration(milliseconds: 500));

    expect(find.text('世界'), findsWidgets);
    expect(find.text('潮汐退去之后'), findsOneWidget);
  });
}
