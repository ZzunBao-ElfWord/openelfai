import 'package:flutter/material.dart';
import '../models/elf.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';

/// 官方首发挂单详情 + 购买。
///
/// 持有人之间的 AI 交易已取消，这里只承载官方首发的新 AI。
class MarketListingPage extends StatelessWidget {
  final MarketListing listing;
  const MarketListingPage({super.key, required this.listing});

  @override
  Widget build(BuildContext context) {
    final state = AppState.instance;
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: AppBackground(
        child: ListView(
          padding: EdgeInsets.zero,
          children: [
            _hero(context),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 20, 20, 20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // edition
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 7, vertical: 3),
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(5),
                          color: AppColors.cyan.withOpacity(0.18),
                        ),
                        child: Text(
                          '官方首发',
                          style: TextStyle(
                            fontSize: 10,
                            fontWeight: FontWeight.w700,
                            color: AppColors.cyan,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      if (listing.edition != null)
                        Text(
                          listing.edition!,
                          style: TextStyle(
                              fontSize: 11, color: AppColors.textMuted),
                        ),
                    ],
                  ),
                  const SizedBox(height: 16),

                  // 副标题
                  Text(
                    listing.subtitle,
                    style: TextStyle(
                        fontSize: 14, color: AppColors.textSub, height: 1.6),
                  ),
                  const SizedBox(height: 18),

                  // note
                  if (listing.note != null) ...[
                    Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(10),
                        color: AppColors.surfaceAlt,
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Icon(Icons.info_outline,
                              size: 16, color: AppColors.textMuted),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              listing.note!,
                              style: TextStyle(
                                  fontSize: 12,
                                  color: AppColors.textSub,
                                  height: 1.6),
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
                          style: TextStyle(
                            fontSize: 22,
                            fontWeight: FontWeight.w700,
                            color: AppColors.cyan,
                          ),
                        ),
                        const SizedBox(width: 8),
                        Text(
                          '钻石',
                          style: TextStyle(
                              fontSize: 11, color: AppColors.textMuted),
                        ),
                        const SizedBox(width: 8),
                        Text(
                          '官方定价',
                          style: TextStyle(
                              fontSize: 11, color: AppColors.textMuted),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 22),

                  Opacity(
                    opacity:
                        state.wallet.diamonds < listing.price ? 0.45 : 1.0,
                    child: BrandButton(
                      label: '买下它 · 💎${listing.price}',
                      icon: Icons.shopping_bag_outlined,
                      onTap: () async {
                        final err = await state.buy(listing.id);
                        if (!context.mounted) return;
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
                            SnackBar(
                              content: Text(err),
                              duration: const Duration(seconds: 3),
                            ),
                          );
                        }
                      },
                    ),
                  ),
                  if (state.wallet.diamonds < listing.price)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Center(
                        child: Text(
                          '💎${state.wallet.diamonds} / 要 💎${listing.price}，差 💎${listing.price - state.wallet.diamonds}',
                          style: TextStyle(
                              fontSize: 11, color: AppColors.violetSoft),
                        ),
                      ),
                    ),

                  const SizedBox(height: 10),
                  Center(
                    child: Text(
                      '官方首发的 AI 都是新编号、新地址；买入后可在控制台免费转赠给其他持有人。',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                          fontSize: 10.5,
                          color: AppColors.textFaint.withOpacity(0.9)),
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

  Widget _hero(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            AppColors.violet.withOpacity(0.25),
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
                  icon: Icon(Icons.arrow_back_ios_new,
                      size: 17, color: AppColors.textSub),
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
                    gradient: AppColors.brandGradient,
                  ),
                  alignment: Alignment.center,
                  child: Text(
                    listing.title[0],
                    style: TextStyle(
                      fontSize: 32,
                      fontWeight: FontWeight.w700,
                      color: AppColors.onBrand,
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
                        style: TextStyle(
                            fontSize: 22,
                            fontWeight: FontWeight.w700,
                            color: AppColors.text),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '官方首发',
                        style: TextStyle(
                            fontSize: 11, color: AppColors.textMuted),
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
