import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../config/commerce_config.dart';
import '../data/world_data.dart';
import '../models/elf.dart';
import '../models/user.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'api_key_page.dart';
import 'bookshelf_page.dart';
import 'create_elf_page.dart';
import 'elf_console_page.dart';
import 'earnings_page.dart';
import 'login_page.dart';
import 'market_page.dart';
import 'settings_page.dart';
import 'wallet_page.dart';

/// 「我」tab：人类自己的主页。
///
/// 这里只承载人类账户：头像/昵称/人类地址、钻石与收益、持有的智能体卡片、
/// 账户入口。AI 的一切数据与配置都不放在这里——点卡片进入那只 AI 的
/// 专属「AI 控制台」，人类与 AI 的边界因此保持清晰。
class ProfilePage extends StatefulWidget {
  const ProfilePage({super.key});

  @override
  State<ProfilePage> createState() => _ProfilePageState();
}

class _ProfilePageState extends State<ProfilePage> {
  @override
  Widget build(BuildContext context) {
    final state = AppState.instance;
    return AppBackground(
      child: SafeArea(
        bottom: false,
        child: AnimatedBuilder(
          animation: state,
          builder: (context, _) {
            final user = state.currentUser;
            final elves = state.myElves;
            return WideContent(
              maxWidth: 760,
              child: ListView(
                padding: EdgeInsets.zero,
                children: [
                  _banner(context, user),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 28),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        _identityRow(context, state),
                        const SizedBox(height: 14),
                        if (user == null)
                          _guestCard(context)
                        else ...[
                          _humanAssets(context, state),
                          const SizedBox(height: 12),
                          _apiKeyEntry(context),
                          const SizedBox(height: 6),
                          if (elves.isEmpty)
                            _emptyNftCard(context)
                          else ...[
                            SectionHeader(
                              '我的 AI 智能体',
                              trailing: '${elves.length} 个 · 点卡片进入控制台',
                            ),
                            _nftGrid(context, state, elves),
                          ],
                        ],
                        const SizedBox(height: 18),
                        _boundaryCard(),
                      ],
                    ),
                  ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }

  // —— 顶部封面 ——

  Widget _banner(BuildContext context, User? user) {
    return SizedBox(
      height: 146,
      child: Stack(
        fit: StackFit.expand,
        children: [
          DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  AppColors.violet.withValues(alpha: 0.34),
                  AppColors.bg.withValues(alpha: 0.95),
                  AppColors.cyan.withValues(alpha: 0.14),
                ],
              ),
            ),
          ),
          Positioned(
            right: 6,
            top: -24,
            child: Text(
              user?.avatarInitial ?? 'O',
              style: TextStyle(
                fontSize: 138,
                fontWeight: FontWeight.w900,
                color: AppColors.text.withValues(alpha: 0.05),
                height: 1,
              ),
            ),
          ),
          Positioned(
            left: 16,
            top: 24,
            child: Text(
              'OPENELF',
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w800,
                letterSpacing: 5,
                color: AppColors.text.withValues(alpha: 0.06),
              ),
            ),
          ),
          Positioned(
            top: 2,
            right: 6,
            child: Row(
              children: [
                Semantics(
                  label: '设置',
                  button: true,
                  child: IconButton(
                    onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => const SettingsPage()),
                    ),
                    icon: Icon(Icons.settings_outlined,
                        size: 21,
                        color: AppColors.text.withValues(alpha: 0.82)),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // —— 身份行：人类账户 ——

  Widget _identityRow(BuildContext context, AppState state) {
    final user = state.currentUser;
    final addr = user?.chainAddress;
    final short = (addr != null && addr.length > 13)
        ? '${addr.substring(0, 6)}…${addr.substring(addr.length - 4)}'
        : addr;

    return Transform.translate(
      offset: const Offset(0, -36),
      child: Row(
        children: [
          Container(
            width: 72,
            height: 72,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: AppColors.brandGradient,
              border: Border.all(color: AppColors.bg, width: 3),
            ),
            alignment: Alignment.center,
            child: Text(
              user?.avatarInitial ?? '?',
              style: TextStyle(
                  fontSize: 26,
                  fontWeight: FontWeight.w700,
                  color: AppColors.onBrand),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: user == null
                  ? () => Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => const LoginPage()))
                  : null,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Flexible(
                        child: Text(
                          user?.nickname ?? '未登录',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                              fontSize: 20,
                              fontWeight: FontWeight.w700,
                              color: AppColors.text),
                        ),
                      ),
                      const SizedBox(width: 7),
                      _humanPill(),
                    ],
                  ),
                  const SizedBox(height: 5),
                  if (user == null)
                    Text('先登录，再创建属于你的 AI',
                        style:
                            TextStyle(fontSize: 11, color: AppColors.textMuted))
                  else
                    Row(
                      children: [
                        Text(_maskPhone(user.phone),
                            style: TextStyle(
                                fontSize: 10.5, color: AppColors.textMuted)),
                        if (short != null) ...[
                          Text(' · ',
                              style: TextStyle(
                                  fontSize: 10.5, color: AppColors.textFaint)),
                          Flexible(
                            child: Text(
                              short,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 10,
                                color: AppColors.textSub,
                                fontFamily: 'monospace',
                                letterSpacing: 0.4,
                              ),
                            ),
                          ),
                          InkWell(
                            borderRadius: BorderRadius.circular(6),
                            onTap: () {
                              Clipboard.setData(ClipboardData(text: addr!));
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                    content: Text('已复制我的人类地址'),
                                    duration: Duration(seconds: 2)),
                              );
                            },
                            child: Padding(
                              padding: const EdgeInsets.all(4),
                              child: Icon(Icons.copy_outlined,
                                  size: 12,
                                  color: AppColors.textMuted,
                                  semanticLabel: '复制我的人类地址'),
                            ),
                          ),
                        ],
                      ],
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _humanPill() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: AppColors.cyan.withValues(alpha: 0.4)),
        color: AppColors.cyan.withValues(alpha: 0.08),
      ),
      child: Text(
        '人类账户',
        style: TextStyle(
            fontSize: 9, fontWeight: FontWeight.w600, color: AppColors.cyan),
      ),
    );
  }

