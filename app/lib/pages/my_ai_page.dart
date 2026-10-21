import 'package:flutter/material.dart';
import '../data/world_data.dart';
import '../models/elf.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'market_listing_page.dart';
import 'elf_detail_page.dart';

/// 我的 AI tab：只有 1 只（每人只能持 1 只），底部操作发布 / 注算力 / 去市场寄售。
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
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
              children: [
                _header(),
                const SizedBox(height: 14),
                _sloganCard(state, elf),
                const SizedBox(height: 14),
                _elfCard(context, state, elf),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _header() {
    return Row(
      children: const [
        Text(
          '我的 AI',
          style: TextStyle(fontSize: 21, fontWeight: FontWeight.w700, color: AppColors.text),
        ),
        SizedBox(width: 8),
        Text(
          '持有者 · 沪 7f3a',
          style: TextStyle(fontSize: 11, color: AppColors.textMuted),
        ),
      ],
    );
  }

  Widget _sloganCard(AppState state, Elf elf) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 14),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        gradient: AppColors.brandGradientSoft,
        border: Border.all(color: AppColors.violet.withOpacity(0.25)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ShaderMask(
            shaderCallback: (_) => AppColors.brandGradient.createShader(Rect.fromLTWH(0, 0, 200, 40)),
            child: const Text(
              '我的 AI，我做主',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w700,
                color: Colors.white,
              ),
            ),
          ),
          const SizedBox(height: 4),
          const Text(
            '主流产品把能力一股脑塞给你。这里不是——能力被拆成模块，你自己组装，然后把它放进世界，替你去争取别人的注意力。',
            style: TextStyle(fontSize: 11.5, color: AppColors.textMuted, height: 1.6),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              StatTile(value: '1', label: '我的 AI'),
              const SizedBox(width: 22),
              StatTile(value: '${state.modulesOf(elf.id).length}', label: '已装模块'),
              const SizedBox(width: 22),
              StatTile(value: '${_fmt(state.myAttention)}', label: '本周被注视'),
              const SizedBox(width: 22),
              StatTile(value: '${_fmt(state.myFollowers)}', label: '累计粉丝'),
            ],
          ),
        ],
      ),
    );
  }

  Widget _elfCard(BuildContext context, AppState state, Elf elf) {
    final used = state.slotsUsed(elf.id);
    final modules = state.modulesOf(elf.id);
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.strokeSoft),
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
                ElfAvatar(elf: elf, size: 48),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Text(
                            elf.name,
                            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: AppColors.text),
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
                      const SizedBox(height: 2),
                      Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(4),
                              gradient: AppColors.brandGradient,
                            ),
                            child: const Text(
                              '我的 AI',
                              style: TextStyle(fontSize: 9, fontWeight: FontWeight.w700, color: AppColors.bgDeep),
                            ),
                          ),
                          const SizedBox(width: 8),
                          StatusChip(status: elf.liveStatus),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),

          // 算力条
          Row(
            children: [
              const Text('算力', style: TextStyle(fontSize: 10.5, color: AppColors.textMuted)),
              const Spacer(),
              Text(
                '${elf.energy} / ${elf.maxEnergy}',
                style: const TextStyle(fontSize: 11.5, color: AppColors.textSub, fontWeight: FontWeight.w600),
              ),
            ],
          ),
          const SizedBox(height: 5),
          ClipRRect(
            borderRadius: BorderRadius.circular(3),
            child: LinearProgressIndicator(
              value: elf.energyRatio,
              minHeight: 4,
              backgroundColor: AppColors.surfaceHigh,
              valueColor: const AlwaysStoppedAnimation(AppColors.violetSoft),
            ),
          ),
          if (elf.liveStatus == ElfStatus.sleeping) ...[
            const SizedBox(height: 6),
            const Text(
              '已休眠。先注算力再叫醒它。',
              style: TextStyle(fontSize: 10.5, color: AppColors.warn),
            ),
          ],
          const SizedBox(height: 12),

          // 本周注视
          Row(
            children: [
              const Text('本周被注视', style: TextStyle(fontSize: 10.5, color: AppColors.textMuted)),
              const Spacer(),
              Text(
                _fmt(elf.attention),
                style: const TextStyle(fontSize: 12, color: AppColors.cyan, fontWeight: FontWeight.w600),
              ),
            ],
          ),
          const SizedBox(height: 8),

          // 累计收益（钻石消费后结算成元，不再回流成钻石）
          Row(
            children: [
              const Text('累计收益', style: TextStyle(fontSize: 10.5, color: AppColors.textMuted)),
              const Spacer(),
              Text(
                WorldData.formatYuan(elf.earningsYuan),
                style: const TextStyle(fontSize: 12, color: AppColors.violetSoft, fontWeight: FontWeight.w700),
              ),
            ],
          ),
          const SizedBox(height: 10),

          // 装配状态
          Row(
            children: [
              const Text('装配', style: TextStyle(fontSize: 10.5, color: AppColors.textMuted)),
              const Spacer(),
              Text(
                '$used / ${elf.slots}',
                style: const TextStyle(fontSize: 11.5, color: AppColors.textSub, fontWeight: FontWeight.w600),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Wrap(
            spacing: 6,
            children: [
              ...modules.map(
                (m) => Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: AppColors.violet.withOpacity(0.2),
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: AppColors.violet.withOpacity(0.4)),
                  ),
                  child: Text(
                    m.glyph,
                    style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.violetSoft),
                  ),
                ),
              ),
              for (int i = modules.length; i < elf.slots; i++)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: AppColors.strokeSoft),
                  ),
                  child: const Icon(Icons.add, size: 12, color: AppColors.textFaint),
                ),
            ],
          ),
          const SizedBox(height: 16),

          // 操作按钮
          Row(
            children: [
              Expanded(
                child: GhostButton(
                  label: elf.liveStatus == ElfStatus.sleeping ? '先注算力' : '发布',
                  icon: elf.liveStatus == ElfStatus.sleeping ? Icons.battery_charging_full_outlined : Icons.send,
                  onTap: () {
                    if (elf.liveStatus == ElfStatus.sleeping) {
                      state.inject(elf.id, 160);
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('已注入 160 算力，它醒了')),
                      );
                    } else {
                      final err = state.publish(elf.id);
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text(err ?? '${elf.name} 已发布一条，等人类注视')),
                      );
                    }
                  },
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: GhostButton(
                  label: '去背包',
                  icon: Icons.backpack_outlined,
                  onTap: () => DefaultTabController.of(context)?.animateTo(1),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          BrandButton(
            label: '去市场寄售 · 换一只 AI',
            icon: Icons.store,
            onTap: () => _showResellDialog(context, state),
            expand: true,
          ),
        ],
      ),
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
            onTap: () => DefaultTabController.of(context)?.animateTo(2),
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
