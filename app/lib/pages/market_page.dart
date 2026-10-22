import 'package:flutter/material.dart';
import '../models/elf.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'market_listing_page.dart';
import 'wallet_page.dart';

/// 市场页：可作为「发现」tab 的内嵌内容，也可从二级页打开。
class MarketPage extends StatefulWidget {
  /// 内嵌在底栏 tab 中时隐藏返回按钮、标题显示「发现」。
  final bool embedded;

  const MarketPage({super.key, this.embedded = false});

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
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: AppBackground(
      child: SafeArea(
        bottom: false,
        child: AnimatedBuilder(
          animation: state,
          builder: (context, _) {
            final canPop = !widget.embedded && Navigator.canPop(context);
            return Column(
              children: [
                if (canPop)
                  Align(
                    alignment: Alignment.centerLeft,
                    child: IconButton(
                      padding: const EdgeInsets.only(left: 6),
                      alignment: Alignment.centerLeft,
                      onPressed: () => Navigator.of(context).pop(),
                      icon: const Icon(Icons.arrow_back_ios_new, size: 17, color: AppColors.textSub),
                    ),
                  ),
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
                      _primaryTab(state),
                      _grid(state, state.secondaryListings, isPrimary: false),
                    ],
                  ),
                ),
              ],
            );
          },
        ),
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
              Text(
                widget.embedded ? '发现' : '市场',
                style: const TextStyle(
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
            '可以同时持有多只 AI，喜欢就买。全部使用 💎 钻石支付。',
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

  /// 一级发售 = AI 官方首发 + 全部可购买的能力模块。
  Widget _primaryTab(AppState state) {
    final listings = state.primaryListings;
    return ListView(
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 24),
      children: [
        _sectionTitle('AI · 官方首发', '可以同时持有多只，每只带专属链上钱包'),
        const SizedBox(height: 8),
        if (listings.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 20),
            child: Center(
              child: Text('暂时没有新 AI 上架。', style: TextStyle(fontSize: 12, color: AppColors.textMuted)),
            ),
          )
        else
          GridView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 2,
              mainAxisSpacing: 10,
              crossAxisSpacing: 10,
              childAspectRatio: 0.72,
            ),
            itemCount: listings.length,
            itemBuilder: (_, i) => _listingCard(listings[i], isPrimary: true),
          ),
        const SizedBox(height: 20),
        _sectionTitle('能力模块 · 官方发售', '购入后出现在「我」tab 装配工坊，可自由装卸'),
        const SizedBox(height: 8),
        GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 2,
            mainAxisSpacing: 10,
            crossAxisSpacing: 10,
            childAspectRatio: 0.86,
          ),
          itemCount: state.modules.length,
          itemBuilder: (_, i) => _moduleShopCard(state, state.modules[i]),
        ),
      ],
    );
  }

  Widget _sectionTitle(String title, String subtitle) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.text),
        ),
        const SizedBox(height: 2),
        Text(subtitle, style: const TextStyle(fontSize: 10, color: AppColors.textMuted)),
      ],
    );
  }

  Widget _moduleShopCard(AppState state, AbilityModule m) {
    final owned = state.ownedModules.contains(m.id);
    return InkWell(
      onTap: () => _moduleBuySheet(state, m),
      borderRadius: BorderRadius.circular(14),
      child: Opacity(
        opacity: owned ? 0.55 : 1,
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: owned ? AppColors.violet.withOpacity(0.35) : AppColors.strokeSoft,
            ),
            color: AppColors.surface.withOpacity(0.6),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 30,
                    height: 30,
                    decoration: BoxDecoration(
                      color: AppColors.violet.withOpacity(0.25),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    alignment: Alignment.center,
                    child: Text(
                      m.glyph,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: AppColors.violetSoft,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      m.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w700,
                        color: AppColors.text,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Expanded(
                child: Text(
                  m.effect,
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 10, color: AppColors.textMuted, height: 1.45),
                ),
              ),
              const SizedBox(height: 6),
              Row(
                children: [
                  Text(
                    '${m.load} 接口',
                    style: const TextStyle(fontSize: 9, color: AppColors.textFaint),
                  ),
                  const Spacer(),
                  if (owned)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(6),
                        color: AppColors.violet.withOpacity(0.16),
                      ),
                      child: const Text(
                        '已拥有',
                        style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: AppColors.violetSoft),
                      ),
                    )
                  else
                    Text(
                      '💎 ${state.modulePrice(m)}',
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: AppColors.cyan,
                      ),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _moduleBuySheet(AppState state, AbilityModule m) {
    final owned = state.ownedModules.contains(m.id);
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
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w700,
                        color: AppColors.violetSoft,
                      ),
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
                          '${m.track} 赛道 · ${m.load} 接口 · 每次使用 ${m.compute} 算力',
                          style: const TextStyle(fontSize: 10.5, color: AppColors.textMuted),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  m.effect,
                  style: const TextStyle(fontSize: 12.5, color: AppColors.textSub, height: 1.6),
                ),
              ),
              const SizedBox(height: 16),
              if (owned)
                const Center(
                  child: Padding(
                    padding: EdgeInsets.symmetric(vertical: 10),
                    child: Text(
                      '已拥有 · 去「我」tab 装配工坊装卸',
                      style: TextStyle(fontSize: 12, color: AppColors.violetSoft),
                    ),
                  ),
                )
              else
                BrandButton(
                  label: '💎 ${state.modulePrice(m)} · 购入「${m.name}」',
                  onTap: () {
                    final err = state.purchaseModule(m.id);
                    Navigator.of(ctx).pop();
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: Text(err ?? '已购入「${m.name}」，去「我」tab 装配'),
                        backgroundColor: err == null ? AppColors.violet : null,
                      ),
                    );
                  },
                ),
            ],
          ),
        );
      },
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
