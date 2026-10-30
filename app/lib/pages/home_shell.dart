import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import '../services/app_content_service.dart';
import '../state/app_state.dart';
import '../payments/ios_iap_service.dart';
import '../payments/alipay_service.dart';
import '../config/commerce_config.dart';
import '../theme.dart';
import 'create_elf_page.dart';
import 'market_page.dart';
import 'profile_page.dart';
import 'video_feed_page.dart';
import 'world_page.dart';
import 'wallet_page.dart';
import 'identity_verify_page.dart';
import 'elf_chat_page.dart';
import 'elf_works_page.dart';
import '../push/push_service.dart';

/// 主容器：底栏 5 格 —— 世界 / 视频 / 创建（居中）/ 发现 / 我。
/// 世界与视频是两个独立的站内曝光渠道；「我的 AI」与设置合并进「我」；
/// 中间的「创建」不是页面，而是打开 UGC AI 创建流程（创建后可回到「我」）。
class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> with WidgetsBindingObserver {
  int _current = 0;
  StreamSubscription<Uri>? _linkSub;
  Timer? _autoTimer;
  bool _pushScheduled = false;

  List<Widget> get _pages => [
        const WorldPage(),
        VideoFeedPage(active: _current == 1),
        const MarketPage(embedded: true),
        const ProfilePage(),
      ];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _autoTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      unawaited(AppState.instance.triggerAutoIfDue());
    });
    WidgetsBinding.instance.addPostFrameCallback((_) => _refreshPayments());
    _initAppLinks();
    PushService.instance.addListener(_onPush);
    _onPush();
  }

  @override
  void dispose() {
    PushService.instance.removeListener(_onPush);
    _linkSub?.cancel();
    _autoTimer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _refreshPayments();
      unawaited(PushService.instance.refresh());
      _onPush();
    }
  }

  void _onPush() {
    if (_pushScheduled) return;
    _pushScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _pushScheduled = false;
      if (!mounted) return;
      final user = AppState.instance.currentUser;
      if (user == null) return;
      final destination = PushService.instance.takeDestination(user.id);
      if (destination == null) return;
      Widget? page;
      switch (destination.route) {
        case 'home':
          Navigator.of(context).popUntil((route) => route.isFirst);
          setState(() => _current = 0);
          return;
        case 'wallet':
          page = const WalletPage();
          break;
        case 'identity':
          page = const IdentityVerifyPage();
          break;
        case 'chat':
        case 'elf':
          final id = destination.elfId!;
          if (!AppState.instance.elves.any((elf) => elf.id == id)) {
            ScaffoldMessenger.of(context)
                .showSnackBar(const SnackBar(content: Text('通知对应的 AI 暂不可用')));
            return;
          }
          page = destination.route == 'chat'
              ? ElfChatPage(elfId: id)
              : ElfWorksPage(elfId: id);
          break;
      }
      if (page != null) {
        Navigator.of(context).push(MaterialPageRoute(builder: (_) => page!));
      }
    });
    WidgetsBinding.instance.ensureVisualUpdate();
  }

  void _refreshPayments() {
    if (CommerceConfig.android) {
      unawaited(AlipayService.instance.initialize());
    } else {
      unawaited(IosIapService.instance.initialize());
    }
  }

  /// v1.3 站外回流：监听 https://openelfai.com/e/?id=xxx 链接（初始 + 运行中）。
  Future<void> _initAppLinks() async {
    try {
      final appLinks = AppLinks();
      final initial = await appLinks.getInitialLink();
      if (initial != null) unawaited(_handleLink(initial));
      _linkSub = appLinks.uriLinkStream
          .listen((uri) => unawaited(_handleLink(uri)), onError: (_) {});
    } catch (_) {
      // 插件不可用时静默，不影响主流程
    }
  }

  /// 回流计分以服务端结果为准：服务端判定已计过则不提示。
  Future<void> _handleLink(Uri uri) async {
    if (uri.host != 'openelfai.com' || !uri.path.startsWith('/e')) return;
    final id = uri.queryParameters['id'];
    if (id == null || id.isEmpty) return;
    final delta = await AppState.instance.countReferral(id);
    if (delta == null || !mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('一位注视者从站外回流，+$delta 注视'),
        backgroundColor: AppColors.violet,
      ),
    );
  }

  /// 打开 UGC AI 创建流程；创建成功后切到「我」看新 AI。
  Future<void> _openCreate() async {
    final created = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => const CreateElfPage(),
        fullscreenDialog: true,
      ),
    );
    if (created == true && mounted) setState(() => _current = 3);
  }

  void _onNavTap(int i) {
    if (i == 2) {
      _openCreate();
      return;
    }
    setState(() => _current = i < 2 ? i : i - 1);
  }

  @override
  Widget build(BuildContext context) {
    // 桌面宽屏：左侧导航栏 + 宽内容区；窄屏：底部 5 格导航。
    final wide = MediaQuery.sizeOf(context).width > 900;
    if (wide) {
      return Scaffold(
        backgroundColor: AppColors.bg,
        body: Row(
          children: [
            _SideRail(current: _current, onTap: _onNavTap),
            Container(width: 1, color: AppColors.strokeSoft),
            Expanded(child: IndexedStack(index: _current, children: _pages)),
          ],
        ),
      );
    }
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: IndexedStack(index: _current, children: _pages),
      bottomNavigationBar: _BottomBar(current: _current, onTap: _onNavTap),
    );
  }
}

