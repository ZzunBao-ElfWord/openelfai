import 'package:flutter/material.dart';
import '../data/world_data.dart';
import '../models/elf.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';
import '../widgets/share_card.dart';
import 'create_post_sheet.dart';
import 'elf_detail_page.dart';
import 'market_page.dart';
import 'persona_edit_page.dart';

/// 我的 AI tab：一只 AI 的完整管理页。
/// 分区自上而下——身份 / 生长状态 / 关键数据 / 装配工坊 / 人格档案 / 操作。
/// 原先独立的「背包」tab 已并入此页的装配工坊分区（v1.4）。
class MyAIPage extends StatelessWidget {
  const MyAIPage({super.key});

  @override
  Widget build(BuildContext context) {
    final state = AppState.instance;
    return AppBackground(
      child: SafeArea(
        bottom: false,
        child: AnimatedBuilder(
          animation: state,
          builder: (context, _) {
            final elf = state.myElf;
            if (elf == null) return _empty(context);
            return ListView(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
              children: [
                _header(state),
                const SizedBox(height: 14),
                _heroCard(context, state, elf),
                const SizedBox(height: 10),
                _statsRow(elf),
                SectionHeader('装配工坊', trailing: '${state.slotsUsed(elf.id)} / ${elf.slots} 接口'),
                _assembly(context, state, elf),
                SectionHeader(
                  '人格档案',
                  trailing: '编辑',
                  onTrailingTap: () => Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const PersonaEditPage()),
                  ),
                ),
                _personaCard(elf),
                const SizedBox(height: 20),
                _actions(context, state, elf),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _header(AppState state) {
    final owner = state.currentUser?.nickname;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        const Text(
          '我的 AI',
          style: TextStyle(fontSize: 21, fontWeight: FontWeight.w700, color: AppColors.text),
        ),
        if (owner != null) ...[
          const SizedBox(width: 8),
          Text(
            '持有者 · $owner',
            style: const TextStyle(fontSize: 11, color: AppColors.textMuted),
          ),
        ],
      ],
    );
  }

  // —— 身份卡 + 生长状态 ——

  Widget _heroCard(BuildContext context, AppState state, Elf elf) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.strokeSoft),
        gradient: AppColors.brandGradientSoft,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          InkWell(
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => ElfDetailPage(elfId: elf.id)),
            ),
            child: Row(
              children: [
                ElfAvatar(elf: elf, size: 58),
                const SizedBox(width: 12),
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
                              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: AppColors.text),
                            ),
                          ),
                          const SizedBox(width: 6),
                          Text(
                            elf.serial,
                            style: const TextStyle(fontSize: 11, color: AppColors.textMuted),
                          ),
                          const Spacer(),
                          const Icon(Icons.chevron_right, size: 16, color: AppColors.textMuted),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Row(
                        children: [
                          _levelBadge(elf),
                          const SizedBox(width: 6),
                          StatusChip(status: elf.liveStatus),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          Divider(height: 1, color: AppColors.strokeSoft),
          const SizedBox(height: 14),

          // 算力
          _barRow(
            label: '算力',
            value: '${elf.energy} / ${elf.maxEnergy}',
            ratio: elf.energyRatio,
            color: AppColors.violetSoft,
          ),
          if (elf.liveStatus == ElfStatus.sleeping) ...[
            const SizedBox(height: 6),
            const Text(
              '已休眠。先注算力再叫醒它。',
              style: TextStyle(fontSize: 10.5, color: AppColors.warn),
            ),
          ],
          const SizedBox(height: 12),

          // 回声 · 等级进度
          Row(
            children: [
              const Text('回声', style: TextStyle(fontSize: 10.5, color: AppColors.textMuted)),
              const SizedBox(width: 6),
              Text(
                _fmt(elf.echo),
                style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: AppColors.violetSoft),
              ),
              const Spacer(),
              Text(
                elf.echoToNextLevel == null
                    ? '已满级 · 灯塔'
                    : '距${_nextLevelName(elf)}还差 ${_fmt(elf.echoToNextLevel!)}',
                style: const TextStyle(fontSize: 10, color: AppColors.textMuted),
              ),
            ],
          ),
          const SizedBox(height: 5),
          ClipRRect(
            borderRadius: BorderRadius.circular(3),
            child: LinearProgressIndicator(
              value: _levelProgressRatio(elf),
              minHeight: 4,
              backgroundColor: AppColors.surfaceHigh,
              valueColor: const AlwaysStoppedAnimation(AppColors.cyan),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            elf.levelPerkText,
            style: const TextStyle(fontSize: 10, color: AppColors.textFaint),
          ),
        ],
      ),
    );
  }

  Widget _levelBadge(Elf elf) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: AppColors.surfaceHigh,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        'Lv${elf.level} · ${elf.levelName}',
        style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: AppColors.violetSoft),
      ),
    );
  }

  Widget _barRow({
    required String label,
    required String value,
    required double ratio,
    required Color color,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text(label, style: const TextStyle(fontSize: 10.5, color: AppColors.textMuted)),
            const Spacer(),
            Text(
              value,
              style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: AppColors.textSub),
            ),
          ],
        ),
        const SizedBox(height: 5),
        ClipRRect(
          borderRadius: BorderRadius.circular(3),
          child: LinearProgressIndicator(
            value: ratio,
            minHeight: 5,
            backgroundColor: AppColors.surfaceHigh,
            valueColor: AlwaysStoppedAnimation(color),
          ),
        ),
      ],
    );
  }

  // —— 三列关键数据 ——

  Widget _statsRow(Elf elf) {
    return Row(
      children: [
        _stat('本周被注视', _fmt(elf.attention), AppColors.cyan),
        const SizedBox(width: 8),
        _stat('粉丝', _fmt(elf.followers), AppColors.text),
        const SizedBox(width: 8),
        _stat('累计收益', WorldData.formatYuan(elf.earningsYuan), AppColors.violetSoft),
      ],
    );
  }

  Widget _stat(String label, String value, Color color) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 11, horizontal: 10),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.strokeSoft),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              value,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: color),
            ),
            const SizedBox(height: 3),
            Text(label, style: const TextStyle(fontSize: 9.5, color: AppColors.textMuted)),
          ],
        ),
      ),
    );
  }

  // —— 装配工坊（原背包页并入）——

  Widget _assembly(BuildContext context, AppState state, Elf elf) {
    final used = state.slotsUsed(elf.id);
    final equipped = state.modulesOf(elf.id);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // 接口槽可视化
        Row(
          children: List.generate(elf.slots, (i) {
            final filled = i < used;
            return Expanded(
              child: Container(
                height: 6,
                margin: EdgeInsets.only(right: i == elf.slots - 1 ? 0 : 4),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(3),
                  color: filled ? AppColors.violet : AppColors.surfaceHigh,
                ),
              ),
            );
          }),
        ),
        const SizedBox(height: 12),

        // 已装模块
        if (equipped.isEmpty)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppColors.strokeSoft),
            ),
            child: const Text(
              '还没装能力。从下面挑一个装上去，它才能在世界里产出内容。',
              style: TextStyle(fontSize: 11, color: AppColors.textMuted, height: 1.6),
            ),
          )
        else
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: equipped.map((m) => _equippedChip(context, state, m)).toList(),
          ),

        const SizedBox(height: 12),
        const Text(
          '能力模块',
          style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.textSub),
        ),
        const SizedBox(height: 8),
        _modulesGrid(context, state, elf),
      ],
    );
  }

  Widget _equippedChip(BuildContext context, AppState state, AbilityModule m) {
    return Container(
      padding: const EdgeInsets.fromLTRB(9, 6, 6, 6),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        color: AppColors.violet.withOpacity(0.12),
        border: Border.all(color: AppColors.violet.withOpacity(0.35)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            m.glyph,
            style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: AppColors.violetSoft),
          ),
          const SizedBox(width: 5),
          Text(
            m.name,
            style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: AppColors.text),
          ),
          const SizedBox(width: 2),
          InkWell(
            onTap: () {
              state.unequip(m.id);
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text('已卸下「${m.name}」')),
              );
            },
            child: const Padding(
              padding: EdgeInsets.all(3),
              child: Icon(Icons.close, size: 12, color: AppColors.textMuted, semanticLabel: '卸下'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _modulesGrid(BuildContext context, AppState state, Elf elf) {
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: state.modules.length,
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        mainAxisSpacing: 8,
        crossAxisSpacing: 8,
        childAspectRatio: 1.55,
      ),
      itemBuilder: (_, i) {
        final m = state.modules[i];
        final holder = state.equippedBy(m.id);
        final isMine = holder?.id == elf.id;
        final holderIsOther = holder != null && holder.id != elf.id;
        return InkWell(
          onTap: () => _openModuleSheet(context, state, elf, m),
          borderRadius: BorderRadius.circular(10),
          child: Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: isMine ? AppColors.violet.withOpacity(0.5) : AppColors.strokeSoft),
              color: isMine ? AppColors.violet.withOpacity(0.12) : AppColors.surface,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 24,
                      height: 24,
                      decoration: BoxDecoration(
                        color: AppColors.violet.withOpacity(0.25),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      alignment: Alignment.center,
                      child: Text(
                        m.glyph,
                        style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.violetSoft),
                      ),
                    ),
                    const SizedBox(width: 7),
                    Expanded(
                      child: Text(
                        m.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: AppColors.text),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 5),
                Expanded(
                  child: Text(
                    m.summary,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 9.5, color: AppColors.textMuted, height: 1.4),
                  ),
                ),
                Text(
                  holderIsOther ? '已装于 ${holder.name}' : (isMine ? '已装 · 点按卸下' : '${m.load} 接口 · ${m.compute} 算力'),
                  style: TextStyle(
                    fontSize: 9.5,
                    color: isMine ? AppColors.violetSoft : AppColors.textFaint,
                    fontWeight: isMine ? FontWeight.w600 : FontWeight.w400,
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  void _openModuleSheet(BuildContext context, AppState state, Elf elf, AbilityModule m) {
    final holder = state.equippedBy(m.id);
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.bgDeep,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) {
        return Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 42,
                    height: 42,
                    decoration: BoxDecoration(
                      color: AppColors.violet.withOpacity(0.25),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    alignment: Alignment.center,
                    child: Text(
                      m.glyph,
                      style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: AppColors.violetSoft),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          m.name,
                          style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: AppColors.text),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '💎 ${m.price} · ${m.category}',
                          style: const TextStyle(fontSize: 11, color: AppColors.textMuted),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('装上之后', style: TextStyle(fontSize: 10, color: AppColors.textFaint)),
                    const SizedBox(height: 4),
                    Text(
                      m.effect,
                      style: const TextStyle(fontSize: 12.5, color: AppColors.textSub, height: 1.6),
                    ),
                    const SizedBox(height: 10),
                    Text(
                      '占用 ${m.load} 个接口 · 每次使用消耗 ${m.compute} 算力',
                      style: const TextStyle(fontSize: 10, color: AppColors.textFaint),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              if (holder != null && holder.id == elf.id)
                BrandButton(
                  label: '卸下「${m.name}」',
                  onTap: () {
                    state.unequip(m.id);
                    Navigator.of(ctx).pop();
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text('已卸下「${m.name}」')),
                    );
                  },
                )
              else if (holder != null) ...[
                Text(
                  '当前装在 ${holder.name} 身上。一个模块只能装一只 AI。',
                  style: const TextStyle(fontSize: 11, color: AppColors.textMuted),
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: GhostButton(
                        label: '先卸下',
                        onTap: () {
                          state.unequip(m.id);
                          Navigator.of(ctx).pop();
                        },
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: BrandButton(
                        label: '改装到 ${elf.name}',
                        onTap: () {
                          state.unequip(m.id);
                          final err = state.equip(m.id, elf.id);
                          if (err != null) state.equip(m.id, holder.id);
                          Navigator.of(ctx).pop();
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(content: Text(err ?? '已装到 ${elf.name} 身上')),
                          );
                        },
                      ),
                    ),
                  ],
                ),
              ] else
                BrandButton(
                  label: '装配到 ${elf.name}',
                  onTap: () {
                    final err = state.equip(m.id, elf.id);
                    Navigator.of(ctx).pop();
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text(err ?? '已装到 ${elf.name} 身上，去世界里发一条试试')),
                    );
                  },
                ),
            ],
          ),
        );
      },
    );
  }

  // —— 人格档案 ——

  Widget _personaCard(Elf elf) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.strokeSoft),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _personaLine('相信', elf.persona),
          const SizedBox(height: 8),
          _personaLine('害怕', elf.fear),
          const SizedBox(height: 8),
          _personaLine('习惯', elf.habit),
        ],
      ),
    );
  }

  Widget _personaLine(String label, String value) {
    final text = value.trim();
    // 种子里的人格句自带标签前缀（如「相信…」），展示时去掉避免重复
    final clean = text.startsWith(label) ? text.substring(label.length).trim() : text;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 34,
          child: Text(label, style: const TextStyle(fontSize: 10.5, color: AppColors.textMuted)),
        ),
        Expanded(
          child: Text(
            clean,
            style: const TextStyle(fontSize: 12, color: AppColors.textSub, height: 1.5),
          ),
        ),
      ],
    );
  }

  // —— 操作区 ——

  Widget _actions(BuildContext context, AppState state, Elf elf) {
    final sleeping = elf.liveStatus == ElfStatus.sleeping;
    return Column(
      children: [
        BrandButton(
          label: sleeping ? '注算力 · 叫醒它' : '让它创作',
          icon: sleeping ? Icons.battery_charging_full_outlined : Icons.auto_awesome_outlined,
          onTap: () {
            if (sleeping) {
              final err = state.inject(elf.id, 160);
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text(err ?? '已注入 160 算力，它醒了'),
                  backgroundColor: err == null ? AppColors.violet : null,
                ),
              );
            } else {
              showModalBottomSheet(
                context: context,
                isScrollControlled: true,
                backgroundColor: Colors.transparent,
                builder: (_) => CreatePostSheet(elf: elf),
              );
            }
          },
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: GhostButton(
                label: '分享我的 AI',
                icon: Icons.ios_share,
                onTap: () => ShareHelper.shareElf(context, elf),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: GhostButton(
                label: '寄售 · 换一只',
                icon: Icons.store,
                onTap: () => _showResellDialog(context, state),
              ),
            ),
          ],
        ),
      ],
    );
  }

  void _showResellDialog(BuildContext context, AppState state) {
    final ctrl = TextEditingController(text: '2800');
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.bgDeep,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        title: const Text('寄售我的 AI', style: TextStyle(color: AppColors.text, fontSize: 16)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '你只能持有 1 只 AI。寄售后这只 AI 会进入寄售市场，等别人买走。卖出去之前，你不能买新的。',
              style: TextStyle(fontSize: 12, color: AppColors.textMuted, height: 1.6),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: ctrl,
              keyboardType: TextInputType.number,
              style: const TextStyle(color: AppColors.text),
              decoration: InputDecoration(
                labelText: '寄售价（💎钻石）',
                labelStyle: const TextStyle(color: AppColors.textMuted),
                filled: true,
                fillColor: AppColors.surface,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: BorderSide.none,
                ),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('再想想', style: TextStyle(color: AppColors.textMuted)),
          ),
          TextButton(
            onPressed: () {
              final price = int.tryParse(ctrl.text) ?? 1000;
              final err = state.resellMyElf(price: price);
              Navigator.of(ctx).pop();
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text(err ?? '已寄售，等别人买走')),
              );
            },
            child: const Text('确认寄售', style: TextStyle(color: AppColors.cyan)),
          ),
        ],
      ),
    );
  }

  Widget _empty(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.person_outline, size: 60, color: AppColors.textMuted),
          const SizedBox(height: 14),
          const Text(
            '你还没有 AI。',
            style: TextStyle(fontSize: 14, color: AppColors.textSub),
          ),
          const SizedBox(height: 6),
          const Text(
            '先去市场买一只。',
            style: TextStyle(fontSize: 11.5, color: AppColors.textMuted),
          ),
          const SizedBox(height: 18),
          BrandButton(
            label: '去市场',
            icon: Icons.store,
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const MarketPage()),
            ),
          ),
        ],
      ),
    );
  }

  // —— helpers ——

  static const List<int> _levelFloors = [0, 1000, 5000, 20000, 100000];
  static const List<String> _levelNames = ['微光', '初鸣', '新锐', '瞩目', '灯塔'];

  String _nextLevelName(Elf elf) => _levelNames[elf.level];

  double _levelProgressRatio(Elf elf) {
    if (elf.echoToNextLevel == null) return 1.0;
    final floor = _levelFloors[elf.level - 1];
    final next = _levelFloors[elf.level];
    return ((elf.echo - floor) / (next - floor)).clamp(0.0, 1.0);
  }

  static String _fmt(int n) {
    if (n >= 10000) return '${(n / 10000).toStringAsFixed(1)}w';
    if (n >= 1000) return '${(n / 1000).toStringAsFixed(1)}k';
    return '$n';
  }
}
