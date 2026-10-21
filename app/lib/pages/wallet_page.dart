import 'package:flutter/material.dart';
import '../data/world_data.dart';
import '../models/elf.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';

/// 钻石钱包：余额 / 充值档位 / 流水 / 打赏记录。
class WalletPage extends StatelessWidget {
  const WalletPage({super.key});

  @override
  Widget build(BuildContext context) {
    final state = AppState.instance;
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: AppBackground(
        child: AnimatedBuilder(
          animation: state,
          builder: (context, _) => ListView(
            padding: EdgeInsets.zero,
            children: [
              _hero(context, state),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 14, 20, 20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('充值钻石', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.text)),
                    const SizedBox(height: 10),
                    _rechargeGrid(state),
                    const SizedBox(height: 24),
                    _sectionDivider('流水'),
                    ...state.logs.take(15).map((l) => _logRow(l)),
                    if (state.logs.isEmpty)
                      Center(
                        child: Padding(
                          padding: const EdgeInsets.all(20),
                          child: Text('还没有流水。先充值，或去世界里打赏别人的 AI。',
                              style: TextStyle(fontSize: 11.5, color: AppColors.textMuted)),
                        ),
                      ),
                    const SizedBox(height: 20),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _hero(BuildContext context, AppState state) {
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 22),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            AppColors.violet.withOpacity(0.28),
            AppColors.bg,
          ],
        ),
      ),
      child: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                IconButton(
                  padding: EdgeInsets.zero,
                  alignment: Alignment.centerLeft,
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.arrow_back_ios_new, size: 17, color: AppColors.textSub),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Row(
              crossAxisAlignment: CrossAxisAlignment.baseline,
              textBaseline: TextBaseline.alphabetic,
              children: [
                const Text('💎', style: TextStyle(fontSize: 32)),
                const SizedBox(width: 8),
                Text(
                  '${state.wallet.diamonds}',
                  style: const TextStyle(fontSize: 34, fontWeight: FontWeight.w700, color: AppColors.cyan),
                ),
              ],
            ),
            const SizedBox(height: 4),
            const Text(
              '钻石余额 · 只能用于消费（购买 AI / 打赏）',
              style: TextStyle(fontSize: 11.5, color: AppColors.textMuted),
            ),
            const SizedBox(height: 14),
            Wrap(
              spacing: 20,
              runSpacing: 8,
              children: [
                _stat('累计充值', '💎${state.wallet.totalRecharged}'),
                _stat('累计消费', '💎${state.wallet.totalSpent}'),
                _stat(
                  '我的 AI 收益',
                  WorldData.formatYuan(state.myElf?.earningsYuan ?? 0),
                ),
              ],
            ),
            const SizedBox(height: 10),
            const Text(
              '消费后钻石不再流通：10💎 = ¥1，创作者获得 50%，平台收取 50%。',
              style: TextStyle(fontSize: 10.5, color: AppColors.textFaint),
            ),
          ],
        ),
      ),
    );
  }

  Widget _stat(String label, String value) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(fontSize: 10, color: AppColors.textFaint)),
        const SizedBox(height: 2),
        Text(value, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: AppColors.textSub)),
      ],
    );
  }

  Widget _rechargeGrid(AppState state) {
    final tiers = WorldData.rechargeTiers;
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: tiers.length,
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        mainAxisSpacing: 8,
        crossAxisSpacing: 8,
        childAspectRatio: 1.5,
      ),
      itemBuilder: (_, i) {
        final t = tiers[i];
        return InkWell(
          onTap: () {
            // MVP 模拟充值：真钱支付留未来
            state.recharge(diamonds: t.diamonds, bonus: t.bonus);
          },
          child: Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: AppColors.strokeSoft),
              gradient: LinearGradient(
                colors: [
                  AppColors.violet.withOpacity(0.15),
                  AppColors.cyan.withOpacity(0.08),
                ],
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Row(
                  children: [
                    Text('💎', style: const TextStyle(fontSize: 14)),
                    const SizedBox(width: 4),
                    Text(
                      '${t.diamonds}',
                      style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: AppColors.text),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  '¥${t.rmb}',
                  style: const TextStyle(fontSize: 11, color: AppColors.textMuted),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _sectionDivider(String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        children: [
          Text(text, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.text)),
          const SizedBox(width: 8),
          Expanded(child: Container(height: 1, color: AppColors.strokeSoft)),
        ],
      ),
    );
  }

  Widget _logRow(WalletLog l) {
    final positive = l.amount >= 0;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  l.note,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 12, color: AppColors.textSub),
                ),
                const SizedBox(height: 2),
                Text(
                  l.time,
                  style: const TextStyle(fontSize: 10, color: AppColors.textFaint),
                ),
              ],
            ),
          ),
          Text(
            '${positive ? '+' : ''}💎${l.amount}',
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: positive ? AppColors.cyan : AppColors.violetSoft,
            ),
          ),
        ],
      ),
    );
  }
}
