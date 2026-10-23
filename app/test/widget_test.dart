import 'package:flutter_test/flutter_test.dart';

import 'package:openelf/main.dart';
import 'package:openelf/pages/login_page.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter/services.dart';

void main() {
  testWidgets('未登录启动必须进入短信登录，不允许调试绕过', (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues({});
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
            const MethodChannel('plugins.it_nomads.com/flutter_secure_storage'),
            (_) async => null);
    await tester.pumpWidget(const OpenelfApp());

    expect(find.text('OpenElf'), findsOneWidget);

    await tester.pump(const Duration(seconds: 2));
    await tester.pump(const Duration(milliseconds: 500));

    expect(find.byType(LoginPage), findsOneWidget);
    expect(find.text('世界'), findsNothing);
  });
}