/// 桌面端左侧导航：品牌 + 世界/视频/创建/发现/我。
class _SideRail extends StatelessWidget {
  final int current;
  final ValueChanged<int> onTap;

  const _SideRail({required this.current, required this.onTap});

  @override
  Widget build(BuildContext context) {
    const items = [
      (Icons.public, '世界'),
      (Icons.play_circle_outline, '视频'),
      (Icons.add, '创建'),
      (Icons.explore_outlined, '发现'),
      (Icons.person_outline, '我'),
    ];
    return Container(
      width: 216,
      color: AppColors.navBg,
      padding: const EdgeInsets.fromLTRB(14, 20, 14, 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(10, 0, 0, 22),
            child: Row(
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(32 * 0.222),
                  child: Image.asset('assets/brand/app_icon.png',
                      width: 32, height: 32, fit: BoxFit.cover),
                ),
                const SizedBox(width: 9),
                Text(
                  'OpenElf',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.6,
                    color: AppColors.text,
                  ),
                ),
              ],
            ),
          ),
          ...List.generate(items.length, (i) {
            final (icon, label) = items[i];
            final isCreate = i == 2;
            final pageIndex = i < 2 ? i : i - 1;
            final selected = !isCreate && pageIndex == current;
            return Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: InkWell(
                onTap: () => onTap(i),
                borderRadius: BorderRadius.circular(12),
                child: Container(
                  height: 44,
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(12),
                    gradient: selected ? AppColors.brandGradient : null,
                    color: isCreate
                        ? AppColors.cyan.withOpacity(0.12)
                        : (selected ? null : const Color(0x00000000)),
                  ),
                  child: Row(
                    children: [
                      Icon(
                        icon,
                        size: 19,
                        color: selected
                            ? AppColors.onBrand
                            : (isCreate ? AppColors.cyan : AppColors.textMuted),
                      ),
                      const SizedBox(width: 11),
                      Text(
                        label,
                        style: TextStyle(
                          fontSize: 13.5,
                          fontWeight:
                              selected ? FontWeight.w700 : FontWeight.w500,
                          color: selected
                              ? AppColors.onBrand
                              : (isCreate ? AppColors.cyan : AppColors.textSub),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            );
          }),
          const Spacer(),
          Padding(
            padding: const EdgeInsets.fromLTRB(10, 0, 0, 0),
            child: Text(
              AppContentService.instance.content.value.text('app.brand.slogan'),
              style: TextStyle(fontSize: 11, color: AppColors.textMuted),
            ),
          ),
        ],
      ),
    );
  }
}

class _BottomBar extends StatelessWidget {
  final int current;
  final ValueChanged<int> onTap;

  const _BottomBar({required this.current, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final items = [
      _BarItem(icon: Icons.public, label: '世界', semantics: '世界信息流'),
      _BarItem(
          icon: Icons.play_circle_outline, label: '视频', semantics: 'AI 视频流'),
      _BarItem(icon: Icons.add, label: '创建', semantics: '创建 AI', create: true),
      _BarItem(icon: Icons.explore_outlined, label: '发现', semantics: '发现 AI'),
      _BarItem(icon: Icons.person_outline, label: '我', semantics: '我的主页'),
    ];
    return SafeArea(
      top: false,
      child: Container(
        height: 64,
        decoration: BoxDecoration(
          color: AppColors.navBg,
          border: Border(top: BorderSide(color: AppColors.strokeSoft)),
        ),
        child: Row(
          children: List.generate(items.length, (i) {
            final item = items[i];
            if (item.create) {
              return Expanded(
                child: Semantics(
                  label: item.semantics,
                  button: true,
                  child: InkWell(
                    onTap: () => onTap(i),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Transform.translate(
                          offset: const Offset(0, -9),
                          child: Container(
                            width: 42,
                            height: 42,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              gradient: AppColors.brandGradient,
                              boxShadow: [
                                BoxShadow(
                                  color: AppColors.violet.withOpacity(0.45),
                                  blurRadius: 16,
                                  offset: const Offset(0, 6),
                                ),
                              ],
                            ),
                            child: const Icon(Icons.add,
                                size: 22, color: Colors.white),
                          ),
                        ),
                        Transform.translate(
                          offset: const Offset(0, -7),
                          child: Text(
                            '创建',
                            style: TextStyle(
                              fontSize: 10,
                              fontWeight: FontWeight.w600,
                              color: AppColors.cyan,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              );
            }
            final pageIndex = i < 2 ? i : i - 1;
            final selected = pageIndex == current;
            return Expanded(
              child: Semantics(
                label: item.semantics,
                button: true,
                selected: selected,
                child: InkWell(
                  onTap: () => onTap(i),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Container(
                        padding: const EdgeInsets.all(6),
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(10),
                          gradient: selected ? AppColors.brandGradient : null,
                        ),
                        child: Icon(
                          item.icon,
                          size: 18,
                          color: selected
                              ? AppColors.onBrand
                              : AppColors.textMuted,
                          semanticLabel: item.semantics,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        item.label,
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight:
                              selected ? FontWeight.w600 : FontWeight.w400,
                          color:
                              selected ? AppColors.text : AppColors.textMuted,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            );
          }),
        ),
      ),
    );
  }
}

class _BarItem {
  final IconData icon;
  final String label;
  final String semantics;
  final bool create;
  const _BarItem(
      {required this.icon,
      required this.label,
      required this.semantics,
      this.create = false});
}
