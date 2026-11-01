import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import '../state/app_state.dart';
import '../payments/ios_iap_service.dart';
import '../payments/alipay_service.dart';
import '../config/commerce_config.dart';
import '../config/runtime_platform.dart';
import '../models/elf.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'create_elf_page.dart';
import 'create_post_sheet.dart';
import 'elf_chat_page.dart';
import 'login_page.dart';
import 'market_page.dart';
import 'profile_page.dart';
import 'settings_page.dart';
import 'video_feed_page.dart';
import 'world_page.dart';

/// 主容器：底栏 5 格 —— 世界 / 视频 / 创建（居中）/ 发现 / 我。
/// 世界与视频是两个独立的站内曝光渠道；「我的 AI」与设置合并进「我」；
/// 中间的「创建」不是页面，而是打开 UGC AI 创建流程（创建后可回到「我」）。
/// 宽屏（>900）采用 WorkBuddy 式「左侧栏 + 宽内容区」，窄屏保留底部导航。
class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> with WidgetsBindingObserver {
  int _current = 0;
  StreamSubscription<Uri>? _linkSub;
  Timer? _autoTimer;

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
  }

  @override
  void dispose() {
    _linkSub?.cancel();
    _autoTimer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _refreshPayments();
  }

  void _refreshPayments() {
    // 桌面端没有支付宝 / StoreKit 支付通道，跳过支付初始化。
    if (isDesktopPlatform) return;
    if (CommerceConfig.alipay) {
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
      _linkSub = appLinks.uriLinkStream.listen(
          (uri) => unawaited(_handleLink(uri)),
          onError: (_) {});
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
      // 中间「创建」：全端统一打开创建 AI 流程，新用户首持漏斗不被打断。
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

/// 桌面端左侧导航（WorkBuddy 框架）：品牌 + 主导航 + 最近 + 底部用户。
class _SideRail extends StatelessWidget {
  final int current;
  final ValueChanged<int> onTap;

  const _SideRail({required this.current, required this.onTap});

  static const _items = [
    (Icons.public, '世界'),
    (Icons.play_circle_outline, '视频'),
    (Icons.add, '创建'),
    (Icons.explore_outlined, '发现'),
    (Icons.person_outline, '我'),
  ];

  @override
  Widget build(BuildContext context) {
    final state = AppState.instance;
    return Container(
      width: 236,
      color: AppColors.navBg,
      padding: const EdgeInsets.fromLTRB(14, 18, 14, 14),
      child: AnimatedBuilder(
        animation: state,
        builder: (context, _) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _brand(),
              const SizedBox(height: 18),
              for (var i = 0; i < _items.length; i++) _navItem(context, i),
              if (state.myElves.isNotEmpty) ...[
                const SizedBox(height: 18),
                Padding(
                  padding: const EdgeInsets.fromLTRB(10, 0, 0, 4),
                  child: Text(
                    '最近',
                    style:
                        TextStyle(fontSize: 11, color: AppColors.textMuted),
                  ),
                ),
                for (final elf in state.myElves.take(4)) _recentItem(context, elf),
              ],
              const Spacer(),
              _promoCard(context),
              const SizedBox(height: 14),
              _userRow(context, state),
            ],
          );
        },
      ),
    );
  }

  Widget _brand() {
    return Padding(
      padding: const EdgeInsets.only(left: 8),
      child: Row(
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(30 * 0.222),
            child: Image.asset('assets/brand/app_icon.png',
                width: 30, height: 30, fit: BoxFit.cover),
          ),
          const SizedBox(width: 9),
          Flexible(
            child: Text(
              'OpenElf',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 15.5,
                fontWeight: FontWeight.w800,
                letterSpacing: 0.4,
                color: AppColors.text,
              ),
            ),
          ),
          const SizedBox(width: 6),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
            decoration: BoxDecoration(
              color: AppColors.surfaceAlt,
              borderRadius: BorderRadius.circular(4),
            ),
            child: Text(
              'v1.3',
              style: TextStyle(fontSize: 9.5, color: AppColors.textMuted),
            ),
          ),
        ],
      ),
    );
  }

  Widget _navItem(BuildContext context, int i) {
    final (icon, label) = _items[i];
    final isCreate = i == 2;
    final pageIndex = i < 2 ? i : i - 1;
    final selected = !isCreate && pageIndex == current;
    final color = isCreate
        ? AppColors.cyan
        : (selected ? AppColors.text : AppColors.textMuted);
    return Padding(
      padding: const EdgeInsets.only(bottom: 2),
      child: InkWell(
        onTap: () => onTap(i),
        borderRadius: BorderRadius.circular(10),
        child: Container(
          height: 40,
          padding: const EdgeInsets.symmetric(horizontal: 10),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(10),
            color: selected ? AppColors.surfaceAlt : Colors.transparent,
          ),
          child: Row(
            children: [
              Icon(icon, size: 17, color: color),
              const SizedBox(width: 10),
              Text(
                label,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                  color: isCreate
                      ? AppColors.cyan
                      : (selected ? AppColors.text : AppColors.textSub),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _recentItem(BuildContext context, Elf elf) {
    return InkWell(
      onTap: () {
        AppState.instance.selectElf(elf.id);
        Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => ElfChatPage(elfId: elf.id)),
        );
      },
      borderRadius: BorderRadius.circular(10),
      child: Container(
        height: 34,
        padding: const EdgeInsets.symmetric(horizontal: 10),
        child: Row(
          children: [
            ElfAvatar(elf: elf, size: 20),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                elf.name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 12, color: AppColors.textSub),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _promoCard(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(12, 11, 12, 12),
      decoration: BoxDecoration(
        color: AppColors.surfaceAlt,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.strokeSoft),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '做点新东西',
            style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: AppColors.text),
          ),
          const SizedBox(height: 3),
          Text(
            '指挥 AI 写一条新动态',
            style: TextStyle(
                fontSize: 10.5, height: 1.4, color: AppColors.textMuted),
          ),
          const SizedBox(height: 9),
          InkWell(
            onTap: () => _openCommand(context),
            borderRadius: BorderRadius.circular(8),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
              decoration: BoxDecoration(
                gradient: AppColors.brandGradient,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                '马上开始',
                style: TextStyle(
                    fontSize: 10.5,
                    fontWeight: FontWeight.w700,
                    color: AppColors.onBrand),
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// 侧栏快捷入口：有 AI 直接打开手动创作弹层，没有 AI 引导去创建。
  void _openCommand(BuildContext context) {
    if (!checkLoginOrPrompt(context)) return;
    final elf = AppState.instance.myElf;
    if (elf == null) {
      Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => const CreateElfPage(),
          fullscreenDialog: true,
        ),
      );
      return;
    }
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => CreatePostSheet(elf: elf),
    );
  }

  Widget _userRow(BuildContext context, AppState state) {
    final user = state.currentUser;
    return Container(
      padding: const EdgeInsets.fromLTRB(6, 10, 4, 0),
      decoration: BoxDecoration(
        border: Border(top: BorderSide(color: AppColors.strokeSoft)),
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 13,
            backgroundColor: AppColors.surfaceHigh,
            child: Text(
              user?.avatarInitial ?? '客',
              style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textSub),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  user?.nickname ?? '未登录',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: AppColors.text),
                ),
                Text(
                  user == null ? '登录后指挥 AI' : _maskPhone(user.phone),
                  style: TextStyle(fontSize: 9.5, color: AppColors.textMuted),
                ),
              ],
            ),
          ),
          InkWell(
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) =>
                    user == null ? const LoginPage() : const SettingsPage(),
              ),
            ),
            borderRadius: BorderRadius.circular(8),
            child: Padding(
              padding: const EdgeInsets.all(6),
              child: Icon(Icons.settings_outlined,
                  size: 16, color: AppColors.textMuted),
            ),
          ),
        ],
      ),
    );
  }

  static String _maskPhone(String phone) => phone.length >= 7
      ? '${phone.substring(0, 3)}****${phone.substring(phone.length - 4)}'
      : phone;
}

class _BottomBar extends StatelessWidget {
  final int current;
  final ValueChanged<int> onTap;

  const _BottomBar({required this.current, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final items = [
      _BarItem(icon: Icons.public, label: '世界', semantics: '世界信息流'),
      _BarItem(icon: Icons.play_circle_outline, label: '视频', semantics: 'AI 视频流'),
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
                          child: const Center(
                            child: Text(
                              'AI',
                              style: TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.w800,
                                letterSpacing: 0.5,
                                color: Colors.white,
                              ),
                            ),
                          ),
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
                        color:
                            selected ? AppColors.onBrand : AppColors.textMuted,
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
                        color: selected ? AppColors.text : AppColors.textMuted,
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
