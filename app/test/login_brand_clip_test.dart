import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:openelf/pages/login_page.dart';
import 'package:openelf/theme.dart';

void main() {
  for (final dark in [false, true]) {
    testWidgets(
        'login brand is really clipped on ${dark ? 'dark' : 'light'} theme',
        (tester) async {
      AppColors.use(dark ? darkPalette : lightPalette);
      addTearDown(() => AppColors.use(darkPalette));
      await tester.pumpWidget(MaterialApp(
        theme: dark ? AppTheme.dark : AppTheme.light,
        home: const LoginPage(),
      ));
      await tester.pumpAndSettle();
      final logo = find.byWidgetPredicate((widget) =>
          widget is Image &&
          widget.image is AssetImage &&
          (widget.image as AssetImage).assetName ==
              'assets/brand/app_icon.png');
      expect(logo, findsOneWidget);
      final clip = find.ancestor(of: logo, matching: find.byType(ClipRRect));
      expect(clip, findsOneWidget);
      expect(tester.widget<ClipRRect>(clip).borderRadius,
          BorderRadius.circular(20));
      expect(tester.takeException(), isNull);
    },
        variant: TargetPlatformVariant(
            {TargetPlatform.android, TargetPlatform.iOS}));
  }
}
