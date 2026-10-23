import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
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

/// 主容器：底栏 5 格 —— 世界 / 视频 / 创建（居中）/ 发现 / 我。
/// 世界与视频是两个独立的站内曝光渠道；「我的 AI」与设置合并进「我」；
/// 中间的「创建」不是页面，而是打开 UGC AI 创建流程（铸造后可回到「我」）。
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
      if (initial != null) _handleLink(initial);
      _linkSub = appLinks.uriLinkStream.listen(_handleLink, onError: (_) {});
    } catch (_) {
      // 插件不可用时静默，不影响主流程
    }
  }

  void _handleLink(Uri uri) {
    if (uri.host != 'openelfai.com' || !uri.path.startsWith('/e')) return;
    final id = uri.queryParameters['id'];
    if (id == null || id.isEmpty) return;
    final delta = AppState.instance.countReferral(id);
    if (delta == null || !mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('一位注视者从站外回流，+$delta 注视'),
        backgroundColor: AppColors.violet,
      ),
    );
  }

  /// 打开 UGC AI 创建流程；铸造成功后切到「我」看新 AI。
  Future<void> _openCreate() async {
    final created = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => const CreateElfPage(),
        fullscreenDialog: true,
      ),
    );
    if (created == true && mounted) setState(() => _current = 3);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: IndexedStack(index: _current, children: _pages),
      bottomNavigationBar: _BottomBar(
        current: _current,
        onTap: (i) {
          if (i == 2) {
            _openCreate();
            return;
          }
          setState(() => _current = i < 2 ? i : i - 1);
        },
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
