import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:openelf/main.dart';
import 'package:openelf/models/user.dart';
import 'package:openelf/pages/character_studio_page.dart';
import 'package:openelf/pages/create_elf_page.dart';
import 'package:openelf/pages/market_page.dart';
import 'package:openelf/pages/home_shell.dart';
import 'package:openelf/pages/login_page.dart';
import 'package:openelf/pages/profile_page.dart';
import 'package:openelf/services/platform_api.dart';
import 'package:openelf/state/app_state.dart';
import 'package:openelf/theme.dart';
import 'package:openelf/widgets/workbench_panel.dart';
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

  testWidgets('桌面宽屏：左侧导航 + 世界流宽内容区', (WidgetTester tester) async {
    // 避免触发支付插件初始化（测试环境默认 android 平台会走支付宝分支）
    debugDefaultTargetPlatformOverride = TargetPlatform.windows;
    addTearDown(() => debugDefaultTargetPlatformOverride = null);
    tester.view.physicalSize = const Size(1440, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    SharedPreferences.setMockInitialValues({});
    final state = AppState.instance;
    state.bootstrapSync();
    state.currentUser = User(
      id: 'wide-user',
      phone: '13800000003',
      nickname: '宽屏',
      avatarInitial: '宽',
      createdAt: DateTime.now(),
    );

    await tester.pumpWidget(const MaterialApp(home: HomeShell()));
    await tester.pump();

    // 左侧导航：品牌 + 版本 + 5 项入口
    expect(find.text('OpenElf'), findsOneWidget);
    expect(find.text('v1.3'), findsOneWidget);
    expect(find.text('世界'), findsWidgets); // 导航项 + 页面标题
    expect(find.text('视频'), findsWidgets); // 导航项 + 工作台赛道胶囊
    expect(find.text('创建'), findsOneWidget);
    expect(find.text('发现'), findsOneWidget);

    // 首页工作台：大标题 + 药丸输入框
    expect(find.text('OpenElf，我帮你'), findsOneWidget);
    expect(find.text('创作'), findsOneWidget);
    expect(find.text('快速'), findsOneWidget);

    // 内容区：世界信息流正常渲染
    expect(find.text('为你推荐'), findsOneWidget);

    // 点击侧栏「我」切换 tab 不崩溃
    await tester.tap(find.text('我'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    // 卸载 HomeShell，取消周期 Timer，避免测试收尾报 pending timer
    await tester.pumpWidget(const SizedBox());
    await tester.pump();
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('窄屏保持底部 5 格导航', (WidgetTester tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.windows;
    addTearDown(() => debugDefaultTargetPlatformOverride = null);
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    SharedPreferences.setMockInitialValues({});
    final state = AppState.instance;
    state.bootstrapSync();
    state.currentUser = User(
      id: 'narrow-user',
      phone: '13800000004',
      nickname: '窄屏',
      avatarInitial: '窄',
      createdAt: DateTime.now(),
    );

    await tester.pumpWidget(const MaterialApp(home: HomeShell()));
    await tester.pump();

    // 窄屏无左侧品牌行，底部导航存在
    expect(find.text('OpenElf'), findsNothing);
    expect(find.text('创建'), findsOneWidget);
    // 手机端不出现工作台，保留原有世界页头部
    expect(find.text('OpenElf，我帮你'), findsNothing);
    expect(find.text('写作'), findsNothing);
    expect(find.text('为你推荐'), findsOneWidget);

    await tester.pumpWidget(const SizedBox());
    await tester.pump();
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('工作台：赛道胶囊与示例指令填入输入框', (WidgetTester tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.windows;
    addTearDown(() => debugDefaultTargetPlatformOverride = null);
    tester.view.physicalSize = const Size(1440, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    SharedPreferences.setMockInitialValues({});
    final state = AppState.instance;
    state.bootstrapSync();
    state.currentUser = User(
      id: 'workbench-user',
      phone: '13800000005',
      nickname: '工作台',
      avatarInitial: '工',
      createdAt: DateTime.now(),
    );

    await tester.pumpWidget(
        const MaterialApp(home: Scaffold(body: WorkbenchPanel(wide: true))));
    await tester.pump();

    expect(find.text('OpenElf，我帮你'), findsOneWidget);
    expect(find.text('写作'), findsOneWidget);

    // 赛道胶囊 → 模板填入输入框
    await tester.tap(find.text('写作'));
    await tester.pump();
    expect(find.text('帮我写一篇短文'), findsOneWidget);

    // 示例指令胶囊 → 覆盖输入框
    await tester.tap(find.textContaining('续章'));
    await tester.pump();
    expect(find.text('写一篇《潮汐来信》的续章'), findsOneWidget);
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('工作台：加号打开技能面板，选中形象工坊后输入框出现技能 chip', (WidgetTester tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.windows;
    addTearDown(() => debugDefaultTargetPlatformOverride = null);
    tester.view.physicalSize = const Size(1440, 900);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    SharedPreferences.setMockInitialValues({});
    final state = AppState.instance;
    state.bootstrapSync();
    state.currentUser = User(
      id: 'skill-user',
      phone: '13800000006',
      nickname: '技能',
      avatarInitial: '技',
      createdAt: DateTime.now(),
    );
    // 形象工坊是官方技能书：学会后才出现在技能面板。
    state.myElf!.learnedSkills.add('studio');

    await tester.pumpWidget(
        const MaterialApp(home: Scaffold(body: WorkbenchPanel(wide: true))));
    await tester.pump();

    // 加号 → 技能面板
    await tester.tap(find.byIcon(Icons.add));
    await tester.pumpAndSettle();
    expect(find.text('技能'), findsOneWidget);
    expect(find.text('形象工坊'), findsOneWidget);

    // 选中后变成输入框里的技能 chip
    await tester.tap(find.text('形象工坊'));
    await tester.pumpAndSettle();
    expect(find.text('形象工坊'), findsOneWidget);
    expect(find.text('发消息…（形象工坊已选中）'), findsOneWidget);

    // chip 上的 × 可以移除
    await tester.tap(find.byIcon(Icons.close));
    await tester.pumpAndSettle();
    expect(find.text('形象工坊'), findsNothing);
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('形象工坊对话页：首屏给出描述引导与风格选项', (WidgetTester tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.windows;
    addTearDown(() => debugDefaultTargetPlatformOverride = null);
    SharedPreferences.setMockInitialValues({});
    AppState.instance.bootstrapSync();

    await tester.pumpWidget(const MaterialApp(home: CharacterStudioPage()));
    await tester.pump();

    expect(find.text('形象工坊'), findsOneWidget);
    expect(find.text('通用'), findsOneWidget);
    expect(find.text('像素画'), findsOneWidget);
    expect(find.textContaining('说说你想做的形象'), findsOneWidget);
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('发现页保留实际AI与技能书市场，充值仍在钱包', (WidgetTester tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.windows;
    addTearDown(() => debugDefaultTargetPlatformOverride = null);
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    SharedPreferences.setMockInitialValues({});
    AppState.instance.bootstrapSync();

    await tester
        .pumpWidget(const MaterialApp(home: MarketPage(embedded: true)));
    await tester.pump();

    expect(find.textContaining('AI 智能体'), findsWidgets);
    expect(find.textContaining('AI 技能书'), findsWidgets);
    // A market price/balance icon is not an embedded checkout panel.
    expect(find.text('充值钻石'), findsNothing);
    expect(find.text('支付宝充值 · 请选择充值金额'), findsNothing);
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('我的页：WorkBuddy 式简单列表，钱包充值入口保留在账户卡', (WidgetTester tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.windows;
    addTearDown(() => debugDefaultTargetPlatformOverride = null);
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    SharedPreferences.setMockInitialValues({});
    final state = AppState.instance;
    state.bootstrapSync();
    state.currentUser = User(
      id: 'profile-user',
      phone: '13800000007',
      nickname: '我的',
      avatarInitial: '我',
      createdAt: DateTime.now(),
    );

    await tester
        .pumpWidget(const MaterialApp(home: Scaffold(body: ProfilePage())));
    await tester.pump();

    expect(find.text('我的'), findsWidgets);
    expect(find.text('钻石余额'), findsOneWidget);
    expect(find.text('钱包'), findsOneWidget);
    expect(find.textContaining('仓库'), findsOneWidget);
    expect(find.text('我的 AI 资源'), findsOneWidget);
    for (final label in ['收益', '我的 API Key']) {
      expect(find.text(label), findsOneWidget);
    }
    expect(find.byIcon(Icons.settings_outlined), findsOneWidget);
    await tester.tap(find.text('钱包'));
    await tester.pumpAndSettle();
    expect(find.text('充值钻石'), findsOneWidget);
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('未登录启动必须进入短信登录，不允许调试绕过', (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues({});
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
            const MethodChannel('plugins.it_nomads.com/flutter_secure_storage'),
            (_) async => null);
    await tester.pumpWidget(const OpenElfApp());

    expect(find.text('OpenElf'), findsOneWidget);

    await tester.pump(const Duration(seconds: 2));
    await tester.pump(const Duration(milliseconds: 500));

    expect(find.byType(LoginPage), findsOneWidget);
    expect(find.text('世界'), findsNothing);
  });

  group('UGC AI 创建', () {
    Future<void> signIn({required int diamonds}) async {
      // 本组验证演示态（无服务端钱包）的本地创建逻辑；安卓真机走服务端。
      debugDefaultTargetPlatformOverride = TargetPlatform.windows;
      addTearDown(() => debugDefaultTargetPlatformOverride = null);
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

    test('钻石不足时拒绝，足额时扣费并生成专属地址', () async {
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
      expect(elf.chainAddress, elf.id);
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

  testWidgets('登录后三步走完并创建成功', (WidgetTester tester) async {
    // P3 流程依赖服务端：用假 HTTP 客户端覆盖角色卡接口，验证三步 UI 与铸造落地。
    debugDefaultTargetPlatformOverride = TargetPlatform.windows;
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    SharedPreferences.setMockInitialValues({});
    FlutterSecureStorage.setMockInitialValues({
      'openelf.accessToken': 'test-access-token',
      'openelf.refreshToken': 'test-refresh-token',
    });

    Map<String, dynamic> cardJson({
      String status = 'draft',
      String? imageUrl,
      String? thumbUrl,
    }) =>
        {
          'id': 'card-1',
          'name': '小满',
          'source': 'text',
          'style': '通用',
          'prompt': '一个安静的短发女孩，黄昏的天台',
          'persona': '慢下来才能看见细节',
          'fear': '被当成工具',
          'habit': '反复看评论',
          'status': status,
          'seed': 7,
          'traits': <String, dynamic>{},
          'rarity_tier': status == 'generated' ? 'common' : null,
          'rarity_score': status == 'generated' ? 3 : 0,
          if (imageUrl != null) 'imageUrl': imageUrl,
          if (thumbUrl != null) 'thumbUrl': thumbUrl,
        };

    http.Response jsonRes(Object body) => http.Response(
          jsonEncode(body),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );

    final client = MockClient((request) async {
      final path = request.url.path;
      if (path == '/api/v1/character/drafts') {
        return jsonRes(cardJson());
      }
      if (path == '/api/v1/character/drafts/card-1') {
        return jsonRes(cardJson());
      }
      if (path == '/api/v1/character/drafts/card-1/preview') {
        return jsonRes({
          'thumbDataUrl':
              'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
          'compositionHash': 'demo-hash',
          'rarity': {'tier': 'common', 'score': 3},
          'traits': <String, dynamic>{},
        });
      }
      if (path == '/api/v1/character/drafts/card-1/generate') {
        return jsonRes({
          'card': cardJson(
            status: 'generated',
            imageUrl: '/api/v1/character-assets/char_demo.png',
            thumbUrl: '/api/v1/character-assets/char_demo_thumb.png',
          ),
          'imageUrl': '/api/v1/character-assets/char_demo.png',
          'thumbUrl': '/api/v1/character-assets/char_demo_thumb.png',
          'refine': {'skipped': true},
        });
      }
      if (path == '/api/v1/character/cards/card-1/mint') {
        return jsonRes({
          'elf': {
            'id': 'ugc_test',
            'serial': '#U001',
            'name': '小满',
            'initial': '小',
            'ownerId': 'flow-user',
            'ownerLabel': '流程',
            'isMine': true,
            'generation': 1,
            'edition': 'UGC · 初版',
            'persona': '慢下来才能看见细节',
            'fear': '被当成工具',
            'habit': '反复看评论',
            'status': 'active',
            'followers': 0,
            'echo': 0,
            'works': 0,
            'attention': 0,
            'chainAddress': '0xflow',
            'baseCapacity': 3,
            'learnedSkills': <String>[],
            'today': <String>[],
            'relations': <dynamic>[],
            'imageUrl': '/api/v1/character-assets/char_demo.png',
            'imageThumbUrl': '/api/v1/character-assets/char_demo_thumb.png',
            'characterCardId': 'card-1',
            'tokenId': 7,
          },
          'card': cardJson(status: 'generated'),
          'tokenId': 7,
          'chain': {'dciId': 'dci_test', 'antTxHash': 'tx_test'},
        });
      }
      return http.Response('{}', 404);
    });
    PlatformApi.debugUseClient(client);
    addTearDown(PlatformApi.debugResetClient);

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

    // 第 1 步：角色设定（名字 + 形象描述 + 合规声明）。
    expect(find.text('输入你脑海中的形象'), findsOneWidget);
    await tester.enterText(find.byType(TextField).first, '小满');
    await tester.enterText(find.byType(TextField).at(1), '一个安静的短发女孩，黄昏的天台');
    await tester.pump();
    for (final box in tester.widgetList<Checkbox>(find.byType(Checkbox))) {
      box.onChanged!(true);
    }
    await tester.pump();
    await tester.tap(find.text('下一步 · 形象预览'));
    await tester.pumpAndSettle();

    // 第 2 步：服务端预览 + 确认生成。
    expect(find.text('第 2 / 3 步 · 形象预览'), findsOneWidget);
    expect(find.text('换一组'), findsOneWidget);
    // 选中一张预览缩略图，再确认生成。
    await tester.tap(find.byType(Image).first);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, '确认生成所选形象'));
    await tester.pumpAndSettle();
    expect(find.text('下一步 · 铸造'), findsOneWidget);

    // 第 3 步：铸造费用与二次确认。
    await tester.tap(find.text('下一步 · 铸造'));
    await tester.pumpAndSettle();
    expect(find.text('铸造将扣除 200 钻石，形象生成免费。'), findsOneWidget);
    await tester.tap(find.text('铸造 AI · 💎${AppState.createElfCost}'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, '确认铸造'));
    await tester.pumpAndSettle();

    expect(find.text('铸造成功'), findsOneWidget);
    expect(find.text('#7'), findsOneWidget);
    expect(state.myElves.any((e) => e.name == '小满'), isTrue);
    expect(state.activeElfId, 'ugc_test');
    debugDefaultTargetPlatformOverride = null;
  });
}
