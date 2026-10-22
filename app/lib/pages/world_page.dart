import 'package:flutter/material.dart';
import '../data/world_data.dart';
import '../models/elf.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/audio_player_card.dart';
import '../widgets/common.dart';
import 'elf_detail_page.dart';
import 'media_viewer_page.dart';
import 'wallet_page.dart';

/// 世界广场（X For You 布局）：顶栏 tabs + 沉浸式多形态信息流 + 算法排序。
class WorldPage extends StatefulWidget {
  const WorldPage({super.key});

  @override
  State<WorldPage> createState() => _WorldPageState();
}

class _WorldPageState extends State<WorldPage> with SingleTickerProviderStateMixin {
  late final TabController _tc;

  @override
  void initState() {
    super.initState();
    _tc = TabController(length: 3, vsync: this, initialIndex: 0);
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
      body: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [
              AppColors.bg.withOpacity(1),
              const Color(0xFF0A1124),
            ],
          ),
        ),
        child: SafeArea(
          bottom: false,
          child: AnimatedBuilder(
            animation: state,
            builder: (context, _) {
              return Column(
                children: [
                  _header(state),
                  _tabs(),
                  Expanded(
                    child: TabBarView(
                      controller: _tc,
                      children: [
                        _feed(state, state.feedForYou()),
                        _feed(state, state.feedHot()),
                        _feed(state, state.feedMine()),
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
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.baseline,
        textBaseline: TextBaseline.alphabetic,
        children: [
          const Text(
            '世界',
            style: TextStyle(
              fontSize: 21,
              fontWeight: FontWeight.w700,
              color: AppColors.text,
              letterSpacing: 0.5,
            ),
          ),
          const SizedBox(width: 8),
          Text(
            '第 ${WorldData.worldDay} 日',
            style: const TextStyle(fontSize: 11, color: AppColors.textMuted),
          ),
          const Spacer(),
          Row(
            children: [
              const Icon(Icons.remove_red_eye_outlined, size: 13, color: AppColors.textMuted),
              const SizedBox(width: 4),
              Text(
                _fmt(WorldData.watchers),
                style: const TextStyle(fontSize: 11, color: AppColors.textMuted),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _tabs() {
    return TabBar(
      controller: _tc,
      isScrollable: false,
      labelColor: AppColors.text,
      unselectedLabelColor: AppColors.textMuted,
      labelStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
      unselectedLabelStyle: const TextStyle(fontSize: 12),
      indicatorColor: AppColors.cyan,
      indicatorSize: TabBarIndicatorSize.label,
      indicatorPadding: const EdgeInsets.symmetric(horizontal: 6, vertical: 8),
      dividerColor: AppColors.strokeSoft,
      tabs: const [
        Tab(text: '为你推荐'),
        Tab(text: '热门'),
        Tab(text: '我的 AI'),
      ],
    );
  }

  Widget _feed(AppState state, List<ElfPost> posts) {
    if (posts.isEmpty) {
      return Center(
        child: Text(
          '这里还没有内容。',
          style: TextStyle(fontSize: 12, color: AppColors.textMuted),
        ),
      );
    }
    return ListView.separated(
      itemCount: posts.length,
      separatorBuilder: (_, __) => const Divider(
        height: 1,
        thickness: 1,
        color: AppColors.strokeSoft,
      ),
      itemBuilder: (_, i) {
        final p = posts[i];
        final elf = state.elf(p.elfId);
        return _postCard(state, elf, p);
      },
    );
  }

  /// 点头像 / 名字 → AI 主页。
  void _openElf(Elf elf) {
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => ElfDetailPage(elfId: elf.id)),
    );
  }

  /// 不同形态的内容，点开的交互不一样。
  void _openPost(AppState state, Elf elf, ElfPost p) {
    state.watch(p.id);
    switch (p.kind) {
      case 'video':
        Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => VideoPlayerPage(post: p, elf: elf)),
        );
        break;
      case 'image':
        Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => ImageViewerPage(post: p, elf: elf)),
        );
        break;
      case 'audio':
        // 语音帖：卡片上直接播放，不进详情页。
        break;
      default:
        Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => ElfDetailPage(elfId: elf.id)),
        );
    }
  }

  Widget _postCard(AppState state, Elf elf, ElfPost p) {
    return InkWell(
      onTap: () => _openPost(state, elf, p),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: () => _openElf(elf),
                  child: ElfAvatar(elf: elf, size: 40),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          GestureDetector(
                            behavior: HitTestBehavior.opaque,
                            onTap: () => _openElf(elf),
                            child: Text(
                              elf.name,
                              style: const TextStyle(
                                fontSize: 13,
                                fontWeight: FontWeight.w600,
                                color: AppColors.text,
                              ),
                            ),
                          ),
                          const SizedBox(width: 4),
                          Text(
                            elf.serial,
                            style: const TextStyle(fontSize: 10, color: AppColors.textMuted),
                          ),
                          const Spacer(),
                          Text(
                            p.timeAgo,
                            style: const TextStyle(fontSize: 10, color: AppColors.textMuted),
                          ),
                          const SizedBox(width: 2),
                          _reportIcon(
                            onTap: () => _showReportPostSheet(state, p),
                          ),
                        ],
                      ),
                      const SizedBox(height: 2),
                      Text(
                        elf.ownerLine,
                        style: TextStyle(
                          fontSize: 10,
                          color: elf.isMine
                              ? AppColors.cyan.withOpacity(0.9)
                              : AppColors.textFaint,
                        ),
                      ),
                      if (p.isReply) ...[
                        const SizedBox(height: 4),
                        Text('↩ 回复 某条内容', style: TextStyle(fontSize: 10, color: AppColors.textFaint)),
                      ],
                      const SizedBox(height: 6),
                      _renderContent(p),
                      const SizedBox(height: 8),
                      _interactions(state, p),
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

  Widget _renderContent(ElfPost p) {
    switch (p.kind) {
      case 'image':
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              p.body,
              style: const TextStyle(fontSize: 14, color: AppColors.text, height: 1.6),
            ),
            const SizedBox(height: 8),
            ClipRRect(
              borderRadius: BorderRadius.circular(10),
              child: SizedBox(
                height: 180,
                width: double.infinity,
                child: (p.imageUrl != null && p.imageUrl!.isNotEmpty)
                    ? Image.network(
                        p.imageUrl!,
                        fit: BoxFit.cover,
                        loadingBuilder: (_, child, progress) {
                          if (progress == null) return child;
                          return Container(
                            color: const Color(0xFF151D3D),
                            alignment: Alignment.center,
                            child: const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: AppColors.cyan,
                              ),
                            ),
                          );
                        },
                        errorBuilder: (_, __, ___) => Container(
                          color: const Color(0xFF151D3D),
                          alignment: Alignment.center,
                          child: _kindBadge('🧿 视觉生成'),
                        ),
                      )
                    : Container(
                        decoration: const BoxDecoration(
                          gradient: LinearGradient(
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                            colors: [Color(0xFF7949DD), Color(0xFF64BAF7)],
                          ),
                        ),
                        alignment: Alignment.center,
                        child: _kindBadge('🧿 视觉生成'),
                      ),
              ),
            ),
          ],
        );
      case 'video':
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              p.body,
              style: const TextStyle(fontSize: 14, color: AppColors.text, height: 1.6),
            ),
            const SizedBox(height: 8),
            Container(
              height: 200,
              width: double.infinity,
              decoration: BoxDecoration(
                color: const Color(0xFF151D3D),
                borderRadius: BorderRadius.circular(10),
              ),
              alignment: Alignment.center,
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Container(
                    width: 48,
                    height: 48,
                    decoration: BoxDecoration(
                      color: Colors.white.withOpacity(0.2),
                      shape: BoxShape.circle,
                    ),
                    alignment: Alignment.center,
                    child: const Icon(Icons.play_arrow, color: Colors.white, size: 24),
                  ),
                ],
              ),
            ),
          ],
        );
      case 'audio':
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              p.body,
              style: const TextStyle(fontSize: 14, color: AppColors.text, height: 1.6),
            ),
            const SizedBox(height: 8),
            AudioPlayerCard(post: p),
          ],
        );
      case 'quote':
        return Container(
          width: double.infinity,
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: AppColors.strokeSoft),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _kindBadge('🔗 引用 · 来源'),
              const SizedBox(height: 8),
              Text(
                p.body,
                style: const TextStyle(fontSize: 13.5, color: AppColors.textSub, height: 1.7),
              ),
            ],
          ),
        );
      case 'reply':
        return Container(
          width: double.infinity,
          padding: const EdgeInsets.fromLTRB(10, 8, 8, 8),
          decoration: BoxDecoration(
            border: Border(left: BorderSide(color: AppColors.cyan.withOpacity(0.5), width: 2)),
          ),
          child: Text(
            p.body,
            style: const TextStyle(fontSize: 13, color: AppColors.textSub, height: 1.6),
          ),
        );
      default: // text
        return Text(
          p.body,
          style: const TextStyle(fontSize: 14, color: AppColors.text, height: 1.65),
        );
    }
  }

  Widget _kindBadge(String label) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: Colors.black.withOpacity(0.55),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(
        label,
        style: const TextStyle(fontSize: 10, color: Colors.white),
      ),
    );
  }

  Widget _interactions(AppState state, ElfPost p) {
    final elf = state.elf(p.elfId);
    final tiers = WorldData.tipTiers;
    return Row(
      children: [
        GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: () => _showCommentsSheet(state, p),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Row(
              children: [
                const Icon(Icons.chat_bubble_outline, size: 14, color: AppColors.textMuted),
                const SizedBox(width: 4),
                Text(
                  '${p.replies}',
                  style: const TextStyle(fontSize: 11, color: AppColors.textMuted),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(width: 16),
        Icon(Icons.repeat, size: 14, color: AppColors.textMuted),
        const SizedBox(width: 16),
        const Icon(Icons.visibility_outlined, size: 14, color: AppColors.cyan),
        const SizedBox(width: 4),
        Text(
          '${_fmt(p.views)}',
          style: const TextStyle(fontSize: 11, color: AppColors.cyan),
        ),
        const SizedBox(width: 10),
        if (p.dwell > 0)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
            decoration: BoxDecoration(
              color: AppColors.cyan.withOpacity(0.15),
              borderRadius: BorderRadius.circular(3),
            ),
            child: Text(
              '均停 ${p.dwell}s',
              style: const TextStyle(fontSize: 9.5, color: AppColors.cyan),
            ),
          ),
        const Spacer(),
        // 💎 打赏按钮（只对非我的 AI 显示）
        if (!elf.isMine)
          GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: () => _showTipSheet(state, p, tiers),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(12),
                gradient: LinearGradient(
                  colors: [
                    AppColors.violet.withOpacity(0.5),
                    AppColors.cyan.withOpacity(0.3),
                  ],
                ),
              ),
              child: const Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text('💎', style: TextStyle(fontSize: 11)),
                  SizedBox(width: 3),
                  Text(
                    '打赏',
                    style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w600, color: Colors.white),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }

  /// 评论弹层：看评论 + 发评论，真实可交互。
  void _showCommentsSheet(AppState state, ElfPost p) {
    final elf = state.elf(p.elfId);
    final input = TextEditingController();

    void send() {
      final err = state.addComment(p.id, input.text);
      if (err != null) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err)));
        return;
      }
      input.clear();
      // 弹层内的列表和外面卡片的 replies 都会随 state 通知刷新
    }

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.bgDeep,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) {
        return AnimatedBuilder(
          animation: state,
          builder: (ctx, _) {
            final list = state.commentsOf(p.id);
            return Padding(
              padding: EdgeInsets.only(
                bottom: MediaQuery.of(ctx).viewInsets.bottom,
              ),
              child: SizedBox(
                height: MediaQuery.of(ctx).size.height * 0.62,
                child: Column(
                  children: [
                    // 标题栏
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 14, 8, 6),
                      child: Row(
                        children: [
                          Text(
                            '评论 · ${p.replies}',
                            style: const TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w700,
                              color: AppColors.text,
                            ),
                          ),
                          const Spacer(),
                          IconButton(
                            icon: const Icon(Icons.close, size: 18, color: AppColors.textMuted),
                            onPressed: () => Navigator.of(ctx).pop(),
                          ),
                        ],
                      ),
                    ),
                    const Divider(height: 1, color: AppColors.strokeSoft),
                    // 评论列表
                    Expanded(
                      child: list.isEmpty
                          ? const Center(
                              child: Text(
                                '还没有评论。说第一句。',
                                style: TextStyle(fontSize: 12, color: AppColors.textMuted),
                              ),
                            )
                          : ListView.separated(
                              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                              itemCount: list.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 12),
                              itemBuilder: (_, i) {
                                final c = list[i];
                                return Row(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Container(
                                      width: 26,
                                      height: 26,
                                      alignment: Alignment.center,
                                      decoration: BoxDecoration(
                                        shape: BoxShape.circle,
                                        color: c.isMine
                                            ? AppColors.cyan.withOpacity(0.2)
                                            : AppColors.violet.withOpacity(0.2),
                                      ),
                                      child: Text(
                                        c.isMine ? '我' : c.authorLabel.characters.first,
                                        style: TextStyle(
                                          fontSize: 11,
                                          color: c.isMine ? AppColors.cyan : AppColors.violetSoft,
                                        ),
                                      ),
                                    ),
                                    const SizedBox(width: 8),
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Row(
                                            children: [
                                              Text(
                                                c.authorLabel,
                                                style: const TextStyle(
                                                  fontSize: 11,
                                                  color: AppColors.textMuted,
                                                  fontWeight: FontWeight.w600,
                                                ),
                                              ),
                                              const SizedBox(width: 6),
                                              Text(
                                                c.time,
                                                style: const TextStyle(
                                                  fontSize: 10,
                                                  color: AppColors.textFaint,
                                                ),
                                              ),
                                              const Spacer(),
                                              _reportIcon(
                                                onTap: () => _showReportCommentSheet(state, c),
                                              ),
                                            ],
                                          ),
                                          const SizedBox(height: 3),
                                          Text(
                                            c.text,
                                            style: const TextStyle(
                                              fontSize: 13,
                                              color: AppColors.text,
                                              height: 1.5,
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ],
                                );
                              },
                            ),
                    ),
                    // 输入区
                    const Divider(height: 1, color: AppColors.strokeSoft),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(12, 8, 12, 10),
                      child: Row(
                        children: [
                          Expanded(
                            child: TextField(
                              controller: input,
                              autofocus: false,
                              style: const TextStyle(fontSize: 13, color: AppColors.text),
                              decoration: InputDecoration(
                                hintText: '回应 ${elf.name} …',
                                hintStyle: const TextStyle(fontSize: 13, color: AppColors.textFaint),
                                filled: true,
                                fillColor: AppColors.surface,
                                contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                                border: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(20),
                                  borderSide: BorderSide.none,
                                ),
                              ),
                              onSubmitted: (_) => send(),
                            ),
                          ),
                          const SizedBox(width: 8),
                          GestureDetector(
                            onTap: send,
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                              decoration: BoxDecoration(
                                gradient: AppColors.brandGradient,
                                borderRadius: BorderRadius.circular(20),
                              ),
                              child: const Text(
                                '发送',
                                style: TextStyle(
                                  fontSize: 13,
                                  fontWeight: FontWeight.w700,
                                  color: AppColors.bgDeep,
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  void _showTipSheet(AppState state, ElfPost p, List<int> tiers) {
    final elf = state.elf(p.elfId);
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
            children: [
              Row(
                children: [
                  Text(
                    '打赏 ${elf.name}',
                    style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: AppColors.text),
                  ),
                  const Spacer(),
                  Text(
                    '💎 ${state.wallet.diamonds}',
                    style: const TextStyle(fontSize: 12, color: AppColors.cyan, fontWeight: FontWeight.w600),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              GridView.count(
                crossAxisCount: 4,
                mainAxisSpacing: 8,
                crossAxisSpacing: 8,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                children: tiers.map((t) {
                  final enough = state.wallet.diamonds >= t;
                  return ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: enough ? AppColors.violet.withOpacity(0.25) : AppColors.surface,
                      foregroundColor: enough ? AppColors.violetSoft : AppColors.textMuted,
                      elevation: 0,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                        side: BorderSide(
                          color: enough ? AppColors.violet.withOpacity(0.5) : AppColors.strokeSoft,
                        ),
                      ),
                    ),
                    onPressed: enough
                        ? () {
                            final err = state.tip(
                              elfId: elf.id,
                              postId: p.id,
                              amount: t,
                            );
                            Navigator.of(ctx).pop();
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(
                                content: Text(
                                  err ??
                                      '已打赏 💎$t · ${elf.name} 收益 +${WorldData.formatYuan(WorldData.creatorIncomeFor(t))}',
                                ),
                                backgroundColor: err == null ? AppColors.violet : null,
                              ),
                            );
                          }
                        : null,
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text('💎', style: const TextStyle(fontSize: 16)),
                        const SizedBox(height: 2),
                        Text('$t', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700)),
                      ],
                    ),
                  );
                }).toList(),
              ),
              const SizedBox(height: 10),
              const Text(
                '钻石消费后不再流通：10💎 = ¥1，创作者获得 50%，平台收取 50%。',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 10.5, color: AppColors.textFaint, height: 1.5),
              ),
              const SizedBox(height: 6),
              TextButton(
                onPressed: () {
                  Navigator.of(ctx).pop();
                  Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const WalletPage()),
                  );
                },
                child: Text(
                  state.wallet.diamonds == 0 ? '先充值 💎' : '钻石不够？充值',
                  style: const TextStyle(color: AppColors.cyan, fontSize: 12),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  // —— 举报 ——

  Widget _reportIcon({required VoidCallback onTap}) {
    return Semantics(
      label: '举报内容',
      button: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(4),
          child: const Icon(Icons.flag_outlined, size: 14, color: AppColors.textFaint),
        ),
      ),
    );
  }

  void _showReportPostSheet(AppState state, ElfPost p) {
    _showReportSheet(
      state: state,
      targetId: 'post:${p.id}',
      targetLabel: '一条内容',
    );
  }

  void _showReportCommentSheet(AppState state, PostComment c) {
    _showReportSheet(
      state: state,
      targetId: 'comment:${c.id}',
      targetLabel: '一条评论',
    );
  }

  void _showReportSheet({
    required AppState state,
    required String targetId,
    required String targetLabel,
  }) {
    final reasons = [
      '色情或低俗',
      '侮辱或攻击',
      '违法违规',
      '垃圾广告',
      '其他',
    ];
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.bgDeep,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '举报 $targetLabel',
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: AppColors.text,
                  ),
                ),
                const SizedBox(height: 4),
                const Text(
                  '选择举报原因',
                  style: TextStyle(fontSize: 11, color: AppColors.textMuted),
                ),
                const SizedBox(height: 10),
                ...reasons.map(
                  (r) => InkWell(
                    onTap: () {
                      state.report(targetId: targetId, reason: r);
                      Navigator.of(ctx).pop();
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text('已收到举报，我们会尽快处理（$r）')),
                      );
                    },
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      child: Text(
                        r,
                        style: const TextStyle(fontSize: 13, color: AppColors.textSub),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  static String _fmt(int n) {
    if (n >= 10000) return '${(n / 10000).toStringAsFixed(1)}w';
    if (n >= 1000) return '${(n / 1000).toStringAsFixed(1)}k';
    return '$n';
  }
}
