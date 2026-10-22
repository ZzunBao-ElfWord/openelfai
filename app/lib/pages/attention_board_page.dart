import 'package:flutter/material.dart';
import '../models/elf.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'elf_detail_page.dart';

/// 「此刻世界在注视谁」榜单页：总流向榜 + 新星流向榜。
/// 数据来自 AppState.attentionRanked / risingRanked，按本周注视降序。
class AttentionBoardPage extends StatefulWidget {
  const AttentionBoardPage({super.key});

  @override
  State<AttentionBoardPage> createState() => _AttentionBoardPageState();
}

class _AttentionBoardPageState extends State<AttentionBoardPage> {
  /// 0 = 总流向，1 = 新星流向。
  int _segment = 0;

  /// 榜单展示的位数；之外的我的 AI 会在底部固定显示名次。
  static const _boardSize = 20;

  @override
  Widget build(BuildContext context) {
    final state = AppState.instance;
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: AppBackground(
        child: SafeArea(
          child: AnimatedBuilder(
            animation: state,
            builder: (context, _) {
              final ranked =
                  _segment == 0 ? state.attentionRanked : state.risingRanked;
              final shown = ranked.take(_boardSize).toList();
              final mine = state.myElf;
              final mineOnBoard = mine != null && shown.contains(mine);
              return Column(
                children: [
                  _header(context),
                  _segmentSwitcher(),
                  const SizedBox(height: 6),
                  Expanded(
                    child: shown.isEmpty
                        ? const Center(
                            child: Text(
                              '这个分段还没有 AI。',
                              style: TextStyle(
                                  fontSize: 12, color: AppColors.textMuted),
                            ),
                          )
                        : ListView.separated(
                            padding:
                                const EdgeInsets.fromLTRB(14, 4, 14, 16),
                            itemCount: shown.length,
                            separatorBuilder: (_, __) =>
                                const SizedBox(height: 8),
                            itemBuilder: (_, i) =>
                                _row(state, shown[i], i + 1),
                          ),
                  ),
                  if (mine != null && !mineOnBoard)
                    _mineFooter(mine, ranked, shown),
                ],
              );
            },
          ),
        ),
      ),
    );
  }

  Widget _header(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 6, 16, 6),
      child: Row(
        children: [
          IconButton(
            icon: const Icon(Icons.arrow_back_ios_new,
                size: 17, color: AppColors.text),
            onPressed: () => Navigator.of(context).pop(),
          ),
          const Expanded(
            child: Text(
              '此刻世界在注视谁',
              style: TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w700,
                color: AppColors.text,
              ),
            ),
          ),
          const Text(
            '按本周注视',
            style: TextStyle(fontSize: 10.5, color: AppColors.textMuted),
          ),
        ],
      ),
    );
  }

  Widget _segmentSwitcher() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: SegmentedButton<int>(
        showSelectedIcon: false,
        style: ButtonStyle(
          visualDensity: VisualDensity.compact,
          side: WidgetStateProperty.all(
              const BorderSide(color: AppColors.strokeSoft)),
          backgroundColor: WidgetStateProperty.resolveWith(
            (states) => states.contains(WidgetState.selected)
                ? AppColors.cyan.withOpacity(0.15)
                : Colors.transparent,
          ),
          foregroundColor: WidgetStateProperty.resolveWith(
            (states) => states.contains(WidgetState.selected)
                ? AppColors.cyan
                : AppColors.textMuted,
          ),
          textStyle: WidgetStateProperty.all(
            const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
          ),
        ),
        segments: const [
          ButtonSegment(value: 0, label: Text('总流向')),
          ButtonSegment(value: 1, label: Text('新星流向')),
        ],
        selected: {_segment},
        onSelectionChanged: (s) => setState(() => _segment = s.first),
      ),
    );
  }

  Widget _row(AppState state, Elf elf, int rank) {
    final isMine = elf.isMine;
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => ElfDetailPage(elfId: elf.id)),
      ),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(12),
          color: isMine
              ? AppColors.cyan.withOpacity(0.06)
              : AppColors.surface.withOpacity(0.5),
          border: Border.all(
            color: isMine
                ? AppColors.cyan.withOpacity(0.6)
                : AppColors.strokeSoft,
          ),
        ),
        child: Row(
          children: [
            SizedBox(
              width: 26,
              child: Text(
                '$rank',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: rank <= 3 ? 15 : 12,
                  fontWeight: FontWeight.w800,
                  color: rank == 1
                      ? AppColors.cyan
                      : rank <= 3
                          ? AppColors.violetSoft
                          : AppColors.textMuted,
                ),
              ),
            ),
            const SizedBox(width: 10),
            ElfAvatar(elf: elf, size: 34),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Flexible(
                        child: Text(
                          elf.name,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                            color: AppColors.text,
                          ),
                        ),
                      ),
                      const SizedBox(width: 5),
                      Text(
                        elf.serial,
                        style: const TextStyle(
                            fontSize: 9.5, color: AppColors.textMuted),
                      ),
                      const SizedBox(width: 6),
                      _levelBadge(elf),
                    ],
                  ),
                  const SizedBox(height: 3),
                  Text(
                    '粉丝 ${_fmt(elf.followers)}',
                    style: const TextStyle(
                        fontSize: 10, color: AppColors.textMuted),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  _fmt(elf.attention),
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w800,
                    color: AppColors.cyan,
                  ),
                ),
                const Text(
                  '本周注视',
                  style:
                      TextStyle(fontSize: 9, color: AppColors.textMuted),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _levelBadge(Elf elf) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1.5),
      decoration: BoxDecoration(
        color: AppColors.violet.withOpacity(0.2),
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: AppColors.violet.withOpacity(0.4)),
      ),
      child: Text(
        'Lv${elf.level} ${elf.levelName}',
        style: const TextStyle(
          fontSize: 8.5,
          fontWeight: FontWeight.w600,
          color: AppColors.violetSoft,
        ),
      ),
    );
  }

  /// 我的 AI 没上榜时，底部固定一行显示名次与差距。
  Widget _mineFooter(Elf mine, List<Elf> ranked, List<Elf> shown) {
    final rank = ranked.indexOf(mine) + 1;
    final gap = shown.isEmpty
        ? 1
        : (shown.last.attention - mine.attention + 1).clamp(1, 1 << 31);
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 14),
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: AppColors.strokeSoft)),
      ),
      child: Row(
        children: [
          ElfAvatar(elf: mine, size: 26),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              '你的 AI 本周第 $rank · 还差 $gap 注视上榜',
              style: const TextStyle(
                fontSize: 11.5,
                fontWeight: FontWeight.w600,
                color: AppColors.cyan,
              ),
            ),
          ),
        ],
      ),
    );
  }

  static String _fmt(int n) {
    if (n >= 10000) return '${(n / 10000).toStringAsFixed(1)}w';
    if (n >= 1000) return '${(n / 1000).toStringAsFixed(1)}k';
    return '$n';
  }
}
