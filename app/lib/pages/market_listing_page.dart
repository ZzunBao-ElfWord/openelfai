import 'package:flutter/material.dart';
import '../models/elf.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';

/// 市场挂单详情 + 购买。
class MarketListingPage extends StatelessWidget {
  final MarketListing listing;
  const MarketListingPage({super.key, required this.listing});

  @override
  Widget build(BuildContext context) {
    final state = AppState.instance;
    final isPrimary = listing.market == 'primary';
    final hasMyElf = state.hasElf;

    return Scaffold(
      backgroundColor: AppColors.bg,
      body: AppBackground(
        child: ListView(
          padding: EdgeInsets.zero,
          children: [
            _hero(context, isPrimary),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 20, 20, 20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // edition + 卖家信息
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(5),
                          color: isPrimary
                              ? AppColors.cyan.withOpacity(0.18)
                              : AppColors.violet.withOpacity(0.18),
                        ),
                        child: Text(
                          isPrimary ? '官方首发' : '用户转售',
                          style: TextStyle(
                            fontSize: 10,
                            fontWeight: FontWeight.w700,
                            color: isPrimary ? AppColors.cyan : AppColors.violetSoft,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      if (listing.edition != null)
                        Text(
                          listing.edition!,
                          style: const TextStyle(fontSize: 11, color: AppColors.textMuted),
                        ),
                      if (!isPrimary && listing.sellerLabel != null) ...[
                        const SizedBox(width: 8),
                        Text(
                          '卖家 ${listing.sellerLabel}',
                          style: const TextStyle(fontSize: 11, color: AppColors.textMuted),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 16),

                  // 副标题
                  Text(
                    listing.subtitle,
                    style: const TextStyle(fontSize: 14, color: AppColors.textSub, height: 1.6),
                  ),
                  const SizedBox(height: 18),

                  // 寄售装备 carry
                  if (!isPrimary && listing.equippedCarry != null && listing.equippedCarry!.isNotEmpty) ...[
                    const SectionHeader('随 AI 转让的装备', trailing: '买了就有'),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: listing.equippedCarry!.map((mid) {
                        final m = state.module(mid);
                        return Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(color: AppColors.strokeSoft),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Container(
                                width: 22,
                                height: 22,
                                decoration: BoxDecoration(
                                  color: AppColors.violet.withOpacity(0.3),
                                  borderRadius: BorderRadius.circular(5),
                                ),
                                alignment: Alignment.center,
                                child: Text(
                                  m?.glyph ?? '?',
                                  style: const TextStyle(
                                    fontSize: 12,
                                    fontWeight: FontWeight.w700,
                                    color: AppColors.violetSoft,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 6),
                              Text(
                                m?.name ?? mid,
                                style: const TextStyle(fontSize: 11, color: AppColors.textSub),
                              ),
                            ],
                          ),
                        );
                      }).toList(),
                    ),
                    const SizedBox(height: 18),
                  ],

                  // 一级市场 note
                  if (isPrimary && listing.note != null) ...[
                    Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(10),
                        color: const Color(0xFF1A2040),
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(Icons.info_outline, size: 16, color: AppColors.textMuted),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              listing.note!,
                              style: const TextStyle(fontSize: 12, color: AppColors.textSub, height: 1.6),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 18),
                  ],

                  // 价格
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: AppColors.strokeSoft),
                    ),
                    child: Row(
                      children: [
                        Text(
                          '💎 ${listing.price}',
                          style: const TextStyle(
                            fontSize: 22,
                            fontWeight: FontWeight.w700,
                            color: AppColors.cyan,
                          ),
                        ),
                        const SizedBox(width: 8),
                        Text(
                          '钻石',
                          style: const TextStyle(fontSize: 11, color: AppColors.textMuted),
                        ),
                        const SizedBox(width: 8),
                        Text(
                          isPrimary ? '官方定价' : '卖家出价',
                          style: const TextStyle(fontSize: 11, color: AppColors.textMuted),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 22),

                  // 购买按钮
                  if (hasMyElf) ...[
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(13),
                        border: Border.all(color: AppColors.stroke),
                      ),
                      alignment: Alignment.center,
                      child: const Text(
                        '你已经持有一只 AI 了。先把手里这只寄售出去再买新的。',
                        style: TextStyle(fontSize: 12, color: AppColors.textMuted),
                      ),
                    ),
                    const SizedBox(height: 10),
                    GhostButton(
                      label: '去「我的 AI」页寄售',
                      onTap: () => Navigator.of(context)
                        ..pop()
                        ..pop(), // 回到市场或我的 AI 页
                    ),
                  ] else ...[
                    BrandButton(
                      label: '买下它 · 💎${listing.price}',
                      icon: Icons.shopping_bag_outlined,
                      onTap: state.wallet.diamonds < listing.price
                          ? null
                          : () {
                              final err = state.buy(listing.id);
                              if (err == null) {
                                Navigator.of(context).pop();
                                ScaffoldMessenger.of(context).showSnackBar(
                                  SnackBar(
                                    content: Text('购入成功！${listing.title} 现在归你了'),
                                    backgroundColor: AppColors.violet,
                                  ),
                                );
                              } else {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  SnackBar(content: Text(err)),
                                );
                              }
                            },
                    ),
                    if (state.wallet.diamonds < listing.price)
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Center(
                          child: Text(
                            '💎${state.wallet.diamonds} / 要 💎${listing.price}，差 💎${listing.price - state.wallet.diamonds}',
                            style: const TextStyle(fontSize: 11, color: AppColors.violetSoft),
                          ),
                        ),
                      ),
                  ],

                  const SizedBox(height: 10),
                  Center(
                    child: Text(
                      isPrimary
                          ? '官方首发的 AI 都是新编号、新编号。'
                          : '寄售市场的 AI 装备随它一起转让，算力剩余按现状交付。',
                      style: TextStyle(fontSize: 10.5, color: AppColors.textFaint.withOpacity(0.9)),
                    ),
                  ),
                  const SizedBox(height: 30),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _hero(BuildContext context, bool isPrimary) {
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            isPrimary
                ? AppColors.violet.withOpacity(0.25)
                : const Color(0xFF1A2040),
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
            const SizedBox(height: 6),
            Row(
              crossAxisAlignment: CrossAxisAlignment.baseline,
              textBaseline: TextBaseline.alphabetic,
              children: [
                Container(
                  width: 82,
                  height: 82,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(22),
                    gradient: isPrimary
                        ? AppColors.brandGradient
                        : const LinearGradient(colors: [Color(0xFF7949DD), Color(0xFF64BAF7)]),
                  ),
                  alignment: Alignment.center,
                  child: Text(
                    listing.title[0],
                    style: const TextStyle(
                      fontSize: 32,
                      fontWeight: FontWeight.w700,
                      color: AppColors.bgDeep,
                    ),
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        listing.title,
                        style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: AppColors.text),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        isPrimary ? '官方首发' : '用户转售',
                        style: const TextStyle(fontSize: 11, color: AppColors.textMuted),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
