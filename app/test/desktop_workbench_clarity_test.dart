import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:openelf/state/app_state.dart';
import 'package:openelf/theme.dart';
import 'package:openelf/widgets/workbench_panel.dart';

void main() {
  Future<void> mount(WidgetTester tester,
      {bool dark = false, double width = 1100, double scale = 1}) async {
    SharedPreferences.setMockInitialValues({});
    AppState.instance.bootstrapSync();
    AppState.instance.currentUser = null;
    AppColors.use(dark ? darkPalette : lightPalette);
    tester.view.physicalSize = Size(width, 1100);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    addTearDown(() => AppColors.use(darkPalette));
    await tester.pumpWidget(MaterialApp(
        theme: dark ? AppTheme.dark : AppTheme.light,
        home: MediaQuery(
            data: MediaQueryData(
                size: Size(width, 1100), textScaler: TextScaler.linear(scale)),
            child: const Scaffold(
                body: SingleChildScrollView(
                    child: WorkbenchPanel(wide: true, desktopLayout: true))))));
    await tester.pumpAndSettle();
  }

  for (final dark in [false, true]) {
    testWidgets(
        'desktop clear hierarchy and text contrast (${dark ? 'dark' : 'light'})',
        (tester) async {
      await mount(tester, dark: dark);
      await tester.tap(find.text('创作'));
      await tester.pump();
      expect(find.text('执行 AI'), findsOneWidget);
      expect(find.text('技能与工具'), findsOneWidget);
      expect(find.text('快捷指令'), findsOneWidget);
      expect(find.text('点击示例填入输入框，不会直接执行'), findsOneWidget);
      final input = find.byKey(const ValueKey('desktop-task-input'));
      expect(tester.widget<TextField>(input).style!.fontSize, 16);
      expect(tester.getTopLeft(find.text('OpenElf，我帮你')).dy,
          lessThan(tester.getTopLeft(find.text('写文章')).dy));
      expect(tester.getTopLeft(find.text('写文章')).dy,
          lessThan(tester.getTopLeft(input).dy));
      expect(
          tester.getTopLeft(find.text('试试这样说')).dy,
          greaterThan(tester
              .getBottomRight(
                  find.byKey(const ValueKey('desktop-task-composer')))
              .dy));
      final fg = AppColors.textSub.computeLuminance();
      final bg = AppColors.surface.computeLuminance();
      final ratio = fg > bg ? (fg + .05) / (bg + .05) : (bg + .05) / (fg + .05);
      expect(ratio, greaterThanOrEqualTo(4.5));
      expect(
          tester
              .widget<FilledButton>(
                  find.byKey(const ValueKey('desktop-task-send')))
              .onPressed,
          isNull);
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets(
      'examples only fill input; whitespace cannot submit; Ctrl+Enter keeps login gate',
      (tester) async {
    await mount(tester);
    await tester.tap(find.text('创作'));
    await tester.pump();
    final input = find.byKey(const ValueKey('desktop-task-input'));
    final send = find.byKey(const ValueKey('desktop-task-send'));
    await tester.tap(find.text('写文章'));
    await tester.pump();
    expect(tester.widget<TextField>(input).controller!.text, '帮我写一篇短文');
    expect(tester.widget<FilledButton>(send).onPressed, isNotNull);
    expect(find.text('登录后继续'), findsNothing);
    await tester.enterText(input, '   ');
    await tester.pump();
    expect(tester.widget<FilledButton>(send).onPressed, isNull);
    await tester.enterText(input, '只验证登录闸门，不发送到模型');
    await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
    await tester.pumpAndSettle();
    expect(find.text('登录后继续'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
      'desktop scenarios switch shortcuts and hints without discarding draft',
      (tester) async {
    await mount(tester);
    final input = find.byKey(const ValueKey('desktop-task-input'));
    expect(find.text('日常问答'), findsOneWidget);
    expect(find.text('开始对话'), findsOneWidget);
    await tester.enterText(input, '保留我的需求');
    await tester.tap(find.text('创作'));
    await tester.pump();
    expect(find.text('写文章'), findsOneWidget);
    expect(find.text('日常问答'), findsNothing);
    expect(tester.widget<TextField>(input).decoration!.hintText,
        contains('今天想创作什么'));
    await tester.tap(find.text('运营'));
    await tester.pump();
    expect(find.text('内容计划'), findsOneWidget);
    expect(find.text('写文章'), findsNothing);
    expect(tester.widget<TextField>(input).controller!.text, '保留我的需求');
    expect(tester.takeException(), isNull);
  });

  testWidgets(
      'compact and large text desktop stays scrollable without overflow',
      (tester) async {
    await mount(tester, width: 390, scale: 1.5);
    expect(find.byKey(const ValueKey('desktop-task-input')), findsOneWidget);
    expect(find.text('执行 AI'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
