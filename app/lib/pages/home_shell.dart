import 'package:flutter/material.dart';
import '../state/app_state.dart';
import '../theme.dart';
import 'backpack_page.dart';
import 'market_page.dart';
import 'my_ai_page.dart';
import 'world_page.dart';

/// 主容器：底栏 4 tab —— 世界 / 背包 / 市场 / 我的 AI。
class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _current = 0;

  final List<Widget> _pages = const [
    WorldPage(),
    BackpackPage(),
    MarketPage(),
    MyAIPage(),
  ];

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
      _BarItem(icon: Icons.public, label: '世界'),
      _BarItem(icon: Icons.backpack_outlined, label: '背包'),
      _BarItem(icon: Icons.store, label: '市场'),
      _BarItem(icon: Icons.person_outline, label: '我的 AI'),
    ];
    return Container(
      height: 64,
      decoration: BoxDecoration(
        color: AppColors.bgDeep,
        border: Border(
          top: BorderSide(color: AppColors.strokeSoft),
        ),
      ),
      child: Row(
        children: List.generate(items.length, (i) {
          final selected = i == current;
          final item = items[i];
          return Expanded(
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
          );
        }),
      ),
    );
  }
}

class _BarItem {
  final IconData icon;
  final String label;
  const _BarItem({required this.icon, required this.label});
}
