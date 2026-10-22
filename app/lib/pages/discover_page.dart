import 'package:flutter/material.dart';
import '../models/elf.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'attention_board_page.dart';
import 'elf_chat_page.dart';
import 'market_page.dart';

/// 「发现」tab：搜索 AI、看向榜单、进入市场。
class DiscoverPage extends StatefulWidget {
  const DiscoverPage({super.key});

  @override
  State<DiscoverPage> createState() => _DiscoverPageState();
}

class _DiscoverPageState extends State<DiscoverPage> {
  final TextEditingController _search = TextEditingController();
  String _q = '';

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = AppState.instance;
    return AppBackground(
      child: SafeArea(
        bottom: false,
        child: AnimatedBuilder(
          animation: state,
          builder: (context, _) {
            final ranked = state.attentionRanked;
            final results = _q.isEmpty
                ? ranked
                : ranked
                    .where((e) =>
                        e.name.contains(_q) || e.persona.contains(_q) || e.ownerLabel.contains(_q))
                    .toList();
            return ListView(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 28),
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    const Text(
                      '发现',
                      style: TextStyle(fontSize: 21, fontWeight: FontWeight.w700, color: AppColors.text),
                    ),
                    const SizedBox(width: 8),
                    const Padding(
                      padding: EdgeInsets.only(bottom: 2),
                      child: Text(
                        '找到值得被注视的 AI',
                        style: TextStyle(fontSize: 11, color: AppColors.textMuted),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                _searchBox(),
                if (_q.isNotEmpty) ...[
                  const SizedBox(height: 14),
                  SectionHeader('搜索结果', trailing: '${results.length} 只'),
                  if (results.isEmpty)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 24),
                      child: Center(
                        child: Text(
                          '没找到。换个名字或人格关键词试试。',
                          style: TextStyle(fontSize: 12, color: AppColors.textMuted),
                        ),
                      ),
                    )
                  else
                    ...results.map((e) => _elfRow(e, ranked.indexOf(e) + 1)),
                ] else ...[
                  const SizedBox(height: 16),
                  _entryCards(context, state),
                  const SizedBox(height: 20),
                  SectionHeader('被注视的 AI', trailing: '按本周注视'),
                  const SizedBox(height: 10),
                  _spotlight(state, ranked),
                  const SizedBox(height: 20),
                  SectionHeader('全部 AI'),
                  ...ranked.asMap().entries.map((e) => _elfRow(e.value, e.key + 1)),
                ],
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _searchBox() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: AppColors.strokeSoft),
      ),
      child: Row(
        children: [
          const Icon(Icons.search, size: 18, color: AppColors.textMuted),
          const SizedBox(width: 6),
          Expanded(
            child: TextField(
              controller: _search,
              style: const TextStyle(fontSize: 13, color: AppColors.text),
              onChanged: (v) => setState(() => _q = v.trim()),
              decoration: const InputDecoration(
                isDense: true,
                border: InputBorder.none,
                hintText: '搜索 AI 名字、人格或持有者…',
                hintStyle: TextStyle(fontSize: 13, color: AppColors.textMuted),
                contentPadding: EdgeInsets.symmetric(vertical: 11),
              ),
            ),
          ),
          if (_q.isNotEmpty)
            InkWell(
              onTap: () {
                _search.clear();
                setState(() => _q = '');
              },
              child: const Padding(
                padding: EdgeInsets.all(4),
                child: Icon(Icons.close, size: 15, color: AppColors.textMuted, semanticLabel: '清空搜索'),
              ),
            ),
        ],
      ),
    );
  }

  // —— 榜单 / 市场入口 ——

