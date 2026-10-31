import 'package:flutter/material.dart';

import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'api_key_page.dart';
import 'bookshelf_page.dart';
import 'create_elf_page.dart';
import 'elf_console_page.dart';
import 'market_page.dart';

/// 「发现」页（WorkBuddy 式资源中心）：
/// 顶部居中标题，下面按资源类型分组，每组是一张圆角卡片，
/// 卡片里是「图标 + 名称 + 箭头」的入口行。
/// 充值入口不在这里，统一收敛到「我」里的钱包。
class DiscoverPage extends StatelessWidget {
  const DiscoverPage({super.key});

  void _push(BuildContext context, Widget page) {
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => page));
  }

  /// 项目 = 你的 AI 项目控制台；还没有 AI 时先去创建。
  void _openProject(BuildContext context) {
    final elf = AppState.instance.myElf;
    if (elf == null) {
      _push(
        context,
        const CreateElfPage(),
      );
      return;
    }
    _push(context, ElfConsolePage(elfId: elf.id));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: AppBackground(
        child: SafeArea(
          bottom: false,
          child: WideContent(
            maxWidth: 760,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 18, 16, 28),
              children: [
                Center(
                  child: Text(
                    '发现',
                    style: TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w600,
                      letterSpacing: 0.5,
                      color: AppColors.text,
                    ),
                  ),
                ),
                const SizedBox(height: 20),
                _group([
                  _row(
                    context,
                    Icons.folder_open_outlined,
                    '资料库',
                    () => _push(context, const BookshelfPage()),
                  ),
                ]),
                const SizedBox(height: 14),
                _group([
                  _row(
                    context,
                    Icons.psychology_outlined,
                    '专家',
                    () => _push(
                        context,
                        const MarketPage(
                          title: '专家',
                          initialTab: 0,
                        )),
                  ),
                  _row(
                    context,
                    Icons.handyman_outlined,
                    '技能',
                    () => _push(
                        context,
                        const MarketPage(
                          title: '技能',
                          initialTab: 1,
                        )),
                  ),
                  _row(
                    context,
                    Icons.hub_outlined,
                    '连接器',
                    () => _push(context, const ApiKeyPage()),
                  ),
                ]),
                const SizedBox(height: 14),
                _group([
                  _row(
                    context,
                    Icons.workspaces_outline,
                    '项目',
                    () => _openProject(context),
                  ),
                ]),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _group(List<Widget> rows) {
    return Material(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(16),
      clipBehavior: Clip.antiAlias,
      child: Column(mainAxisSize: MainAxisSize.min, children: rows),
    );
  }

  Widget _row(
    BuildContext context,
    IconData icon,
    String label,
    VoidCallback onTap,
  ) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
        child: Row(
          children: [
            Icon(icon, size: 19, color: AppColors.textSub),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                label,
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w500,
                  color: AppColors.text,
                ),
              ),
            ),
            Icon(Icons.chevron_right,
                size: 20, color: AppColors.textMuted),
          ],
        ),
      ),
    );
  }
}
