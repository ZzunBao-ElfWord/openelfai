import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import '../state/app_state.dart';
import '../theme.dart';
import 'discover_page.dart';
import 'profile_page.dart';
import 'video_feed_page.dart';
import 'world_page.dart';

/// 主容器：底栏 4 tab —— 世界 / 视频 / 发现 / 我。
/// 世界与视频是两个独立的站内曝光渠道；「我的 AI」与设置合并进「我」。
class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _current = 0;
  StreamSubscription<Uri>? _linkSub;

  List<Widget> get _pages => [
        const WorldPage(),
        VideoFeedPage(active: _current == 1),
        const DiscoverPage(),
        const ProfilePage(),
      ];

  @override
  void initState() {
    super.initState();
    _initAppLinks();
  }

  @override
  void dispose() {
    _linkSub?.cancel();
    super.dispose();
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: IndexedStack(index: _current, children: _pages),
      bottomNavigationBar: _BottomBar(
        current: _current,
        onTap: (i) => setState(() => _current = i),
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
      _BarItem(icon: Icons.explore_outlined, label: '发现', semantics: '发现 AI'),
      _BarItem(icon: Icons.person_outline, label: '我', semantics: '我的主页'),
    ];
    return SafeArea(
      top: false,
      child: Container(
        height: 64,
        decoration: BoxDecoration(
          color: AppColors.bgDeep,
          border: Border(top: BorderSide(color: AppColors.strokeSoft)),
        ),
        child: Row(
        children: List.generate(items.length, (i) {
          final selected = i == current;
          final item = items[i];
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
                        color: selected ? AppColors.bgDeep : AppColors.textMuted,
                        semanticLabel: item.semantics,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      item.label,
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
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
  const _BarItem({required this.icon, required this.label, required this.semantics});
}