  Widget _entryCards(BuildContext context, AppState state) {
    final top = state.attentionRanked.take(3).toList();
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
        Expanded(
          child: InkWell(
            borderRadius: BorderRadius.circular(14),
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const AttentionBoardPage()),
            ),
            child: Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: AppColors.strokeSoft),
                gradient: AppColors.brandGradientSoft,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.leaderboard_outlined, size: 16, color: AppColors.cyan),
                      const SizedBox(width: 6),
                      const Text(
                        '注视流向榜',
                        style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: AppColors.text),
                      ),
                      const Spacer(),
                      const Icon(Icons.chevron_right, size: 16, color: AppColors.textMuted),
                    ],
                  ),
                  const SizedBox(height: 10),
                  ...top.asMap().entries.map((e) => Padding(
                        padding: const EdgeInsets.only(bottom: 5),
                        child: Row(
                          children: [
                            Text(
                              '${e.key + 1}',
                              style: TextStyle(
                                fontSize: 10,
                                fontWeight: FontWeight.w700,
                                color: e.key == 0 ? AppColors.cyan : AppColors.textMuted,
                              ),
                            ),
                            const SizedBox(width: 6),
                            Expanded(
                              child: Text(
                                e.value.name,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(fontSize: 11, color: AppColors.textSub),
                              ),
                            ),
                            Text(
                              _fmt(e.value.attention),
                              style: const TextStyle(fontSize: 9.5, color: AppColors.textMuted),
                            ),
                          ],
                        ),
                      )),
                ],
              ),
            ),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: InkWell(
            borderRadius: BorderRadius.circular(14),
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const MarketPage()),
            ),
            child: Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: AppColors.strokeSoft),
                color: AppColors.surface.withOpacity(0.6),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.storefront_outlined, size: 16, color: AppColors.violetSoft),
                      const SizedBox(width: 6),
                      const Text(
                        'AI 市场',
                        style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: AppColors.text),
                      ),
                      const Spacer(),
                      const Icon(Icons.chevron_right, size: 16, color: AppColors.textMuted),
                    ],
                  ),
                  const SizedBox(height: 10),
                  const Text(
                    '买一只新的 AI\n或从寄售里捡漏',
                    style: TextStyle(fontSize: 10.5, color: AppColors.textMuted, height: 1.6),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    '${state.primaryListings.length + state.secondaryListings.length} 只在售',
                    style: const TextStyle(fontSize: 10, color: AppColors.violetSoft),
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
      ),
    );
  }

  // —— 横向卡片 ——

  Widget _spotlight(AppState state, List<Elf> ranked) {
    final list = ranked.take(6).toList();
    return SizedBox(
      height: 156,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: list.length,
        separatorBuilder: (_, __) => const SizedBox(width: 10),
        itemBuilder: (_, i) {
          final elf = list[i];
          return InkWell(
            borderRadius: BorderRadius.circular(14),
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => ElfChatPage(elfId: elf.id)),
            ),
            child: Container(
              width: 132,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: AppColors.strokeSoft),
                color: AppColors.surface.withOpacity(0.6),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      ElfAvatar(elf: elf, size: 40),
                      const Spacer(),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: AppColors.violet.withOpacity(0.16),
                          borderRadius: BorderRadius.circular(5),
                        ),
                        child: Text(
                          'Lv${elf.level}',
                          style: const TextStyle(fontSize: 9, color: AppColors.violetSoft),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    elf.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.text),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    elf.persona,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 9.5, color: AppColors.textMuted, height: 1.4),
                  ),
                  const Spacer(),
                  Row(
                    children: [
                      const Icon(Icons.remove_red_eye_outlined, size: 11, color: AppColors.textMuted),
                      const SizedBox(width: 3),
                      Text(
                        _fmt(elf.attention),
                        style: const TextStyle(fontSize: 9.5, color: AppColors.textMuted),
                      ),
                      const SizedBox(width: 8),
                      Flexible(
                        child: Text(
                          elf.ownerLabel,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 9, color: AppColors.textFaint),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  // —— 排行行 ——

  Widget _elfRow(Elf elf, int rank) {
    final followed = AppState.instance.isFollowed(elf.id);
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => ElfChatPage(elfId: elf.id)),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 9),
        child: Row(
          children: [
            SizedBox(
              width: 22,
              child: Text(
                '$rank',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  color: rank <= 3 ? AppColors.cyan : AppColors.textFaint,
                ),
              ),
            ),
            const SizedBox(width: 4),
            ElfAvatar(elf: elf, size: 38),
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
                          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.text),
                        ),
                      ),
                      const SizedBox(width: 5),
                      Text(
                        elf.serial,
                        style: const TextStyle(fontSize: 9.5, color: AppColors.textFaint),
                      ),
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text(
                    elf.persona,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 10.5, color: AppColors.textMuted),
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
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.textSub),
                ),
                const SizedBox(height: 2),
                const Text('本周注视', style: TextStyle(fontSize: 8.5, color: AppColors.textFaint)),
              ],
            ),
            if (!elf.isMine) ...[
              const SizedBox(width: 8),
              InkWell(
                onTap: () => AppState.instance.toggleFollow(elf.id),
                borderRadius: BorderRadius.circular(12),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                      color: followed ? AppColors.violet.withOpacity(0.5) : AppColors.strokeSoft,
                    ),
                    color: followed ? AppColors.violet.withOpacity(0.16) : Colors.transparent,
                  ),
                  child: Text(
                    followed ? '已关注' : '关注',
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                      color: followed ? AppColors.violetSoft : AppColors.textMuted,
                    ),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  static String _fmt(int n) {
    if (n >= 10000) return '${(n / 10000).toStringAsFixed(1)}w';
    if (n >= 1000) return '${(n / 1000).toStringAsFixed(1)}k';
    return '$n';
  }
}
