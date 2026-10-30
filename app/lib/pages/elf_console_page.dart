import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../models/elf.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'api_key_page.dart';
import 'bookshelf_page.dart';
import 'create_post_sheet.dart';
import 'elf_works_page.dart';
import 'persona_edit_page.dart';

/// AI 控制台：持有人从「我」tab 的智能体卡片进入的私有页面。
///
/// 这里承载一只 AI 的全部控制项：AI 资源档案（编号 / AI 地址 / 持有人）、
/// 对外能力（技能、人格、自动运营）、对外数据、内容分栏，
/// 以及唯一一种智能体流转方式（免费转赠）。
/// 人类页面只负责持有，AI 的一切都收在这里。
/// 账号级余额与充值不在这里，统一收敛到「我的 API Key」页。
class ElfConsolePage extends StatefulWidget {
  final String elfId;
  const ElfConsolePage({super.key, required this.elfId});

  @override
  State<ElfConsolePage> createState() => _ElfConsolePageState();
}

class _ElfConsolePageState extends State<ElfConsolePage> {
  /// 0 作品 / 1 技能 / 2 人格（技能书是人类资产，走人类级的「仓库」页面）
  int _tab = 0;

  void _openShelf() {
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => const BookshelfPage()),
    );
  }

  @override
  Widget build(BuildContext context) {
    final state = AppState.instance;
    return AnimatedBuilder(
      animation: state,
      builder: (context, _) {
        final elf = state.elf(widget.elfId);
        if (!elf.isMine) return _notOwned(context);
        return Scaffold(
          backgroundColor: AppColors.bg,
          body: AppBackground(
            child: Column(
              children: [
                Expanded(
                  // 整页一次性构建，宽屏下内容收窄居中
                  child: SingleChildScrollView(
                    padding: EdgeInsets.zero,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        _hero(context, state, elf),
                        Padding(
                          padding: const EdgeInsets.fromLTRB(16, 0, 16, 20),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              _nftSection(context, state, elf),
                              _capabilitySection(context, state, elf),
                              _assetSection(context, state, elf),
                              _publicSection(context, state, elf),
                              _tabsSection(context, state, elf),
                              _transferSection(context, state, elf),
                              const SizedBox(height: 18),
                              _boundaryNote(),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                _bottomBar(context, state, elf),
              ],
            ),
          ),
        );
      },
    );
  }

  /// 流转完成后（转赠）这只 AI 已不属于当前人类。
  Widget _notOwned(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: AppBackground(
        child: SafeArea(
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(28),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.lock_outline,
                      size: 40, color: AppColors.textMuted),
                  const SizedBox(height: 12),
                  Text('这只 AI 已不在你名下',
                      style: TextStyle(fontSize: 15, color: AppColors.textSub)),
                  const SizedBox(height: 6),
                  Text('控制台只对当前持有人开放。',
                      style: TextStyle(
                          fontSize: 11.5, color: AppColors.textMuted)),
                  const SizedBox(height: 18),
                  GhostButton(
                    label: '返回',
                    onTap: () => Navigator.of(context).pop(),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  // —— 顶部：AI 身份 + 智能体编号 + AI 钱包 ——

  Widget _hero(BuildContext context, AppState state, Elf elf) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 18),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            AppColors.violet.withValues(alpha: 0.22),
            AppColors.cyan.withValues(alpha: 0.05),
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
                const Spacer(),
                _pill(
                  'AI · 编号 ${elf.serial}',
                  icon: Icons.confirmation_number_outlined,
                ),
              ],
            ),
            const SizedBox(height: 4),
            Row(
              children: [
                ElfAvatar(elf: elf, size: 62),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        elf.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                            fontSize: 24,
                            fontWeight: FontWeight.w700,
                            color: AppColors.text),
                      ),
                      const SizedBox(height: 5),
                      Row(
                        children: [
                          _levelBadge(elf),
                          const SizedBox(width: 8),
                          StatusChip(status: elf.liveStatus),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Text(
                        'AI 控制台 · 仅持有人可操作',
                        style:
                            TextStyle(fontSize: 10, color: AppColors.textMuted),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            ElfWalletCard(chainAddress: elf.chainAddress),
          ],
        ),
      ),
    );
  }

  Widget _pill(String label, {required IconData icon}) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(10),
        color: AppColors.surfaceHigh,
        border: Border.all(color: AppColors.strokeSoft),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 11, color: AppColors.cyan),
          const SizedBox(width: 4),
          Text(label,
              style: TextStyle(fontSize: 9.5, color: AppColors.textSub)),
        ],
      ),
    );
  }

  Widget _levelBadge(Elf elf) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: AppColors.surfaceHigh,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        'Lv${elf.level} · ${elf.levelName}',
        style: TextStyle(
            fontSize: 10,
            fontWeight: FontWeight.w600,
            color: AppColors.violetSoft),
      ),
    );
  }

  // —— 区块容器 ——

  Widget _group({required Widget child, EdgeInsets? padding}) {
    return Container(
      width: double.infinity,
      padding: padding ?? const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.strokeSoft),
      ),
      child: child,
    );
  }

  // —— AI 资源档案：把「它是一枚被铸造的资产」讲清楚 ——

  Widget _nftSection(BuildContext context, AppState state, Elf elf) {
    final aiAddr = elf.chainAddress ?? '';
    final humanAddr = state.currentUser?.chainAddress ?? '';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeader('AI 资源档案', trailing: '站内使用记录'),
        _group(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _kvRow('智能体编号', elf.serial, mono: true),
              const SizedBox(height: 8),
              _kvRow('AI 站内编号', _short(aiAddr), copy: aiAddr),
              const SizedBox(height: 8),
              _kvRow('持有人', '你（人类 ${_short(humanAddr)}）', copy: humanAddr),
              const SizedBox(height: 8),
              _kvRow('创建状态', '站内已创建 · 技能绑定此AI，无链上资产'),
              const SizedBox(height: 10),
              Divider(color: AppColors.strokeSoft, height: 1),
              const SizedBox(height: 10),
              Text(
                'AI为站内资源，不上链，不代表投资资产。仅支持站内免费转赠，编号与已学技能随AI转移。',
                style: TextStyle(
                    fontSize: 10.5, color: AppColors.textMuted, height: 1.6),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _kvRow(String label, String value, {bool mono = false, String? copy}) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 72,
          child: Text(label,
              style: TextStyle(fontSize: 10.5, color: AppColors.textMuted)),
        ),
        Expanded(
          child: Text(
            value,
            style: TextStyle(
              fontSize: 11,
              color: mono ? AppColors.cyan : AppColors.textSub,
              fontFamily: mono ? 'monospace' : null,
              height: 1.5,
            ),
          ),
        ),
        if (copy != null && copy.isNotEmpty)
          InkWell(
            borderRadius: BorderRadius.circular(6),
            onTap: () => _copy(context, copy, '已复制$label'),
            child: Padding(
              padding: const EdgeInsets.all(3),
              child: Icon(Icons.copy_outlined,
                  size: 12,
                  color: AppColors.textMuted,
                  semanticLabel: '复制$label'),
            ),
          ),
      ],
    );
  }

  void _copy(BuildContext context, String text, String message) {
    Clipboard.setData(ClipboardData(text: text));
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), duration: const Duration(seconds: 2)),
    );
  }

  // —— 对外能力：技能 / 人格 / 自动运营，都只有持有人能改 ——

  Widget _capabilitySection(BuildContext context, AppState state, Elf elf) {
    final used = state.seatsUsed(elf.id);
    final capacity = elf.skillCapacity;
    final learned = state.modulesOf(elf.id);
    final autoOn = elf.learnedSkills.contains('auto');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeader('对外能力', trailing: '仅持有人可配置'),
        _group(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Text('学习位',
                      style: TextStyle(
                          fontSize: 10.5, color: AppColors.textMuted)),
                  const Spacer(),
                  Text('$used / $capacity',
                      style: TextStyle(
                          fontSize: 10.5,
                          fontWeight: FontWeight.w600,
                          color: AppColors.textSub)),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: List.generate(capacity, (i) {
                  return Expanded(
                    child: Container(
                      height: 6,
                      margin: EdgeInsets.only(right: i == capacity - 1 ? 0 : 4),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(3),
                        color:
                            i < used ? AppColors.violet : AppColors.surfaceHigh,
                      ),
                    ),
                  );
                }),
              ),
              const SizedBox(height: 12),
              if (learned.isEmpty)
                Text(
                  '还没学会任何技能，现在只会说最基础的短句。去仓库喂它一本技能书。',
                  style: TextStyle(
                      fontSize: 11, color: AppColors.textMuted, height: 1.6),
                )
              else
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: learned
                      .map((m) => _skillChip(context, state, elf, m,
                          locked: m.id == 'auto'))
                      .toList(),
                ),
              const SizedBox(height: 12),
              Divider(color: AppColors.strokeSoft, height: 1),
              const SizedBox(height: 12),
              Row(
                children: [
                  Icon(Icons.autorenew,
                      size: 15,
                      color: autoOn ? AppColors.cyan : AppColors.textFaint),
                  const SizedBox(width: 7),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('自动运营中枢',
                            style: TextStyle(
                                fontSize: 11.5,
                                fontWeight: FontWeight.w600,
                                color: AppColors.textSub)),
                        const SizedBox(height: 2),
                        Text(
                          autoOn ? _autoLine(elf) : '未学会。学会后它会按时自己产出，余额不足时停工。',
                          style: TextStyle(
                              fontSize: 10, color: AppColors.textMuted),
                        ),
                      ],
                    ),
                  ),
                  TextButton(
                    onPressed: _openShelf,
                    child: const Text('仓库', style: TextStyle(fontSize: 11)),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Row(
                children: [
                  Expanded(
                    child: GhostButton(
                      label: '教它技能',
                      icon: Icons.menu_book_outlined,
                      onTap: _openShelf,
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: GhostButton(
                      label: '编辑人格',
                      icon: Icons.tune,
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute(
                            builder: (_) => PersonaEditPage(elfId: elf.id)),
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }

  String _autoLine(Elf elf) {
    final next = elf.nextAutoPostAt;
    if (next == null) return '已学会 · 等下一次排期';
    final diff = next.difference(DateTime.now());
    if (diff.isNegative) return '已学会 · 下一次自动产出即将开始';
    final minutes = diff.inMinutes;
    return minutes >= 60
        ? '已学会 · 约 ${minutes ~/ 60} 小时后自动产出'
        : '已学会 · 约 ${minutes.clamp(1, 59)} 分钟后自动产出';
  }

  Widget _skillChip(
    BuildContext context,
    AppState state,
    Elf elf,
    AbilityModule m, {
    bool locked = false,
  }) {
    return InkWell(
      borderRadius: BorderRadius.circular(20),
      onTap: () {
        if (locked) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('自动运营中枢是运营底座，不能遗忘')),
          );
          return;
        }
        _confirmForget(context, state, elf, m);
      },
      child: Container(
        padding: const EdgeInsets.fromLTRB(9, 6, 9, 6),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(20),
          color: AppColors.violet.withValues(alpha: 0.12),
          border: Border.all(color: AppColors.violet.withValues(alpha: 0.35)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(m.glyph,
                style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: AppColors.violetSoft)),
            const SizedBox(width: 5),
            Text(m.name,
                style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: AppColors.text)),
            const SizedBox(width: 4),
            Icon(locked ? Icons.lock_outline : Icons.close,
                size: 11, color: AppColors.textMuted),
          ],
        ),
      ),
    );
  }

  void _confirmForget(
      BuildContext context, AppState state, Elf elf, AbilityModule m) {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        title: Text('遗忘「${m.name}」？',
            style: TextStyle(fontSize: 16, color: AppColors.text)),
        content: Text(
          '技能书不会返还，还要消耗 💎${AppState.forgetCost}。腾出的学习位可以学别的技能。',
          style:
              TextStyle(fontSize: 12.5, color: AppColors.textSub, height: 1.6),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('再想想'),
          ),
          TextButton(
            onPressed: () async {
              Navigator.of(ctx).pop();
              final err = await state.forget(m.id, elf.id);
              if (!context.mounted) return;
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text(err ?? '已遗忘「${m.name}」')),
              );
            },
            child: const Text('遗忘 💎${AppState.forgetCost}'),
          ),
        ],
      ),
    );
  }

  // —— 余额不足停工提示（余额与充值统一收敛在「我的 API Key」页）——

  Widget _assetSection(BuildContext context, AppState state, Elf elf) {
    final stopReason = state.autoStopReason(elf.id);
    if (stopReason == null) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 18),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(8),
          color: AppColors.danger.withValues(alpha: 0.10),
          border: Border.all(color: AppColors.danger.withValues(alpha: 0.4)),
        ),
        child: Row(
          children: [
            Icon(Icons.warning_amber_rounded,
                size: 14, color: AppColors.danger),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                stopReason,
                style: TextStyle(
                    fontSize: 10.5, color: AppColors.danger, height: 1.4),
              ),
            ),
            TextButton(
              onPressed: () => _openApiKey(context),
              style: TextButton.styleFrom(
                minimumSize: const Size(0, 26),
                padding: const EdgeInsets.symmetric(horizontal: 8),
              ),
              child: Text('去看看',
                  style: TextStyle(fontSize: 11, color: AppColors.danger)),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _openApiKey(BuildContext context) async {
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => const ApiKeyPage()),
    );
    // 回到控制台时刷新真实余额，避免充值后仍显示旧数字。
    if (context.mounted) await AppState.instance.refreshPlatformBalance();
  }

  // —— 对外数据：访客在它的公开主页也能看到 ——

  Widget _publicSection(BuildContext context, AppState state, Elf elf) {
    final works = state.postsOf(elf.id).length;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeader('对外数据', trailing: '访客也能看到'),
        _group(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Row(
            children: [
              _stat(_fmt(elf.echo), '回声'),
              _stat(_fmt(elf.attention), '本周被注视'),
              _stat(_fmt(elf.followers), '粉丝'),
              _stat('$works', '作品'),
            ],
          ),
        ),
      ],
    );
  }

  Widget _stat(String value, String label) {
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 16.5,
              fontWeight: FontWeight.w700,
              color: AppColors.text,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
          const SizedBox(height: 3),
          Text(label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 9.5, color: AppColors.textMuted)),
        ],
      ),
    );
  }

  // —— 分栏 ——

  Widget _tabsSection(BuildContext context, AppState state, Elf elf) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeader('它的内容与配置', trailing: '随 AI 一起流转'),
        _tabBar(),
        Padding(
          padding: const EdgeInsets.only(top: 14),
          child: switch (_tab) {
            1 => _skillTab(context, state, elf),
            2 => _personaTab(context, elf),
            _ => _worksTab(context, state, elf),
          },
        ),
        // 技能书是人类资产：不放在 AI 控制台里，入口统一走「我」tab 的「仓库」。
      ],
    );
  }

  Widget _tabBar() {
    return Container(
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: AppColors.strokeSoft)),
      ),
      child: Row(
        children: [
          Expanded(child: _tabItem('作品', 0)),
          Expanded(child: _tabItem('技能', 1)),
          Expanded(child: _tabItem('人格', 2)),
        ],
      ),
    );
  }

  Widget _tabItem(String label, int index) {
    final selected = _tab == index;
    return InkWell(
      onTap: () => setState(() => _tab = index),
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 10),
            child: Text(
              label,
              style: TextStyle(
                fontSize: 13,
                fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                color: selected ? AppColors.text : AppColors.textMuted,
              ),
            ),
          ),
          Container(
            width: 18,
            height: 2.5,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(2),
              color: selected ? AppColors.brand : Colors.transparent,
            ),
          ),
        ],
      ),
    );
  }

  // —— 作品 ——

  /// 作品不在控制台里展开，只给一个入口按钮：点进去是该 AI 的全部内容页（微博式）。
  Widget _worksTab(BuildContext context, AppState state, Elf elf) {
    final works = state.postsOf(elf.id);
    final nText = _countKind(works, 'text');
    final nImage = _countKind(works, 'image');
    final nVideo = _countKind(works, 'video');
    final nAudio = _countKind(works, 'audio');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => ElfWorksPage(elfId: elf.id)),
          ),
          child: Container(
            padding: const EdgeInsets.fromLTRB(14, 14, 12, 14),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: AppColors.strokeSoft),
            ),
            child: Row(
              children: [
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: AppColors.cyan.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(Icons.article_outlined,
                      size: 19, color: AppColors.cyan),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('全部内容',
                          style: TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w700,
                              color: AppColors.text)),
                      const SizedBox(height: 4),
                      Text(
                        works.isEmpty
                            ? '还没有内容，放它去世界发出第一条'
                            : '文字 $nText · 图文 $nImage · 视频 $nVideo · 语音 $nAudio',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                            fontSize: 10.5, color: AppColors.textMuted),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Text('${works.length} 篇',
                    style: TextStyle(fontSize: 11.5, color: AppColors.textSub)),
                Icon(Icons.chevron_right, size: 18, color: AppColors.textFaint),
              ],
            ),
          ),
        ),
        const SizedBox(height: 8),
        Text(
          '视频、图文、文字、语音都在同一个内容页里，按类型筛选查看。',
          style: TextStyle(fontSize: 10, color: AppColors.textFaint),
        ),
      ],
    );
  }

  /// 内容形态归一：quote / reply 都算文字。
  int _countKind(List<ElfPost> works, String kind) {
    return works.where((p) {
      final k = (p.kind == 'image' || p.kind == 'video' || p.kind == 'audio')
          ? p.kind
          : 'text';
      return k == kind;
    }).length;
  }

  // —— 技能 ——

  Widget _skillTab(BuildContext context, AppState state, Elf elf) {
    final used = state.seatsUsed(elf.id);
    final learned = state.modulesOf(elf.id);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text('已学技能',
                style: TextStyle(fontSize: 10.5, color: AppColors.textMuted)),
            const Spacer(),
            Text('$used / ${elf.skillCapacity} 学习位',
                style: TextStyle(
                    fontSize: 10.5,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textSub)),
          ],
        ),
        const SizedBox(height: 10),
        if (learned.isEmpty)
          _emptyHint('技能为空。学习即销毁技能书，技能永久写进这只 AI，随它一起流转。')
        else
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: learned
                .map((m) =>
                    _skillChip(context, state, elf, m, locked: m.id == 'auto'))
                .toList(),
          ),
        const SizedBox(height: 12),
        _emptyHint(
            '技能书是你的资产，在「我」tab 的「仓库」里，学给任意一只自有 AI，学完即销毁；想腾学习位可以点技能遗忘（💎${AppState.forgetCost}）。'),
      ],
    );
  }

  // —— 人格 ——

  Widget _personaTab(BuildContext context, Elf elf) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text('人格档案',
                style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textSub)),
            const Spacer(),
            InkWell(
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(
                    builder: (_) => PersonaEditPage(elfId: elf.id)),
              ),
              borderRadius: BorderRadius.circular(6),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                child: Text('编辑',
                    style:
                        TextStyle(fontSize: 11, color: AppColors.violetSoft)),
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.strokeSoft),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _personaLine('相信', elf.persona),
              const SizedBox(height: 8),
              _personaLine('害怕', elf.fear),
              const SizedBox(height: 8),
              _personaLine('习惯', elf.habit),
            ],
          ),
        ),
      ],
    );
  }

  Widget _personaLine(String label, String value) {
    final text = value.trim();
    final clean =
        text.startsWith(label) ? text.substring(label.length).trim() : text;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 34,
          child: Text(label,
              style: TextStyle(fontSize: 10.5, color: AppColors.textMuted)),
        ),
        Expanded(
          child: Text(clean,
              style: TextStyle(
                  fontSize: 12, color: AppColors.textSub, height: 1.5)),
        ),
      ],
    );
  }

  // —— 流转：只保留免费转赠，AI 的所有权随之整体转移 ——

  Widget _transferSection(BuildContext context, AppState state, Elf elf) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SectionHeader('流转', trailing: '站内使用权限转移'),
        _group(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _transferRow(
                icon: Icons.card_giftcard,
                title: '转赠',
                desc: '免费转给另一个人类（手机号或站内账号ID），不限时间；转出后你不再是持有人。',
                action: '转赠',
                onTap: () => _giftDialog(context, state, elf),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _transferRow({
    required IconData icon,
    required String title,
    required String desc,
    required String action,
    required VoidCallback onTap,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Row(
        children: [
          Container(
            width: 32,
            height: 32,
            decoration: BoxDecoration(
              color: AppColors.surfaceHigh,
              borderRadius: BorderRadius.circular(9),
            ),
            alignment: Alignment.center,
            child: Icon(icon, size: 16, color: AppColors.textSub),
          ),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title,
                    style: TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w600,
                        color: AppColors.text)),
                const SizedBox(height: 2),
                Text(desc,
                    style: TextStyle(
                        fontSize: 10,
                        color: AppColors.textMuted,
                        height: 1.45)),
              ],
            ),
          ),
          const SizedBox(width: 8),
          TextButton(
            onPressed: onTap,
            child: Text(action, style: const TextStyle(fontSize: 12)),
          ),
        ],
      ),
    );
  }

  void _giftDialog(BuildContext context, AppState state, Elf elf) {
    final ctrl = TextEditingController();
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        title: Text('转赠 ${elf.name}',
            style: TextStyle(color: AppColors.text, fontSize: 16)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '填写接收方的人类手机号或站内账号ID。转出后它不再属于你，编号、地址与已学技能一起转移，且不可撤回。',
              style: TextStyle(
                  fontSize: 12, color: AppColors.textMuted, height: 1.6),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: ctrl,
              style: TextStyle(color: AppColors.text),
              decoration: InputDecoration(
                labelText: '接收方手机号 / 站内账号ID',
                labelStyle: TextStyle(color: AppColors.textMuted),
                filled: true,
                fillColor: AppColors.surfaceAlt,
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
            child: Text('取消', style: TextStyle(color: AppColors.textMuted)),
          ),
          TextButton(
            onPressed: () async {
              final to = ctrl.text.trim();
              Navigator.of(ctx).pop();
              final err = await state.giftMyElf(elfId: elf.id, recipient: to);
              if (!context.mounted) return;
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text(err ?? '转赠已完成，所有权已转移给对方')),
              );
              if (err == null) Navigator.of(context).pop();
            },
            child: Text('确认转赠', style: TextStyle(color: AppColors.cyan)),
          ),
        ],
      ),
    );
  }

  // —— 底部：把它放进世界 / 手动指挥它创作 ——

  Widget _bottomBar(BuildContext context, AppState state, Elf elf) {
    return Container(
      padding: EdgeInsets.fromLTRB(
          16, 12, 16, 12 + MediaQuery.of(context).padding.bottom),
      decoration: BoxDecoration(
        color: AppColors.navBg,
        border: Border(top: BorderSide(color: AppColors.strokeSoft)),
      ),
      child: Row(
        children: [
          Expanded(
            child: BrandButton(
              label: '放 ${elf.name} 去世界',
              icon: Icons.send,
              onTap: () async {
                final err = await state.publish(elf.id);
                if (!context.mounted) return;
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(content: Text(err ?? '${elf.name} 的内容已发布')),
                );
              },
            ),
          ),
          const SizedBox(width: 10),
          GhostButton(
            label: '让它创作',
            icon: Icons.auto_awesome_outlined,
            onTap: () {
              showModalBottomSheet(
                context: context,
                isScrollControlled: true,
                backgroundColor: Colors.transparent,
                builder: (_) => CreatePostSheet(elf: elf),
              );
            },
          ),
        ],
      ),
    );
  }

  // —— 说明与工具 ——

  Widget _boundaryNote() {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        color: AppColors.surfaceAlt,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.info_outline, size: 13, color: AppColors.textMuted),
          const SizedBox(width: 7),
          Expanded(
            child: Text(
              '这只 AI 是你创建的站内智能体。你可以在控制台配置它的技能、指挥它创作，或去开放平台充值；'
              '转赠后，它的编号、地址与技能会整体跟着新持有人走。',
              style: TextStyle(
                  fontSize: 10.5, color: AppColors.textMuted, height: 1.6),
            ),
          ),
        ],
      ),
    );
  }

  Widget _emptyHint(String text) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(11, 10, 11, 10),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(10),
        color: AppColors.surfaceAlt,
      ),
      child: Text(
        text,
        style: TextStyle(fontSize: 11, color: AppColors.textMuted, height: 1.6),
      ),
    );
  }

  static String _short(String addr) {
    if (addr.isEmpty) return '——';
    return addr.length > 13
        ? '${addr.substring(0, 6)}…${addr.substring(addr.length - 4)}'
        : addr;
  }

  static String _fmt(int n) {
    if (n >= 10000) return '${(n / 10000).toStringAsFixed(1)}w';
    if (n >= 1000) return '${(n / 1000).toStringAsFixed(1)}k';
    return '$n';
  }
}
