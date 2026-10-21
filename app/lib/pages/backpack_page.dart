import 'package:flutter/material.dart';
import '../models/elf.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';

/// 背包 tab：为我的 AI 组装能力。一人只能持 1 只。
class BackpackPage extends StatelessWidget {
  const BackpackPage({super.key});

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
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
              children: [
                _header(),
                const SizedBox(height: 14),
                _equipment(state, elf),
                const SizedBox(height: 10),
                Text(
                  '能力模块',
                  style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.text),
                ),
                const SizedBox(height: 10),
                _modulesGrid(context, state, elf),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _empty(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.backpack_outlined, size: 56, color: AppColors.textMuted),
          const SizedBox(height: 14),
          const Text(
            '背包是空的。',
            style: TextStyle(fontSize: 14, color: AppColors.textSub),
          ),
          const SizedBox(height: 6),
          const Text(
            '先去市场买一只 AI，然后才能给它装能力。',
            style: TextStyle(fontSize: 11.5, color: AppColors.textMuted),
          ),
          const SizedBox(height: 18),
          GhostButton(
            label: '去市场',
            onTap: () => DefaultTabController.of(context)?.animateTo(2),
          ),
        ],
      ),
    );
  }

  Widget _header() {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: const [
        Text(
          '背包',
          style: TextStyle(fontSize: 21, fontWeight: FontWeight.w700, color: AppColors.text),
        ),
        SizedBox(width: 8),
        Text(
          '我的 AI，我做主',
          style: TextStyle(fontSize: 11, color: AppColors.textMuted),
        ),
      ],
    );
  }

  Widget _equipment(AppState state, Elf elf) {
    final used = state.slotsUsed(elf.id);
    final modules = state.modulesOf(elf.id);
    final remaining = elf.slots - used;

    return Container(
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
              ElfAvatar(elf: elf, size: 46),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${elf.name} ${elf.serial}',
                      style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.text),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '我的 AI · 第 ${elf.generation} 代 · ${elf.edition}',
                      style: const TextStyle(fontSize: 10.5, color: AppColors.textMuted),
                    ),
                  ],
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  const Text('接口', style: TextStyle(fontSize: 10, color: AppColors.textMuted)),
                  Text(
                    '$used / ${elf.slots}',
                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: AppColors.cyan),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 14),

          // 装备槽位
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              ...modules.map((m) => _filledSlot(m)),
              for (int i = 0; i < remaining; i++) _emptySlot(),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            remaining == 0 ? '接口已用完。卸下一个才能装新的。' : '$remaining 个空槽可以继续装。',
            style: const TextStyle(fontSize: 11, color: AppColors.textMuted),
          ),
        ],
      ),
    );
  }

  Widget _filledSlot(AbilityModule m) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: AppColors.violet.withOpacity(0.2),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.violet.withOpacity(0.4)),
      ),
      child: Column(
        children: [
          Text(
            m.glyph,
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: AppColors.violetSoft),
          ),
          Text(
            m.category,
            style: const TextStyle(fontSize: 9, color: AppColors.textFaint),
          ),
        ],
      ),
    );
  }

  Widget _emptySlot() {
    return Container(
      width: 48,
      height: 48,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.strokeSoft, style: BorderStyle.solid),
      ),
      alignment: Alignment.center,
      child: const Icon(Icons.add, size: 18, color: AppColors.textFaint),
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
        childAspectRatio: 1.6,
      ),
      itemBuilder: (_, i) {
        final m = state.modules[i];
        final holder = state.equippedBy(m.id);
        final isMine = holder?.id == elf.id;
        final holderIsOther = holder != null && holder!.id != elf.id;
        return InkWell(
          onTap: () => _openSheet(context, state, elf, m),
          child: Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: isMine ? AppColors.violet.withOpacity(0.5) : AppColors.strokeSoft),
              color: isMine ? AppColors.violet.withOpacity(0.12) : const Color(0xFF121A30),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 28,
                      height: 28,
                      decoration: BoxDecoration(
                        color: AppColors.violet.withOpacity(0.25),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      alignment: Alignment.center,
                      child: Text(
                        m.glyph,
                        style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.violetSoft),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        m.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.text),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  m.summary,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 10, color: AppColors.textMuted, height: 1.4),
                ),
                const Spacer(),
                Text(
                  holderIsOther ? '已装于 ${holder!.name}' : (isMine ? '已装' : '${m.load} 接口 · ${m.compute} 算力'),
                  style: TextStyle(
                    fontSize: 10,
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

  void _openSheet(BuildContext context, AppState state, Elf elf, AbilityModule m) {
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
                  color: const Color(0xFF1A2040),
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
                  label: '从 ${holder.name} 身上卸下',
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
                          if (err != null) state.equip(m.id, holder.id); // 失败回退
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
}
