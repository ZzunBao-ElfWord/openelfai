import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:openelf/main.dart';
import 'package:openelf/models/user.dart';
import 'package:openelf/pages/create_elf_page.dart';
import 'package:openelf/pages/login_page.dart';
import 'package:openelf/state/app_state.dart';
import 'package:openelf/theme.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter/services.dart';

void main() {
  group('明暗主题', () {
    test('两套主题亮度正确，品牌色保持蓝色', () {
      expect(AppTheme.light.brightness, Brightness.light);
      expect(AppTheme.dark.brightness, Brightness.dark);
      expect(AppTheme.light.colorScheme.primary, lightPalette.brand);
      expect(AppTheme.dark.colorScheme.primary, darkPalette.brand);
      expect(lightPalette.bg, const Color(0xFFFFFFFF));
      expect(darkPalette.bg, const Color(0xFF08090D));
    });

    test('色板切换后 AppColors 全量跟随', () {
      AppColors.use(lightPalette);
      expect(AppColors.bg, lightPalette.bg);
      expect(AppColors.text, lightPalette.text);
      expect(AppColors.brandGradient.colors.first, lightPalette.gradientStart);

      AppColors.use(darkPalette);
      expect(AppColors.bg, darkPalette.bg);
      expect(AppColors.onBrand, darkPalette.onBrand);
    });

    test('外观选择持久化，重启可恢复', () async {
      SharedPreferences.setMockInitialValues({});
      await ThemeController.instance.setMode(ThemeMode.light);
      expect(ThemeController.instance.mode, ThemeMode.light);

      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('openelf.themeMode'), 'light');

      ThemeController.instance.setMode(ThemeMode.system);
    });
  });

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

  group('UGC AI 铸造', () {
    Future<void> signIn({required int diamonds}) async {
      SharedPreferences.setMockInitialValues({});
      final state = AppState.instance;
      state.bootstrapSync();
      state.currentUser = User(
        id: 'test-user',
        phone: '13800000000',
        nickname: '测试',
        avatarInitial: '测',
        createdAt: DateTime.now(),
      );
      state.wallet.diamonds = diamonds;
    }

    test('钻石不足时拒绝，足额时扣费并生成链上地址', () async {
      await signIn(diamonds: AppState.createElfCost - 1);
      final state = AppState.instance;

      final notEnough = await state.createElf(
        name: '小满',
        prompt: '一个安静的短发女孩，黄昏的天台',
        style: '通用',
        persona: '',
        fear: '',
        habit: '',
      );
      expect(notEnough, contains('钻石不够'));
      expect(state.myElves.any((e) => e.name == '小满'), isFalse);

      state.wallet.diamonds = AppState.createElfCost + 100;
      final ok = await state.createElf(
        name: '小满',
        prompt: '一个安静的短发女孩，黄昏的天台',
        style: '通用',
        persona: '相信慢慢来',
        fear: '',
        habit: '',
      );
      expect(ok, isNull);

      final elf = state.myElves.firstWhere((e) => e.name == '小满');
      expect(elf.isMine, isTrue);
      expect(elf.serial, startsWith('#U'));
      expect(elf.chainAddress, startsWith('0x'));
      expect(elf.avatarPrompt, contains('短发女孩'));
      expect(elf.avatarStyle, '通用');
      expect(state.activeElfId, elf.id);
      expect(state.wallet.diamonds, 100);
    });

    test('未实名时不能使用身份证授权线创建', () async {
      await signIn(diamonds: AppState.createElfCost * 2);
      final state = AppState.instance;

      final error = await state.createElf(
        name: '本人',
        prompt: '',
        style: '通用',
        persona: '',
        fear: '',
        habit: '',
        portraitSource: 'idCard',
      );
      expect(error, contains('实名认证'));
      expect(state.myElves.where((e) => e.name == '本人'), isEmpty);
    });

    test('身份证校验位不通过时拒绝实名', () async {
      await signIn(diamonds: 0);
      final state = AppState.instance;

      final error = await state.submitIdentityVerification(
        realName: '张三三',
        idNumber: '110105194912310021',
        frontImagePath: '/tmp/front.jpg',
        backImagePath: '/tmp/back.jpg',
      );
      expect(error, contains('校验位'));
      expect(state.isIdentityVerified, isFalse);
    });

    test('实名通过后可用本人形象创建，且本地不存完整证件号', () async {
      await signIn(diamonds: AppState.createElfCost * 2);
      final state = AppState.instance;

      final verified = await state.submitIdentityVerification(
        realName: '张三三',
        idNumber: '11010519491231002X',
        frontImagePath: '/tmp/front.jpg',
        backImagePath: '/tmp/back.jpg',
      );
      expect(verified, isNull);
      expect(state.isIdentityVerified, isTrue);
      expect(state.identity!.maskedName, '张**');
      expect(state.identity!.maskedIdNumber, contains('*'));
      expect(state.identity!.maskedIdNumber, isNot(contains('19491231002X')));

      final error = await state.createElf(
        name: '本人',
        prompt: '',
        style: '通用',
        persona: '相信真诚',
        fear: '',
        habit: '',
        portraitSource: 'idCard',
      );
      expect(error, isNull);
      final elf = state.myElves.last;
      expect(elf.portraitSource, 'idCard');
      expect(elf.avatarPrompt, contains('实名'));
    });

    test('名称或形象描述命中违规词直接拒绝', () async {
      await signIn(diamonds: AppState.createElfCost * 2);
      final state = AppState.instance;

      final error = await state.createElf(
        name: '换脸君',
        prompt: '拿一张照片做换脸',
        style: '通用',
        persona: '',
        fear: '',
        habit: '',
      );
      expect(error, contains('违规词'));
      expect(state.myElves.any((e) => e.name == '换脸君'), isFalse);
    });
  });

  testWidgets('创建页未登录时只展示登录闸门', (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues({});
    AppState.instance.currentUser = null;

    await tester.pumpWidget(const MaterialApp(home: CreateElfPage()));
    await tester.pump();

    expect(find.text('登录后才能创建 AI'), findsOneWidget);
    expect(find.text('去登录'), findsOneWidget);
    expect(find.text('输入你脑海中的形象'), findsNothing);
  });

  testWidgets('选择身份证授权线且未实名时引导去实名认证', (WidgetTester tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    SharedPreferences.setMockInitialValues({});
    final state = AppState.instance;
    state.bootstrapSync();
    state.currentUser = User(
      id: 'idcard-user',
      phone: '13800000002',
      nickname: '证件',
      avatarInitial: '证',
      createdAt: DateTime.now(),
    );

    await tester.pumpWidget(const MaterialApp(home: CreateElfPage()));
    await tester.pump();

    await tester.tap(find.text('身份证授权'));
    await tester.pump();
    expect(find.text('需要先完成实名认证'), findsOneWidget);
    expect(find.text('去实名认证'), findsWidgets);

    await tester.tap(find.text('去实名认证').first);
    await tester.pumpAndSettle();
    expect(find.text('实名认证'), findsOneWidget);
    expect(find.text('身份证照片'), findsOneWidget);
  });

  testWidgets('登录后三步走完并铸造成功', (WidgetTester tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    SharedPreferences.setMockInitialValues({});
    final state = AppState.instance;
    state.bootstrapSync();
    state.currentUser = User(
      id: 'flow-user',
      phone: '13800000001',
      nickname: '流程',
      avatarInitial: '流',
      createdAt: DateTime.now(),
    );
    state.wallet.diamonds = AppState.createElfCost * 2;

    await tester.pumpWidget(const MaterialApp(home: CreateElfPage()));
    await tester.pump();

    // 第 1 步：文字描述形象
    expect(find.text('输入你脑海中的形象'), findsOneWidget);
    await tester.enterText(
        find.byType(TextField).first, '一个安静的短发女孩，黄昏的天台');
    await tester.pump();

    await tester.tap(find.text('下一步 · 定人格'));
    await tester.pump();

    // 第 2 步：定人格
    await tester.enterText(find.byType(TextField).first, '小满');
    await tester.tap(find.text('下一步 · 合规确认'));
    await tester.pump();

    // 第 3 步：逐条勾选声明后铸造
    for (final box in tester.widgetList<Checkbox>(find.byType(Checkbox))) {
      box.onChanged!(true);
    }
    await tester.pump();
    await tester.tap(find.text('铸造 AI NFT · 💎${AppState.createElfCost}'));
    await tester.pumpAndSettle();

    expect(find.text('铸造完成'), findsOneWidget);
    expect(state.myElves.any((e) => e.name == '小满'), isTrue);
  });
}
