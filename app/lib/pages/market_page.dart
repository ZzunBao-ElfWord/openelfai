import 'package:flutter/material.dart';
import '../data/world_data.dart';
import '../models/elf.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'market_listing_page.dart';
import 'wallet_page.dart';

/// 市场 tab：子 tabs 切一级市场（官方首发）/ 寄售市场（用户转售）。
class MarketPage extends StatefulWidget {
  const MarketPage({super.key});

  @override
  State<MarketPage> createState() => _MarketPageState();
}

class _MarketPageState extends State<MarketPage> with SingleTickerProviderStateMixin {
  late final TabController _tc;

  @override
  void initState() {
    super.initState();
    _tc = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tc.dispose();
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
            return Column(
              children: [
                _header(state),
                TabBar(
                  controller: _tc,
                  labelColor: AppColors.text,
                  unselectedLabelColor: AppColors.textMuted,
                  labelStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
                  unselectedLabelStyle: const TextStyle(fontSize: 12),
                  indicatorColor: AppColors.cyan,
                  indicatorSize: TabBarIndicatorSize.label,
                  indicatorPadding: const EdgeInsets.symmetric(horizontal: 6, vertical: 8),
                  dividerColor: AppColors.strokeSoft,
                  tabs: const [
                    Tab(text: '一级市场 · 官方首发'),
                    Tab(text: '寄售市场 · 用户转售'),
                  ],
                ),
                Expanded(
                  child: TabBarView(
                    controller: _tc,
                    children: [
                      _grid(state, state.primaryListings, isPrimary: true),
                      _grid(state, state.secondaryListings, isPrimary: false),
                    ],
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _header(AppState state) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Text(
                '市场',
                style: TextStyle(
                  fontSize: 21,
                  fontWeight: FontWeight.w700,
                  color: AppColors.text,
                  letterSpacing: 0.5,
                ),
              ),
              const SizedBox(width: 8),
              const Icon(Icons.store, size: 16, color: AppColors.textMuted),
              const Spacer(),
              // 💎 钻石余额 + 充值入口（放在市场页）
              InkWell(
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const WalletPage()),
                ),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(14),
                    gradient: LinearGradient(
                      colors: [
                        AppColors.violet.withOpacity(0.3),
                        AppColors.cyan.withOpacity(0.2),
                      ],
                    ),
                    border: Border.all(color: AppColors.violet.withOpacity(0.4)),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text('💎', style: TextStyle(fontSize: 11)),
                      const SizedBox(width: 4),
                      Text(
                        '${state.wallet.diamonds}',
                        style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          color: AppColors.cyan,
                        ),
                      ),
                      const SizedBox(width: 5),
                      const Icon(Icons.add, size: 12, color: AppColors.violetSoft),
                    ],
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            '每人只能持 1 只 AI。想换？先把手里这只寄售出去，再买新的。全部使用 💎 钻石支付。',
            style: TextStyle(
              fontSize: 11,
              color: AppColors.textMuted,
              height: 1.5,
            ),
          ),
        ],
      ),
    );
  }

  Widget _grid(AppState state, List<MarketListing> listings, {required bool isPrimary}) {
    if (listings.isEmpty) {
      return Center(
        child: Text(
          isPrimary ? '暂时没有新 AI 上架。' : '还没人挂单。',
          style: const TextStyle(fontSize: 12, color: AppColors.textMuted),
        ),
      );
    }
    return GridView.builder(
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 24),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        mainAxisSpacing: 10,
        crossAxisSpacing: 10,
        childAspectRatio: 0.72,
      ),
      itemCount: listings.length,
      itemBuilder: (_, i) => _listingCard(listings[i], isPrimary: isPrimary),
    );
  }

  Widget _listingCard(MarketListing l, {required bool isPrimary}) {
    return InkWell(
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => MarketListingPage(listing: l)),
      ),
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.strokeSoft),
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: isPrimary
                ? [AppColors.violet.withOpacity(0.18), AppColors.cyan.withOpacity(0.08)]
                : [const Color(0xFF1A2040), const Color(0xFF0F1630)],
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Center(
                child: Container(
                  width: 76,
                  height: 76,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(20),
                    gradient: isPrimary
                        ? AppColors.brandGradient
                        : const LinearGradient(colors: [Color(0xFF7949DD), Color(0xFF64BAF7)]),
                  ),
                  alignment: Alignment.center,
                  child: Text(
                    l.title[0],
                    style: const TextStyle(
                      fontSize: 28,
                      fontWeight: FontWeight.w700,
                      color: AppColors.bgDeep,
                    ),
                  ),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    l.title,
                    style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.text),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    l.subtitle,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 10, color: AppColors.textMuted, height: 1.4),
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(4),
                          color: isPrimary
                              ? AppColors.cyan.withOpacity(0.18)
                              : AppColors.violet.withOpacity(0.18),
                        ),
                        child: Text(
                          isPrimary ? '官方首发' : '用户转售',
                          style: TextStyle(
                            fontSize: 9,
                            color: isPrimary ? AppColors.cyan : AppColors.violetSoft,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                      const Spacer(),
                      Text(
                        '💎 ${l.price}',
                        style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.cyan),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
