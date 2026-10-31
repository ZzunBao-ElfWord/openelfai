import 'package:flutter/material.dart';

import '../config/api_config.dart';
import '../models/elf.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';
import '../widgets/workbench_panel.dart';
import 'character_studio_page.dart';
import 'create_elf_page.dart';
import 'elf_console_page.dart';
import 'login_page.dart';

/// 「我的 AI」页：列表式陈列持有的智能体。
/// 每一行是一只 AI（封面 + 名称 + 编号等级），点进去是它的控制台；
/// 底部单独一行进入创建流程。
class MyElvesPage extends StatelessWidget {
  const MyElvesPage({super.key});

  void _push(BuildContext context, Widget page) {
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => page));
  }

  @override
  Widget build(BuildContext context) {
    final state = AppState.instance;
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: AppBackground(
        child: SafeArea(
          bottom: false,
          child: AnimatedBuilder(
            animation: state,
            builder: (context, _) {
              final elves = state.myElves;
              return WideContent(
                maxWidth: 760,
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 28),
                  children: [
                    _header(context),
                    const SizedBox(height: 12),
                    if (elves.isEmpty) ...[
                      Text(
                        '你还没有 AI 智能体，先创建一只吧。',
                        style: TextStyle(
                            fontSize: 11.5, color: AppColors.textMuted),
                      ),
                      const SizedBox(height: 12),
                    ],
                    _card([
                      for (final elf in elves) _elfRow(context, elf),
                    ]),
                    const SizedBox(height: 14),
                    _card([
                      _createRow(context),
                    ]),
                    // 形象工坊的手机端入口：与桌面技能面板同一套
                    // 「生成须知确认 → 对话式工坊」流程。
                    if (elves.isNotEmpty) ...[
                      const SizedBox(height: 14),
                      _card([
                        _studioRow(context),
                      ]),
                    ],
                  ],
                ),
              );
            },
          ),
        ),
      ),
    );
  }

  Widget _header(BuildContext context) {
    return Row(
      children: [
        IconButton(
          padding: const EdgeInsets.only(left: 2),
          alignment: Alignment.centerLeft,
          onPressed: () => Navigator.of(context).pop(),
          icon: Icon(Icons.arrow_back_ios_new,
              size: 17, color: AppColors.textSub),
        ),
        const Spacer(),
        Text(
          '我的 AI',
          style: TextStyle(
            fontSize: 17,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.5,
            color: AppColors.text,
          ),
        ),
        const Spacer(),
        const SizedBox(width: 44),
      ],
    );
  }

  Widget _card(List<Widget> rows) {
    if (rows.isEmpty) return const SizedBox.shrink();
    return Material(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(16),
      clipBehavior: Clip.antiAlias,
      child: Column(mainAxisSize: MainAxisSize.min, children: rows),
    );
  }

  Widget _elfRow(BuildContext context, Elf elf) {
    final url = ApiConfig.resolveAssetUrl(
      elf.imageUrl ?? elf.imageThumbUrl ?? elf.avatarUrl,
    );
    return InkWell(
      onTap: () => _push(context, ElfConsolePage(elfId: elf.id)),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 13),
        child: Row(
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(10),
              child: SizedBox(
                width: 42,
                height: 42,
                child: url == null
                    ? _initialArt(elf)
                    : Image.network(
                        url,
                        fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) => _initialArt(elf),
                      ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    elf.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w500,
                      color: AppColors.text,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '${elf.serial} · Lv${elf.level}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style:
                        TextStyle(fontSize: 10.5, color: AppColors.textMuted),
                  ),
                ],
              ),
            ),
            Icon(Icons.chevron_right, size: 20, color: AppColors.textMuted),
          ],
        ),
      ),
    );
  }

  Widget _createRow(BuildContext context) {
    return InkWell(
      onTap: () => _push(context, const CreateElfPage()),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
        child: Row(
          children: [
            Icon(Icons.add, size: 19, color: AppColors.textSub),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                '创建新的 AI',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w500,
                  color: AppColors.text,
                ),
              ),
            ),
            Icon(Icons.chevron_right, size: 20, color: AppColors.textMuted),
          ],
        ),
      ),
    );
  }

  /// 形象工坊：先过生成须知的逐条确认（合规闸门与桌面一致），再进对话式工坊。
  Future<void> _openStudio(BuildContext context) async {
    if (!checkLoginOrPrompt(context)) return;
    if (!await WorkbenchPanel.confirmStudioPolicy(context)) return;
    if (!context.mounted) return;
    _push(context, const CharacterStudioPage());
  }

  Widget _studioRow(BuildContext context) {
    return InkWell(
      onTap: () => _openStudio(context),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
        child: Row(
          children: [
            Icon(Icons.palette_outlined, size: 19, color: AppColors.textSub),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                '形象工坊',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w500,
                  color: AppColors.text,
                ),
              ),
            ),
            Text(
              '免费预览',
              style: TextStyle(fontSize: 10.5, color: AppColors.textMuted),
            ),
            const SizedBox(width: 4),
            Icon(Icons.chevron_right, size: 20, color: AppColors.textMuted),
          ],
        ),
      ),
    );
  }

  Widget _initialArt(Elf elf) {
    return Container(
      decoration: BoxDecoration(gradient: AppColors.brandGradient),
      alignment: Alignment.center,
      child: Text(
        elf.initial,
        style: TextStyle(
          fontSize: 17,
          fontWeight: FontWeight.w700,
          color: AppColors.onBrand,
        ),
      ),
    );
  }
}
