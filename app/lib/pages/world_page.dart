import 'dart:async';

import 'package:flutter/material.dart';

import '../data/world_data.dart';
import '../models/elf.dart';
import '../services/app_content_service.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/audio_player_card.dart';
import '../widgets/common.dart';
import '../widgets/stage_share_sheet.dart';
import 'elf_chat_page.dart';
import 'login_page.dart';
import 'attention_board_page.dart';
import 'media_viewer_page.dart';
import 'post_detail_page.dart';
import 'upload_video_sheet.dart';
import 'video_feed_page.dart';
import 'wallet_page.dart';

/// 世界广场（X For You 布局）：顶栏 tabs + 沉浸式多形态信息流 + 算法排序。
class WorldPage extends StatefulWidget {
  const WorldPage({super.key});

  @override
  State<WorldPage> createState() => _WorldPageState();
}

class _WorldPageState extends State<WorldPage>
    with SingleTickerProviderStateMixin {
  late final TabController _tc;

  /// 首次信息流请求要等钱包快照就绪（loadFeed 需要确认计费环境），
  /// 所以先监听状态，就绪后补一次拉取，避免首屏空着再也不加载。
  bool _kickedOff = false;

  @override
  void initState() {
    super.initState();
    _tc = TabController(length: 3, vsync: this, initialIndex: 0);
    _tc.addListener(_onTabChanged);
    AppState.instance.addListener(_tryKickoffFeed);
    WidgetsBinding.instance.addPostFrameCallback((_) => _tryKickoffFeed());
  }

  void _tryKickoffFeed() {
    if (_kickedOff || !mounted) return;
    final state = AppState.instance;
    // 未登录时不需要拉流；钱包就绪后再拉，否则请求会因环境未确认被丢掉。
    if (state.currentUser == null || !state.commerceReady) return;
    _kickedOff = true;
    state.loadFeed();
  }

  /// 切换 tab 时才向服务端要该榜单，避免一次拉三条流。
  void _onTabChanged() {
    if (_tc.indexIsChanging) return;
    final sort = switch (_tc.index) { 1 => 'hot', 2 => 'mine', _ => 'recommend' };
    AppState.instance.loadFeed(sort: sort);
  }

  @override
  void dispose() {
    AppState.instance.removeListener(_tryKickoffFeed);
    _tc.removeListener(_onTabChanged);
    _tc.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = AppState.instance;
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: Stack(
        children: [
          Positioned.fill(
            child: Container(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    AppColors.bg.withOpacity(1),
                    AppColors.surfaceAlt,
                  ],
                ),
              ),
              child: SafeArea(
                bottom: false,
                child: AnimatedBuilder(
                  animation: state,
                  builder: (context, _) {
                    // 桌面宽屏：头部/标签/信息流整体收窄居中（类似微博网页版）。
                    return WideContent(
                      maxWidth: 760,
                      child: Column(
                        children: [
                          _header(state),
                          _tabs(),
                          Expanded(
                            child: TabBarView(
                              controller: _tc,
                              children: [
                                _feed(state, state.feedForYou(), 'recommend'),
                                _feed(state, state.feedHot(), 'hot'),
                                _feed(state, state.feedMine(), 'mine'),
                              ],
                            ),
                          ),
                        ],
                      ),
                    );
                  },
                ),
              ),
            ),
          ),
          // 右下角悬浮加号：上传 AI 生成的视频内容。
          Positioned(
            right: 16,
            bottom: 20,
            child: _uploadVideoButton(),
          ),
        ],
      ),
    );
  }

  Widget _uploadVideoButton() {
    return Semantics(
      label: '上传 AI 生成的视频',
      button: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: () {
          if (!checkLoginOrPrompt(context)) return;
          showModalBottomSheet(
            context: context,
            isScrollControlled: true,
            backgroundColor: Colors.transparent,
            builder: (_) => const UploadVideoSheet(),
          );
        },
        child: Container(
          width: 50,
          height: 50,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: AppColors.brandGradient,
            boxShadow: [
              BoxShadow(
                color: AppColors.violet.withOpacity(0.45),
                blurRadius: 16,
                offset: const Offset(0, 6),
              ),
            ],
          ),
          child: const Icon(Icons.add, size: 26, color: Colors.white),
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
          Text(
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
            style: TextStyle(fontSize: 11, color: AppColors.textMuted),
          ),
          const Spacer(),
          Semantics(
            label: '注视流向榜',
            button: true,
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const AttentionBoardPage()),
              ),
              child: Padding(
                padding: EdgeInsets.only(right: 10, top: 2, bottom: 2),
                child: Icon(Icons.leaderboard_outlined, size: 17, color: AppColors.textMuted),
              ),
            ),
          ),
          Row(
            children: [
              Icon(Icons.remove_red_eye_outlined,
                  size: 13, color: AppColors.textMuted),
              const SizedBox(width: 4),
              Text(
                _fmt(WorldData.watchers),
                style:
                    TextStyle(fontSize: 11, color: AppColors.textMuted),
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

  Widget _feed(AppState state, List<ElfPost> posts, String sort) {
    final loading = state.feedLoading('world', sort: sort);
    if (posts.isEmpty) {
      return Center(
        child: Text(
          loading ? '正在加载…' : '这里还没有内容。',
          style: TextStyle(fontSize: 12, color: AppColors.textMuted),
        ),
      );
    }
    final hasMore = state.feedHasMore('world', sort: sort);
    return NotificationListener<ScrollNotification>(
      // 触底前一屏就请求下一页，滚动不出现明显停顿。
      onNotification: (n) {
        if (n.metrics.extentAfter < 400 && hasMore) {
          unawaited(state.loadFeed(sort: sort));
        }
        return false;
      },
      child: ListView.separated(
        itemCount: posts.length + (loading || hasMore ? 1 : 0),
        separatorBuilder: (_, __) => Divider(
          height: 1,
          thickness: 1,
          color: AppColors.strokeSoft,
        ),
        itemBuilder: (_, i) {
          if (i >= posts.length) return _feedFooter(loading, hasMore, sort);
          final p = posts[i];
          final elf = state.elf(p.elfId);
          return _postCard(state, elf, p);
        },
      ),
    );
  }

  Widget _feedFooter(bool loading, bool hasMore, String sort) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 18),
      child: Center(
        child: loading
            ? const SizedBox(
                width: 14,
                height: 14,
                child: CircularProgressIndicator(strokeWidth: 2))
            : TextButton(
                onPressed: hasMore
                    ? () => unawaited(AppState.instance.loadFeed(sort: sort))
                    : null,
                child: Text(
                  '加载更多',
                  style: TextStyle(fontSize: 12, color: AppColors.textMuted),
                ),
              ),
      ),
    );
  }

  /// 点头像 / 名字 → 先进对话页；主页从对话页右上角进。
  void _openElf(Elf elf) {
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => ElfChatPage(elfId: elf.id)),
    );
  }

  /// 不同形态的内容，点开的交互不一样。
  void _openPost(AppState state, Elf elf, ElfPost p) {
    state.watch(p.id);
    switch (p.kind) {
      case 'video':
        // 从世界流点视频直接进入竖屏刷视频模式，从这条开始上下滑。
        Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => VideoFeedPage(
              seedPosts: state.posts.where((item) => item.kind == 'video').toList(),
              startPostId: p.id,
              showBack: true,
            ),
          ),
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
        // 内容详情页展示作品本身，AI 主页从头像进。
        Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => PostDetailPage(post: p, elf: elf)),
        );
    }
  }

  Widget _postCard(AppState state, Elf elf, ElfPost p) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 头部：头像 + 名字（独立点击 → 进对话页）
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
                            style: TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                              color: AppColors.text,
                            ),
                          ),
                        ),
                        const SizedBox(width: 4),
                        Text(
                          elf.serial,
                          style: TextStyle(fontSize: 10, color: AppColors.textMuted),
                        ),
                        if (elf.isOfficial) ...[
                          const SizedBox(width: 4),
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 4, vertical: 1),
                            decoration: BoxDecoration(
                              color: AppColors.cyan.withOpacity(0.14),
                              borderRadius: BorderRadius.circular(3),
                            ),
                            child: Text(
                              '官方',
                              style: TextStyle(
                                  fontSize: 9, color: AppColors.cyan),
                            ),
                          ),
                        ],
                        const Spacer(),
                        Text(
                          p.timeAgo,
                          style: TextStyle(fontSize: 10, color: AppColors.textMuted),
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
                  ],
                ),
              ),
            ],
          ),
          // 内容区域：点击 → 打开帖子（视频进播放器、文字进 AI 详情、图片放大、音频播放）
          InkWell(
            onTap: () => _openPost(state, elf, p),
            child: Padding(
              padding: const EdgeInsets.only(top: 6, left: 50),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (p.isReply) ...[
                    Text('↩ 回复 某条内容', style: TextStyle(fontSize: 10, color: AppColors.textFaint)),
                    const SizedBox(height: 4),
                  ],
                  _renderContent(p),
                  const SizedBox(height: 8),
                  _interactions(state, p),
                ],
              ),
            ),
          ),
        ],
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
              style: TextStyle(
                  fontSize: 14, color: AppColors.text, height: 1.6),
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
                            color: AppColors.surfaceAlt,
                            alignment: Alignment.center,
                            child: SizedBox(
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
                          color: AppColors.surfaceAlt,
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
              style: TextStyle(
                  fontSize: 14, color: AppColors.text, height: 1.6),
            ),
            const SizedBox(height: 8),
            ClipRRect(
              borderRadius: BorderRadius.circular(10),
              child: SizedBox(
                height: 200,
                width: double.infinity,
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    Container(color: AppColors.surfaceAlt),
                    // 封面由服务端从首帧抽帧；老帖没有封面时保留纯色底。
                    if (p.coverUrl != null && p.coverUrl!.isNotEmpty)
                      Image.network(
                        p.coverUrl!,
                        fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) => Container(
                          color: AppColors.surfaceAlt,
                        ),
                      ),
                    Center(
                      child: Container(
                        width: 48,
                        height: 48,
                        decoration: BoxDecoration(
                          color: Colors.black.withOpacity(0.35),
                          shape: BoxShape.circle,
                          border: Border.all(color: Colors.white70, width: 1),
                        ),
                        alignment: Alignment.center,
                        child: const Icon(Icons.play_arrow,
                            color: Colors.white, size: 26),
                      ),
                    ),
                  ],
                ),
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
              style: TextStyle(
                  fontSize: 14, color: AppColors.text, height: 1.6),
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
                style: TextStyle(
                    fontSize: 13.5, color: AppColors.textSub, height: 1.7),
              ),
            ],
          ),
        );
      case 'reply':
        return Container(
          width: double.infinity,
          padding: const EdgeInsets.fromLTRB(10, 8, 8, 8),
          decoration: BoxDecoration(
            border: Border(
                left: BorderSide(
                    color: AppColors.cyan.withOpacity(0.5), width: 2)),
          ),
          child: Text(
            p.body,
            style: TextStyle(
                fontSize: 13, color: AppColors.textSub, height: 1.6),
          ),
        );
      default: // text
        return Text(
          p.body,
          style: TextStyle(
              fontSize: 14, color: AppColors.text, height: 1.65),
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
    final liked = state.isLiked(p.id);
    final collected = state.isCollected(p.id);
    return Row(
      children: [
        // 左侧指标组可横向滚动，窄屏不溢出；打赏按钮常驻右侧
        Expanded(
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
        // 点赞（+1 回声/注视，再点取消回滚）
        GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: () {
            if (checkLoginOrPrompt(context)) state.toggleLike(p.id);
          },
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Row(
              children: [
                Icon(
                  liked ? Icons.favorite : Icons.favorite_border,
                  size: 14,
                  color: liked ? AppColors.cyan : AppColors.textMuted,
                ),
                const SizedBox(width: 4),
                Text(
                  '${p.likes}',
                  style: TextStyle(
                    fontSize: 11,
                    color: liked ? AppColors.cyan : AppColors.textMuted,
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(width: 16),
        GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: () {
            if (checkLoginOrPrompt(context)) _showCommentsSheet(state, p);
          },
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Row(
              children: [
                Icon(Icons.chat_bubble_outline,
                    size: 14, color: AppColors.textMuted),
                const SizedBox(width: 4),
                Text(
                  '${p.replies}',
                  style:
                      TextStyle(fontSize: 11, color: AppColors.textMuted),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(width: 16),
        // 收藏（+3 回声/注视，再点取消回滚）
        GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: () {
            if (checkLoginOrPrompt(context)) state.toggleCollect(p.id);
          },
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Row(
              children: [
                Icon(
                  collected ? Icons.bookmark : Icons.bookmark_border,
                  size: 14,
                  color: collected ? AppColors.violetSoft : AppColors.textMuted,
                ),
                const SizedBox(width: 4),
                Text(
                  '${p.collects}',
                  style: TextStyle(
                    fontSize: 11,
                    color: collected ? AppColors.violetSoft : AppColors.textMuted,
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(width: 16),
        Icon(Icons.visibility_outlined, size: 14, color: AppColors.cyan),
        const SizedBox(width: 4),
        Text(
          '${_fmt(p.views)}',
          style: TextStyle(fontSize: 11, color: AppColors.cyan),
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
              style: TextStyle(fontSize: 9.5, color: AppColors.cyan),
            ),
          ),
        const SizedBox(width: 12),
        // 分享（v1.3：分享卡片 + 落地页引流，分享行为本身不计分）
        GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: () => showStageShare(
            context,
            elf: elf,
            excerpt: p.body.length > 40 ? '${p.body.substring(0, 40)}…' : p.body,
          ),
          child: Padding(
            padding: EdgeInsets.symmetric(vertical: 4),
            child: Icon(Icons.ios_share, size: 14, color: AppColors.textMuted, semanticLabel: '分享'),
          ),
        ),
              ],
            ),
          ),
        ),
        // 💎 打赏按钮（只对非我的 AI 显示；官方账号无持有人，不支持打赏）
        if (!elf.isMine && !elf.isOfficial)
          GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: () {
              if (checkLoginOrPrompt(context)) _showTipSheet(state, p, tiers);
            },
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
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text('💎', style: TextStyle(fontSize: 11)),
                  SizedBox(width: 3),
                  Text(
                    '打赏',
                    style: TextStyle(
                        fontSize: 10.5,
                        fontWeight: FontWeight.w600,
                        color: AppColors.text),
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

    Future<void> send() async {
      // 评论要等服务端回执，先取出 messenger 避免跨 await 使用 context。
      final messenger = ScaffoldMessenger.of(context);
      final err = await state.addComment(p.id, input.text);
      if (err != null) {
        messenger.showSnackBar(SnackBar(content: Text(err)));
        return;
      }
      input.clear();
      // 弹层内的列表和外面卡片的 replies 都会随 state 通知刷新
    }

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
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
                            style: TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w700,
                              color: AppColors.text,
                            ),
                          ),
                          const Spacer(),
                          IconButton(
                            icon: Icon(Icons.close,
                                size: 18, color: AppColors.textMuted),
                            onPressed: () => Navigator.of(ctx).pop(),
                          ),
                        ],
                      ),
                    ),
                    Divider(height: 1, color: AppColors.strokeSoft),
                    // 评论列表
                    Expanded(
                      child: list.isEmpty
                          ? Center(
                              child: Text(
                                '还没有评论。说第一句。',
                                style: TextStyle(
                                    fontSize: 12, color: AppColors.textMuted),
                              ),
                            )
                          : ListView.separated(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 16, vertical: 10),
                              itemCount: list.length,
                              separatorBuilder: (_, __) =>
                                  const SizedBox(height: 12),
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
                                        c.isMine
                                            ? '我'
                                            : c.authorLabel.characters.first,
                                        style: TextStyle(
                                          fontSize: 11,
                                          color: c.isMine
                                              ? AppColors.cyan
                                              : AppColors.violetSoft,
                                        ),
                                      ),
                                    ),
                                    const SizedBox(width: 8),
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment:
                                            CrossAxisAlignment.start,
                                        children: [
                                          Row(
                                            children: [
                                              Text(
                                                c.authorLabel,
                                                style: TextStyle(
                                                  fontSize: 11,
                                                  color: AppColors.textMuted,
                                                  fontWeight: FontWeight.w600,
                                                ),
                                              ),
                                              const SizedBox(width: 6),
                                              Text(
                                                c.time,
                                                style: TextStyle(
                                                  fontSize: 10,
                                                  color: AppColors.textFaint,
                                                ),
                                              ),
                                              const Spacer(),
                                              _reportIcon(
                                                onTap: () =>
                                                    _showReportCommentSheet(
                                                        state, c),
                                              ),
                                            ],
                                          ),
                                          const SizedBox(height: 3),
                                          Text(
                                            c.text,
                                            style: TextStyle(
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
                    Divider(height: 1, color: AppColors.strokeSoft),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(12, 8, 12, 10),
                      child: Row(
                        children: [
                          Expanded(
                            child: TextField(
                              controller: input,
                              autofocus: false,
                              style: TextStyle(
                                  fontSize: 13, color: AppColors.text),
                              decoration: InputDecoration(
                                hintText: '回应 ${elf.name} …',
                                hintStyle: TextStyle(
                                    fontSize: 13, color: AppColors.textFaint),
                                filled: true,
                                fillColor: AppColors.surface,
                                contentPadding: const EdgeInsets.symmetric(
                                    horizontal: 12, vertical: 10),
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
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 16, vertical: 10),
                              decoration: BoxDecoration(
                                gradient: AppColors.brandGradient,
                                borderRadius: BorderRadius.circular(20),
                              ),
                              child: Text(
                                '发送',
                                style: TextStyle(
                                  fontSize: 13,
                                  fontWeight: FontWeight.w700,
                                  color: AppColors.onBrand,
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
      backgroundColor: AppColors.surface,
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
                    style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: AppColors.text),
                  ),
                  const Spacer(),
                  Text(
                    '💎 ${state.wallet.diamonds}',
                    style: TextStyle(
                        fontSize: 12,
                        color: AppColors.cyan,
                        fontWeight: FontWeight.w600),
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
                  final enough = state.wallet.diamonds >= t &&
                      state.wallet.refundDebt == 0 &&
                      state.canTip(elf.id);
                  return ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: enough
                          ? AppColors.violet.withOpacity(0.25)
                          : AppColors.surface,
                      foregroundColor:
                          enough ? AppColors.violetSoft : AppColors.textMuted,
                      elevation: 0,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                        side: BorderSide(
                          color: enough
                              ? AppColors.violet.withOpacity(0.5)
                              : AppColors.strokeSoft,
                        ),
                      ),
                    ),
                    onPressed: enough
                        ? () async {
                            final err = await state.tip(
                              elfId: elf.id,
                              postId: p.id,
                              amount: t,
                            );
                            if (!ctx.mounted || !context.mounted) return;
                            Navigator.of(ctx).pop();
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(
                                content: Text(
                                  err ??
                                      '已打赏 💎$t · ${elf.name} 收益 +${WorldData.formatYuan(WorldData.creatorIncomeFor(t))}',
                                ),
                                backgroundColor:
                                    err == null ? AppColors.violet : null,
                              ),
                            );
                          }
                        : null,
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text('💎', style: const TextStyle(fontSize: 16)),
                        const SizedBox(height: 2),
                        Text('$t',
                            style: const TextStyle(
                                fontSize: 14, fontWeight: FontWeight.w700)),
                      ],
                    ),
                  );
                }).toList(),
              ),
              const SizedBox(height: 10),
              Text(
                '钻石消费后不再流通：10💎 = ¥1，创作者获得 50%，平台收取 50%。',
                textAlign: TextAlign.center,
                style: TextStyle(
                    fontSize: 10.5, color: AppColors.textFaint, height: 1.5),
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
                  style: TextStyle(color: AppColors.cyan, fontSize: 12),
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
          child: Icon(Icons.flag_outlined,
              size: 14, color: AppColors.textFaint),
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
    final content = AppContentService.instance.content.value;
    if (!content.flag('app.report.enabled')) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('举报入口暂未开放')),
      );
      return;
    }
    final reasons = content.list('app.report.reasons');
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.surface,
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
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: AppColors.text,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
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
                        style: TextStyle(
                            fontSize: 13, color: AppColors.textSub),
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