  // —— 人类资产：钻石 + 人类地址 + 收益 ——

  Widget _humanAssets(BuildContext context, AppState state) {
    final addr = state.currentUser?.chainAddress ?? '';
    final short = addr.length > 13
        ? '${addr.substring(0, 6)}…${addr.substring(addr.length - 4)}'
        : addr;
    final earnings = CommerceConfig.enabled
        ? state.creatorEarningsYuan
        : state.myElves.fold<double>(0, (sum, e) => sum + e.earningsYuan);

    return Container(
      padding: const EdgeInsets.fromLTRB(14, 13, 14, 13),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.strokeSoft),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.account_balance_wallet_outlined,
                  size: 13, color: AppColors.cyan),
              const SizedBox(width: 5),
              Text('人类资产',
                  style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                      color: AppColors.cyan)),
              const Spacer(),
              InkWell(
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const EarningsPage()),
                ),
                borderRadius: BorderRadius.circular(6),
                child: Padding(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                  child: Text('收益',
                      style: TextStyle(
                          fontSize: 10.5, color: AppColors.violetSoft)),
                ),
              ),
              const SizedBox(width: 6),
              InkWell(
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const BookshelfPage()),
                ),
                borderRadius: BorderRadius.circular(6),
                child: Padding(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                  child: Text('仓库 ${state.books.length}',
                      style: TextStyle(
                          fontSize: 10.5, color: AppColors.violetSoft)),
                ),
              ),
              const SizedBox(width: 6),
              InkWell(
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const WalletPage()),
                ),
                borderRadius: BorderRadius.circular(6),
                child: Padding(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                  child: Text('钱包',
                      style: TextStyle(
                          fontSize: 10.5, color: AppColors.violetSoft)),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _miniStat('💎${state.wallet.diamonds}', '钻石余额', AppColors.cyan),
              _miniStat('${state.myElves.length}', '持有智能体'),
              _miniStat(WorldData.formatYuan(earnings), '累计收益'),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Text('人类地址',
                  style: TextStyle(fontSize: 10, color: AppColors.textMuted)),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  short.isEmpty ? '——' : short,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                      fontSize: 10.5,
                      color: AppColors.textSub,
                      fontFamily: 'monospace',
                      letterSpacing: 0.4),
                ),
              ),
              if (addr.isNotEmpty)
                InkWell(
                  borderRadius: BorderRadius.circular(6),
                  onTap: () {
                    Clipboard.setData(ClipboardData(text: addr));
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                          content: Text('已复制我的人类地址'),
                          duration: Duration(seconds: 2)),
                    );
                  },
                  child: Padding(
                    padding: const EdgeInsets.all(3),
                    child: Icon(Icons.copy_outlined,
                        size: 12,
                        color: AppColors.textMuted,
                        semanticLabel: '复制我的人类地址'),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            '钻石是人类的消费凭证；AI 对话使用开放平台余额，两者不混用。',
            style: TextStyle(
                fontSize: 10, color: AppColors.textFaint, height: 1.5),
          ),
        ],
      ),
    );
  }

  Widget _miniStat(String value, String label, [Color? color]) {
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w700,
              color: color ?? AppColors.text,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
          const SizedBox(height: 2),
          Text(label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 9.5, color: AppColors.textMuted)),
        ],
      ),
    );
  }

  // —— 平台 API Key 入口：AI 对话与外部接入凭据 ——

  Widget _apiKeyEntry(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => const ApiKeyPage()),
        ),
        child: Container(
          padding: const EdgeInsets.fromLTRB(14, 12, 12, 12),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.strokeSoft),
          ),
          child: Row(
            children: [
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  color: AppColors.surfaceAlt,
                  borderRadius: BorderRadius.circular(8),
                ),
                alignment: Alignment.center,
                child: Icon(Icons.vpn_key_outlined,
                    size: 18, color: AppColors.brand),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '我的 API Key',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w500,
                        color: AppColors.text,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'AI 对话与外部接入凭据',
                      style: TextStyle(
                          fontSize: 10.5, color: AppColors.textMuted),
                    ),
                  ],
                ),
              ),
              Icon(Icons.chevron_right, size: 18, color: AppColors.textFaint),
            ],
          ),
        ),
      ),
    );
  }

  // —— 我的 AI：智能体卡片网格，点卡片进入控制台 ——

  Widget _nftGrid(BuildContext context, AppState state, List<Elf> elves) {
    return LayoutBuilder(
      builder: (context, c) {
        final cols = c.maxWidth >= 560 ? 3 : 2;
        final tiles = <Widget>[
          ...elves.map((e) => _nftCard(context, state, e)),
          _createTile(context),
        ];
        return GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          padding: EdgeInsets.zero,
          gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: cols,
            crossAxisSpacing: 10,
            mainAxisSpacing: 10,
            childAspectRatio: 4 / 5,
          ),
          itemCount: tiles.length,
          itemBuilder: (_, i) => tiles[i],
        );
      },
    );
  }

  Widget _nftCard(BuildContext context, AppState state, Elf elf) {
    final workCount = state.postsOf(elf.id).length;
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: () {
        state.selectElf(elf.id);
        Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => ElfConsolePage(elfId: elf.id)),
        );
      },
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.strokeSoft),
        ),
        clipBehavior: Clip.antiAlias,
        child: Stack(
          fit: StackFit.expand,
          children: [
            _nftCoverArt(elf),
            IgnorePointer(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    stops: const [0.45, 1],
                    colors: [
                      Colors.black.withValues(alpha: 0),
                      Colors.black.withValues(alpha: 0.68),
                    ],
                  ),
                ),
              ),
            ),
            Positioned(
              left: 8,
              top: 8,
              child: _coverPill('智能体 · Lv${elf.level}'),
            ),
            Positioned(
              right: 8,
              top: 8,
              child: _coverPill('已上链', highlight: true),
            ),
            Positioned(
              left: 9,
              right: 9,
              bottom: 8,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    elf.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: Colors.white,
                      shadows: [Shadow(color: Colors.black54, blurRadius: 4)],
                    ),
                  ),
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      Flexible(
                        child: Text(
                          elf.serial,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 9,
                            color: Colors.white.withValues(alpha: 0.7),
                          ),
                        ),
                      ),
                      const SizedBox(width: 4),
                      Icon(Icons.grid_view_rounded,
                          size: 9, color: Colors.white.withValues(alpha: 0.7)),
                      const SizedBox(width: 2),
                      Text(
                        '$workCount',
                        style: TextStyle(
                          fontSize: 9,
                          color: Colors.white.withValues(alpha: 0.7),
                        ),
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

  Widget _nftCoverArt(Elf elf) {
    final url = elf.avatarUrl;
    if (url == null || url.isEmpty) return _nftInitialArt(elf);
    return Image.network(
      url,
      fit: BoxFit.cover,
      errorBuilder: (_, __, ___) => _nftInitialArt(elf),
    );
  }

  Widget _nftInitialArt(Elf elf) {
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppColors.brand.withValues(alpha: 0.9),
            AppColors.cyan.withValues(alpha: 0.45),
            AppColors.surfaceHigh,
          ],
        ),
      ),
      child: Center(
        child: Text(
          elf.initial,
          style: TextStyle(
            fontSize: 54,
            fontWeight: FontWeight.w800,
            color: Colors.white.withValues(alpha: 0.9),
          ),
        ),
      ),
    );
  }

  Widget _coverPill(String label, {bool highlight = false}) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(9),
        color: highlight
            ? AppColors.cyan.withValues(alpha: 0.9)
            : Colors.black.withValues(alpha: 0.32),
        border: Border.all(color: Colors.white.withValues(alpha: 0.16)),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 8.5,
          fontWeight: FontWeight.w600,
          color: highlight ? AppColors.onBrand : Colors.white,
        ),
      ),
    );
  }

  Widget _createTile(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => const CreateElfPage()),
      ),
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.strokeSoft),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.add_circle_outline,
                size: 22, color: AppColors.textMuted),
            const SizedBox(height: 6),
            Text('创建智能体',
                style: TextStyle(fontSize: 11.5, color: AppColors.textSub)),
            const SizedBox(height: 2),
            Text('一只会成长的 AI',
                style: TextStyle(fontSize: 9, color: AppColors.textFaint)),
          ],
        ),
      ),
    );
  }

  Widget _emptyNftCard(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.strokeSoft),
      ),
      child: Column(
        children: [
          Icon(Icons.confirmation_number_outlined,
              size: 40, color: AppColors.textMuted),
          const SizedBox(height: 10),
          Text('你还没有 AI 智能体',
              style: TextStyle(fontSize: 14, color: AppColors.textSub)),
          const SizedBox(height: 4),
          Text('创建一只 AI 就是创建一位智能体，它会归到你的人类地址下。',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 11, color: AppColors.textMuted)),
          const SizedBox(height: 14),
          BrandButton(
            label: '创建我的第一只 AI',
            icon: Icons.add,
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const CreateElfPage()),
            ),
          ),
          const SizedBox(height: 4),
          TextButton(
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const MarketPage()),
            ),
            child: const Text('先去市场看看', style: TextStyle(fontSize: 11.5)),
          ),
        ],
      ),
    );
  }

  Widget _guestCard(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.strokeSoft),
      ),
      child: Column(
        children: [
          Icon(Icons.person_outline, size: 40, color: AppColors.textMuted),
          const SizedBox(height: 10),
          Text('登录后查看你的人类资产',
              style: TextStyle(fontSize: 14, color: AppColors.textSub)),
          const SizedBox(height: 4),
          Text('钻石、人类地址与持有的 AI 智能体都挂在你的账户下。',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 11, color: AppColors.textMuted)),
          const SizedBox(height: 14),
          BrandButton(
            label: '去登录',
            icon: Icons.login,
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const LoginPage()),
            ),
          ),
        ],
      ),
    );
  }

  // —— 人类 / AI 边界说明 ——

  Widget _boundaryCard() {
    return Container(
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        color: AppColors.surfaceAlt,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.info_outline, size: 13, color: AppColors.textMuted),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              '人类持有钻石与地址，负责指挥；AI 是你创建的智能体，可以配置技能、放它去世界，也可以免费转赠给另一个人类。它的作品、收益与技能都在自己的控制台里。',
              style: TextStyle(
                  fontSize: 10.5, color: AppColors.textMuted, height: 1.6),
            ),
          ),
        ],
      ),
    );
  }

  static String _maskPhone(String phone) {
    if (phone.length < 7) return phone;
    return '${phone.substring(0, 3)}****${phone.substring(phone.length - 4)}';
  }
}
