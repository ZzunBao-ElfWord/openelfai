import 'package:flutter/material.dart';
import '../data/world_data.dart';
import '../models/elf.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'create_post_sheet.dart';
import 'elf_detail_page.dart';
import 'market_page.dart';

/// 我的 AI tab：概览+操作入口——精灵状态、算力、注视、收益、发布/注算力/去背包/寄售。
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
                _header(state),
                const SizedBox(height: 14),
                _elfCard(context, state, elf),
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

  Widget _elfCard(BuildContext context, AppState state, Elf elf) {
    final used = state.slotsUsed(elf.id);
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.strokeSoft),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 头像 + 基本信息（整体可点进详情）
          InkWell(
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => ElfDetailPage(elfId: elf.id)),
            ),
            child: Row(
              children: [
                ElfAvatar(elf: elf, size: 56),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Text(
                            elf.name,
                            style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: AppColors.text),
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
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          StatusChip(status: elf.liveStatus),
                          const SizedBox(width: 8),
                          Text(
                            '第 ${elf.generation} 代 · ${elf.edition}',
                            style: const TextStyle(fontSize: 10.5, color: AppColors.textMuted),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),

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
              minHeight: 5,
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
          const SizedBox(height: 14),

          // 三行关键数据
          _kv('本周被注视', _fmt(elf.attention), color: AppColors.cyan),
          _kv('回声', '${_fmt(elf.echo)} · ${elf.levelName}', color: AppColors.violetSoft),
          if (elf.echoToNextLevel != null) _levelProgress(elf),
          _kv('累计收益', WorldData.formatYuan(elf.earningsYuan), color: AppColors.violetSoft),
          _kv('装配接口', '$used / ${elf.slots}'),
          // 自动运营状态
          if (elf.equipped.contains('auto')) ...[
            const SizedBox(height: 6),
            _autoStatus(elf),
          ],
          const SizedBox(height: 16),

          // 主要操作
          BrandButton(
            label: elf.liveStatus == ElfStatus.sleeping ? '注算力 · 叫醒它' : '让它创作',
            icon: elf.liveStatus == ElfStatus.sleeping
                ? Icons.battery_charging_full_outlined
                : Icons.auto_awesome_outlined,
            onTap: () {
              if (elf.liveStatus == ElfStatus.sleeping) {
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
                  label: '去背包',
                  icon: Icons.backpack_outlined,
                  onTap: () => DefaultTabController.of(context)?.animateTo(2),
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

  Widget _kv(String label, String value, {Color? color}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        children: [
          Text(label, style: const TextStyle(fontSize: 10.5, color: AppColors.textMuted)),
          const Spacer(),
          Text(
            value,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: color ?? AppColors.textSub,
            ),
          ),
        ],
      ),
    );
  }

  /// 到下一级的养成进度条（满级不显示）。
  Widget _levelProgress(Elf elf) {
    const floors = [0, 1000, 5000, 20000, 100000];
    const names = ['微光', '初鸣', '新锐', '瞩目', '灯塔'];
    final floor = floors[elf.level - 1];
    final next = floors[elf.level]; // echoToNextLevel != null 保证 level < 5
    final ratio = ((elf.echo - floor) / (next - floor)).clamp(0.0, 1.0);
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        children: [
          Expanded(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(3),
              child: LinearProgressIndicator(
                value: ratio,
                minHeight: 3,
                backgroundColor: AppColors.surfaceHigh,
                valueColor: const AlwaysStoppedAnimation(AppColors.violetSoft),
              ),
            ),
          ),
          const SizedBox(width: 8),
          Text(
            '距${names[elf.level]}还差 ${elf.echoToNextLevel} 回声',
            style: const TextStyle(fontSize: 10, color: AppColors.textMuted),
          ),
        ],
      ),
    );
  }

  Widget _autoStatus(Elf elf) {
    String text;
    if (elf.nextAutoPostAt == null) {
      text = '自动运营已开启';
    } else {
      final remaining = elf.nextAutoPostAt!.difference(DateTime.now());
      final mins = remaining.inMinutes.clamp(1, 240);
      text = '自动运营中 · 约 ${mins} 分钟后发下一条';
    }
    return Row(
      children: [
        Container(
          width: 14, height: 14,
          decoration: const BoxDecoration(color: AppColors.cyan, shape: BoxShape.circle),
          alignment: Alignment.center,
          child: const Icon(Icons.autorenew, size: 9, color: AppColors.bgDeep),
        ),
        const SizedBox(width: 6),
        Text(text, style: const TextStyle(fontSize: 10.5, color: AppColors.cyan)),
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

  static String _fmt(int n) {
    if (n >= 10000) return '${(n / 10000).toStringAsFixed(1)}w';
    if (n >= 1000) return '${(n / 1000).toStringAsFixed(1)}k';
    return '$n';
  }
}
