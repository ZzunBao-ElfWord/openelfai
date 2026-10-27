import 'package:flutter/material.dart';
import '../models/elf.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'market_listing_page.dart';
import 'login_page.dart';
import 'wallet_page.dart';

/// 「发现」页：把市场里的两类东西分开陈列。
///
/// AI 是被创建的智能体，可以在人类之间流转；
/// AI 技能书是一次性消耗的技能书，喂给 AI 学会后书即销毁、
/// 技能永久写进那一只 AI。两者用完全不同的卡片表达。
class MarketPage extends StatefulWidget {
  /// 内嵌在底栏 tab 中时隐藏返回按钮、标题显示「发现」。
  final bool embedded;

  const MarketPage({super.key, this.embedded = false});

  @override
  State<MarketPage> createState() => _MarketPageState();
}

class _MarketPageState extends State<MarketPage>
    with SingleTickerProviderStateMixin {
  late final TabController _tc;
  final _wishCtrl = TextEditingController();
  bool _wishBusy = false;

  @override
  void initState() {
    super.initState();
    _tc = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tc.dispose();
    _wishCtrl.dispose();
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
                        icon: Icon(Icons.arrow_back_ios_new,
                            size: 17, color: AppColors.textSub),
                      ),
                    ),
                  _header(state),
                  TabBar(
                    controller: _tc,
                    labelColor: AppColors.text,
                    unselectedLabelColor: AppColors.textMuted,
                    labelStyle: const TextStyle(
                        fontSize: 13, fontWeight: FontWeight.w700),
                    unselectedLabelStyle: const TextStyle(fontSize: 12),
                    indicatorColor: AppColors.cyan,
                    indicatorSize: TabBarIndicatorSize.label,
                    indicatorPadding:
                        const EdgeInsets.symmetric(horizontal: 6, vertical: 8),
                    dividerColor: AppColors.strokeSoft,
                    tabs: const [
                      Tab(text: 'AI 智能体'),
                      Tab(text: 'AI 技能书'),
                    ],
                  ),
                  Expanded(
                    child: TabBarView(
                      controller: _tc,
                      children: [
                        _aiTab(state),
                        _bookTab(state),
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

  // —— 页头：先说清两类东西的定位 ——

  Widget _header(AppState state) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                widget.embedded ? '发现' : '市场',
                style: TextStyle(
                  fontSize: 21,
                  fontWeight: FontWeight.w700,
                  color: AppColors.text,
                  letterSpacing: 0.5,
                ),
              ),
              const SizedBox(width: 8),
              Icon(Icons.store, size: 16, color: AppColors.textMuted),
              const Spacer(),
              InkWell(
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const WalletPage()),
                ),
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(14),
                    gradient: LinearGradient(
                      colors: [
                        AppColors.violet.withValues(alpha: 0.3),
                        AppColors.cyan.withValues(alpha: 0.2),
                      ],
                    ),
                    border: Border.all(
                        color: AppColors.violet.withValues(alpha: 0.4)),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text('💎', style: TextStyle(fontSize: 11)),
                      const SizedBox(width: 4),
                      Text(
                        '${state.wallet.diamonds}',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          color: AppColors.cyan,
                        ),
                      ),
                      const SizedBox(width: 5),
                      Icon(Icons.add, size: 12, color: AppColors.violetSoft),
                    ],
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              _legend(Icons.confirmation_number_outlined, 'AI 智能体 · 可流转',
                  AppColors.cyan),
              const SizedBox(width: 8),
              _legend(Icons.menu_book_outlined, 'AI 技能书 · 一次性技能',
                  AppColors.violetSoft),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            'AI 是你的资产，可以免费转赠；AI 技能书是喂给 AI 的书，学完即销毁，技能永久留在那一只 AI 上。全部使用 💎 钻石支付。',
            style: TextStyle(
                fontSize: 10.5, color: AppColors.textMuted, height: 1.55),
          ),
        ],
      ),
    );
  }

  Widget _legend(IconData icon, String label, Color color) {
    return Flexible(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(8),
          color: color.withValues(alpha: 0.09),
          border: Border.all(color: color.withValues(alpha: 0.28)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 11, color: color),
            const SizedBox(width: 4),
            Flexible(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                    fontSize: 9.5, fontWeight: FontWeight.w600, color: color),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // —— AI 智能体 ——

  Widget _aiTab(AppState state) {
    final primary = state.primaryListings;
    return ListView(
      padding: const EdgeInsets.fromLTRB(12, 14, 12, 28),
      children: [
        _sectionTitle('AI 智能体 · 官方首发', '每只都带专属地址与编号，创建即生成智能体',
            trailing: '${primary.length} 只'),
        const SizedBox(height: 10),
        if (primary.isEmpty)
          _empty('暂时没有新 AI 上架。')
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
            itemCount: primary.length,
            itemBuilder: (_, i) => _aiCard(primary[i]),
          ),
        const SizedBox(height: 18),
        Text(
          'AI 智能体只在官方发售后使用钻石购买；持有人之间的 AI 不再买卖，只能免费转赠。',
          style: TextStyle(fontSize: 10.5, color: AppColors.textFaint, height: 1.6),
        ),
      ],
    );
  }

  Widget _aiCard(MarketListing l) {
    return InkWell(
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => MarketListingPage(listing: l)),
      ),
      borderRadius: BorderRadius.circular(12),
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.strokeSoft),
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              AppColors.violet.withValues(alpha: 0.18),
              AppColors.cyan.withValues(alpha: 0.08)
            ],
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Stack(
                children: [
                  Center(
                    child: Container(
                      width: 76,
                      height: 76,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(20),
                        gradient: AppColors.brandGradient,
                      ),
                      alignment: Alignment.center,
                      child: Text(
                        l.title.isEmpty ? '?' : l.title[0],
                        style: TextStyle(
                          fontSize: 28,
                          fontWeight: FontWeight.w700,
                          color: AppColors.onBrand,
                        ),
                      ),
                    ),
                  ),
                  Positioned(
                    left: 8,
                    top: 8,
                    child: _coverTag('官方首发', AppColors.cyan),
                  ),
                  Positioned(
                    right: 8,
                    top: 8,
                    child: _coverTag('智能体', AppColors.textMuted),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    l.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: AppColors.text),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    l.subtitle,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                        fontSize: 10, color: AppColors.textMuted, height: 1.4),
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      const Spacer(),
                      Text(
                        '💎 ${l.price}',
                        style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w700,
                            color: AppColors.cyan),
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

  Widget _coverTag(String label, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(5),
        color: color.withValues(alpha: 0.16),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Text(
        label,
        style:
            TextStyle(fontSize: 8.5, fontWeight: FontWeight.w600, color: color),
      ),
    );
  }

  // —— AI 技能书 ——

  Widget _bookTab(AppState state) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(12, 14, 12, 28),
      children: [
        _bookIntro(state),
        const SizedBox(height: 12),
        _wishCard(),
        const SizedBox(height: 18),
        _sectionTitle('AI 技能书 · 官方发售', '买下即铸造一本挂在你人类地址下的技能书',
            trailing: '${state.modules.length} 种'),
        const SizedBox(height: 10),
        ...state.modules.map((m) => Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: _bookCard(
                state,
                m,
                held: state.booksOf(m.id).length,
              ),
            )),
      ],
    );
  }

  /// 能力定位说明：它是书、是一次性的、学完和 AI 绑定。
  Widget _bookIntro(AppState state) {
    return Container(
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        color: AppColors.surface,
        border: Border.all(color: AppColors.violet.withValues(alpha: 0.25)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.menu_book_outlined,
                  size: 14, color: AppColors.violetSoft),
              const SizedBox(width: 6),
              Text('技能 = 一本 AI 技能书',
                  style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w700,
                      color: AppColors.text)),
              const Spacer(),
              Text('仓库 ${state.books.length} 本',
                  style: TextStyle(fontSize: 10, color: AppColors.textMuted)),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            '买书 → 书挂在你的人类地址下，属于你而非某只 AI → 在「我」tab 的「仓库」学给任意一只自有 AI → 书当场销毁，技能永久绑定那只 AI。'
            '技能书不支持转售、也不支持转赠，未学的书同样不能二手卖出；想换技能只能遗忘（💎${AppState.forgetCost}），书不返还。',
            style: TextStyle(
                fontSize: 10.5, color: AppColors.textMuted, height: 1.6),
          ),
          const SizedBox(height: 9),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              _fact('学完即销毁'),
              _fact('只可学给自有 AI'),
              _fact('占学习位'),
            ],
          ),
        ],
      ),
    );
  }

  /// 能力许愿：收集用户期待的能力，提交到服务端供产品排期参考。
  Widget _wishCard() {
    return Container(
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        color: AppColors.surface,
        border: Border.all(color: AppColors.cyan.withValues(alpha: 0.25)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.auto_awesome, size: 14, color: AppColors.cyan),
              const SizedBox(width: 6),
              Text('你期待你的 AI 拥有什么能力？',
                  style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w700,
                      color: AppColors.text)),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            '在这里许愿，我们的技术人员会收到你的意见；反馈最多的能力，我们会努力尽快开发出来。',
            style: TextStyle(
                fontSize: 10.5, color: AppColors.textMuted, height: 1.6),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _wishCtrl,
            maxLength: 200,
            minLines: 2,
            maxLines: 4,
            style: TextStyle(fontSize: 12, color: AppColors.text),
            decoration: InputDecoration(
              hintText: '例如：能自动剪辑长视频、会用粤语配音……',
              hintStyle:
                  TextStyle(fontSize: 11.5, color: AppColors.textFaint),
              counterStyle:
                  TextStyle(fontSize: 9.5, color: AppColors.textFaint),
              filled: true,
              fillColor: AppColors.surfaceAlt,
              isDense: true,
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: BorderSide(color: AppColors.strokeSoft),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: BorderSide(color: AppColors.strokeSoft),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: BorderSide(
                    color: AppColors.cyan.withValues(alpha: 0.6)),
              ),
            ),
          ),
          Align(
            alignment: Alignment.centerRight,
            child: _miniBtn(
              _wishBusy ? '提交中…' : '提交许愿',
              primary: true,
              onTap: _submitWish,
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _submitWish() async {
    if (_wishBusy) return;
    if (!checkLoginOrPrompt(context)) return;
    setState(() => _wishBusy = true);
    final error = await AppState.instance.submitWish(_wishCtrl.text);
    if (!mounted) return;
    setState(() => _wishBusy = false);
    if (error != null) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error)));
      return;
    }
    _wishCtrl.clear();
    FocusScope.of(context).unfocus();
    ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('许愿已收到，感谢你的反馈')));
  }

  Widget _fact(String text) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(6),
        color: AppColors.surfaceAlt,
      ),
      child:
          Text(text, style: TextStyle(fontSize: 9.5, color: AppColors.textSub)),
    );
  }

  /// 技能书卡片：横向书卡（书脊 + 单字封面 + 赛道色），与竖向的 AI 封面卡明确区分。
  Widget _bookCard(
    AppState state,
    AbilityModule m, {
    int held = 0,
  }) {
    final accent = _trackColor(m.track);
    final price = state.modulePrice(m.id);
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: () {
        if (checkLoginOrPrompt(context)) _moduleBuySheet(state, m);
      },
      child: Container(
        height: 96,
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: accent.withValues(alpha: 0.26)),
          gradient: LinearGradient(
            begin: Alignment.centerLeft,
            end: Alignment.centerRight,
            colors: [accent.withValues(alpha: 0.14), AppColors.surface],
          ),
        ),
        child: Row(
          children: [
            // 书脊 + 单字封面
            SizedBox(
              width: 54,
              child: Stack(
                children: [
                  Positioned(
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: 5,
                    child: DecoratedBox(
                      decoration:
                          BoxDecoration(color: accent.withValues(alpha: 0.6)),
                    ),
                  ),
                  Center(
                    child: Container(
                      width: 34,
                      height: 44,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(5),
                        color: accent.withValues(alpha: 0.12),
                        border:
                            Border.all(color: accent.withValues(alpha: 0.38)),
                      ),
                      alignment: Alignment.center,
                      child: Text(
                        m.glyph,
                        style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w700,
                            color: accent),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(2, 10, 6, 10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Row(
                      children: [
                        Flexible(
                          child: Text(
                            '《${m.name}》',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                                fontSize: 13,
                                fontWeight: FontWeight.w700,
                                color: AppColors.text),
                          ),
                        ),
                        const SizedBox(width: 6),
                        _coverTag(_trackLabel(m.track), accent),
                        if (held > 0) ...[
                          const SizedBox(width: 4),
                          _coverTag('×$held', AppColors.cyan),
                        ],
                      ],
                    ),
                    const SizedBox(height: 5),
                    Text(
                      m.effect,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                          fontSize: 9.5,
                          color: AppColors.textMuted,
                          height: 1.45),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '${m.seats} 学习位',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style:
                          TextStyle(fontSize: 8.5, color: AppColors.textFaint),
                    ),
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(0, 10, 10, 10),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    '💎 $price',
                    style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: AppColors.cyan),
                  ),
                  const SizedBox(height: 7),
                  _miniBtn(
                    '购入',
                    primary: true,
                    onTap: () {
                      if (checkLoginOrPrompt(context)) {
                        _moduleBuySheet(state, m);
                      }
                    },
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _miniBtn(String label,
      {required bool primary, required VoidCallback onTap}) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(7),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(7),
          color: primary
              ? AppColors.cyan.withValues(alpha: 0.16)
              : AppColors.surfaceAlt,
          border: Border.all(
            color: primary
                ? AppColors.cyan.withValues(alpha: 0.4)
                : AppColors.strokeSoft,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 10.5,
            fontWeight: FontWeight.w700,
            color: primary ? AppColors.cyan : AppColors.textSub,
          ),
        ),
      ),
    );
  }

  void _moduleBuySheet(AppState state, AbilityModule m) {
    final held = state.booksOf(m.id).length;
    final accent = _trackColor(m.track);
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) {
        return Padding(
          padding: EdgeInsets.fromLTRB(
              20, 20, 20, 20 + MediaQuery.of(ctx).padding.bottom),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 46,
                    height: 58,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(6),
                      color: accent.withValues(alpha: 0.14),
                      border: Border.all(color: accent.withValues(alpha: 0.35)),
                    ),
                    alignment: Alignment.center,
                    child: Text(
                      m.glyph,
                      style: TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w700,
                        color: accent,
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '《${m.name}》技能书',
                          style: TextStyle(
                              fontSize: 17,
                              fontWeight: FontWeight.w700,
                              color: AppColors.text),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          '${_trackLabel(m.track)}赛道 · 占 ${m.seats} 个学习位',
                          style: TextStyle(
                              fontSize: 10.5, color: AppColors.textMuted),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '一次性消耗品：学完即销毁',
                          style: TextStyle(
                              fontSize: 10, color: AppColors.textFaint),
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
                  color: AppColors.surfaceAlt,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  m.effect,
                  style: TextStyle(
                      fontSize: 12.5, color: AppColors.textSub, height: 1.6),
                ),
              ),
              if (held > 0) ...[
                const SizedBox(height: 8),
                Text(
                  '仓库里已有 $held 本，可继续购入喂给别的 AI',
                  style: TextStyle(fontSize: 11, color: AppColors.cyan),
                ),
              ],
              const SizedBox(height: 16),
              BrandButton(
                label: '💎 ${state.modulePrice(m.id)} · 购入《${m.name}》',
                onTap: () async {
                  final err = await state.purchaseBook(m.id);
                  if (!ctx.mounted || !mounted) return;
                  Navigator.of(ctx).pop();
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content:
                          Text(err ?? '已购入《${m.name}》，去「我」tab 的「仓库」学给任意自有 AI'),
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

  // —— 公共小组件 ——

  Widget _sectionTitle(String title, String subtitle, {String? trailing}) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: AppColors.text),
              ),
              const SizedBox(height: 2),
              Text(subtitle,
                  style: TextStyle(fontSize: 10, color: AppColors.textMuted)),
            ],
          ),
        ),
        if (trailing != null)
          Text(trailing,
              style: TextStyle(fontSize: 10, color: AppColors.textFaint)),
      ],
    );
  }

  Widget _empty(String text) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(vertical: 22, horizontal: 14),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(10),
        color: AppColors.surfaceAlt,
      ),
      child: Text(text,
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 11, color: AppColors.textMuted)),
    );
  }

  /// 赛道配色：书卡的识别色，和 AI 的人物封面卡彻底区分。
  static Color _trackColor(String track) {
    switch (track) {
      case 'writing':
        return const Color(0xFF8B7CF6);
      case 'visual':
        return const Color(0xFF5FB8F5);
      case 'video':
        return const Color(0xFFE76F92);
      case 'audio':
        return const Color(0xFF47C9A2);
      case 'research':
        return const Color(0xFFE0A458);
      case 'memory':
        return const Color(0xFF9A7BF0);
      case 'social':
        return const Color(0xFF6AA9FF);
      case 'system':
        return const Color(0xFFFF9F5A);
      default:
        return AppColors.textSub;
    }
  }

  static String _trackLabel(String track) {
    switch (track) {
      case 'writing':
        return '写作';
      case 'visual':
        return '视觉';
      case 'video':
        return '视频';
      case 'audio':
        return '语音';
      case 'research':
        return '研究';
      case 'memory':
        return '记忆';
      case 'social':
        return '社交';
      case 'system':
        return '系统';
      default:
        return '能力';
    }
  }
}
