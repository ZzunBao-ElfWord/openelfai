import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

import '../models/elf.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';
import '../widgets/share_card.dart';
import 'elf_chat_page.dart';

/// 视频 tab：站内第二个曝光渠道。
/// 参考抖音首页的竖屏单列视频流 —— 上下滑动切视频，当前条自动播放，
/// 右侧是点赞/评论/收藏/分享/打赏，左下是 AI 与内容信息。
class VideoFeedPage extends StatefulWidget {
  /// 是否处于前台 tab：切走时暂停播放，避免在其它 tab 后台出声。
  final bool active;

  const VideoFeedPage({super.key, this.active = true});

  @override
  State<VideoFeedPage> createState() => _VideoFeedPageState();
}

class _VideoFeedPageState extends State<VideoFeedPage> {
  final PageController _pc = PageController();

  List<ElfPost> _posts = [];
  int _index = 0;
  VideoPlayerController? _vc;
  String? _activeId;
  bool _loading = false;
  bool _failed = false;
  bool _muted = false;

  AppState get _state => AppState.instance;

  @override
  void initState() {
    super.initState();
    // 互动计数变化时只刷新 UI，不重排当前列表（避免播放中被换走）
    _state.addListener(_onStateChanged);
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadFeed());
  }

  @override
  void didUpdateWidget(covariant VideoFeedPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.active == widget.active) return;
    if (widget.active) {
      if (_posts.isEmpty) return;
      _watchCurrent();
      final c = _vc;
      if (c != null && c.value.isInitialized) {
        c.play();
      } else {
        _playCurrent();
      }
    } else {
      _vc?.pause();
    }
  }

  @override
  void dispose() {
    _state.removeListener(_onStateChanged);
    _vc?.removeListener(_tick);
    _vc?.dispose();
    _pc.dispose();
    super.dispose();
  }

  void _onStateChanged() {
    if (mounted) setState(() {});
  }

  void _loadFeed({bool keepIndex = false}) {
    final list = _state.feedVideo();
    if (!mounted) return;
    final prevId = (_posts.isEmpty || _index >= _posts.length) ? null : _posts[_index].id;
    setState(() {
      _posts = list;
      if (!keepIndex || prevId == null) {
        _index = 0;
      } else {
        final found = list.indexWhere((p) => p.id == prevId);
        _index = found >= 0 ? found : 0;
      }
    });
    if (_pc.hasClients && _index != (_pc.page ?? 0).round()) {
      _pc.jumpToPage(_index);
    }
    if (_posts.isEmpty) {
      _stop();
      return;
    }
    // 不在前台 tab 时不播放、也不计入注视。
    if (!widget.active) return;
    _watchCurrent();
    _playCurrent();
  }

  void _watchCurrent() {
    final p = _posts[_index];
    if (!_state.watchedPosts.contains(p.id)) _state.watch(p.id);
  }

  void _stop() {
    _vc?.removeListener(_tick);
    _vc?.dispose();
    _vc = null;
    _activeId = null;
    if (mounted) setState(() {});
  }

  void _playCurrent() {
    if (_posts.isEmpty) return;
    _play(_posts[_index]);
  }

  void _play(ElfPost post) {
    final url = post.videoUrl;
    if (url == null || url.isEmpty) {
      setState(() {
        _activeId = post.id;
        _failed = true;
        _loading = false;
      });
      return;
    }
    _vc?.removeListener(_tick);
    _vc?.dispose();
    _vc = null;
    final c = VideoPlayerController.networkUrl(Uri.parse(url));
    _vc = c;
    setState(() {
      _activeId = post.id;
      _loading = true;
      _failed = false;
    });
    c.setVolume(_muted ? 0 : 1);
    c.setLooping(true);
    c.initialize().then((_) {
      if (!mounted || _activeId != post.id) {
        c.dispose();
        return;
      }
      c.play();
      c.addListener(_tick);
      setState(() => _loading = false);
    }).catchError((_) {
      if (!mounted) return;
      setState(() {
        _failed = true;
        _loading = false;
      });
    });
  }

  void _tick() {
    if (mounted) setState(() {});
  }

  void _retry() {
    _activeId = null;
    _vc?.dispose();
    _vc = null;
    _playCurrent();
  }

  void _togglePlay() {
    final c = _vc;
    if (c == null || !c.value.isInitialized) return;
    c.value.isPlaying ? c.pause() : c.play();
    setState(() {});
  }

  void _toggleMute() {
    _muted = !_muted;
    _vc?.setVolume(_muted ? 0 : 1);
    setState(() {});
  }

  void _onPageChanged(int i) {
    setState(() => _index = i);
    _watchCurrent();
    _playCurrent();
  }

  @override
  Widget build(BuildContext context) {
    if (_posts.isEmpty) return _empty();
    return PageView.builder(
      controller: _pc,
      scrollDirection: Axis.vertical,
      itemCount: _posts.length,
      onPageChanged: _onPageChanged,
      itemBuilder: (context, i) => _item(_posts[i], i),
    );
  }

  // —— 单条视频 ——

  Widget _item(ElfPost p, int i) {
    final elf = _state.elf(p.elfId);
    final isActive = i == _index;
    return Center(
      child: Stack(
        fit: StackFit.expand,
        children: [
          Container(color: Colors.black),
          // 画面
          GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: isActive ? _togglePlay : null,
            child: isActive ? _videoLayer() : Container(),
          ),
          // 底部渐隐，保证文字可读
          IgnorePointer(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.center,
                  end: Alignment.bottomCenter,
                  colors: [Colors.transparent, Colors.black.withOpacity(0.75)],
                ),
              ),
            ),
          ),
          // 顶部：渠道标签 + 静音
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            child: SafeArea(
              bottom: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 10, 12, 0),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                      decoration: BoxDecoration(
                        color: Colors.black.withOpacity(0.35),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.play_circle_fill, size: 13, color: Colors.white),
                          SizedBox(width: 4),
                          Text('AI 视频', style: TextStyle(fontSize: 10.5, color: Colors.white)),
                        ],
                      ),
                    ),
                    const Spacer(),
                    GestureDetector(
                      onTap: _toggleMute,
                      child: Container(
                        padding: const EdgeInsets.all(6),
                        decoration: BoxDecoration(
                          color: Colors.black.withOpacity(0.35),
                          shape: BoxShape.circle,
                        ),
                        child: Icon(
                          _muted ? Icons.volume_off : Icons.volume_up,
                          size: 16,
                          color: Colors.white,
                          semanticLabel: _muted ? '取消静音' : '静音',
                        ),
                      ),
                    ),
                    const SizedBox(width: 4),
                    GestureDetector(
                      onTap: () => _loadFeed(keepIndex: true),
                      child: Container(
                        padding: const EdgeInsets.all(6),
                        decoration: BoxDecoration(
                          color: Colors.black.withOpacity(0.35),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(Icons.refresh, size: 16, color: Colors.white, semanticLabel: '刷新视频流'),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          // 右侧操作列
          Positioned(
            right: 10,
            bottom: 92,
            child: SafeArea(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  GestureDetector(
                    onTap: () async {
                      // 进对话页时先暂停，回来再继续播。
                      _vc?.pause();
                      await Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => ElfChatPage(elfId: elf.id)),
                      );
                      if (mounted && widget.active) _vc?.play();
                    },
                    child: Container(
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        border: Border.all(color: Colors.white70, width: 1.5),
                      ),
                      child: ElfAvatar(elf: elf, size: 40),
                    ),
                  ),
                  const SizedBox(height: 18),
                  _railButton(
                    icon: _state.isLiked(p.id) ? Icons.favorite : Icons.favorite_border,
                    color: _state.isLiked(p.id) ? AppColors.danger : Colors.white,
                    label: _fmt(p.likes),
                    semantic: '点赞',
                    onTap: () => _state.toggleLike(p.id),
                  ),
                  const SizedBox(height: 16),
                  _railButton(
                    icon: Icons.mode_comment_outlined,
                    label: _fmt(p.replies),
                    semantic: '评论',
                    onTap: () => _commentsSheet(p, elf),
                  ),
                  const SizedBox(height: 16),
                  _railButton(
                    icon: _state.isCollected(p.id) ? Icons.star : Icons.star_border,
                    color: _state.isCollected(p.id) ? AppColors.warn : Colors.white,
                    label: _fmt(p.collects),
                    semantic: '收藏',
                    onTap: () => _state.toggleCollect(p.id),
                  ),
                  const SizedBox(height: 16),
                  _railButton(
                    icon: Icons.ios_share,
                    label: '分享',
                    semantic: '分享',
                    onTap: () => ShareHelper.shareElf(
                      context,
                      elf,
                      excerpt: p.body.length > 40 ? '${p.body.substring(0, 40)}…' : p.body,
                    ),
                  ),
                  const SizedBox(height: 16),
                  _railButton(
                    icon: Icons.auto_awesome,
                    label: '打赏',
                    semantic: '打赏',
                    color: elf.isMine ? Colors.white38 : AppColors.cyan,
                    onTap: elf.isMine ? null : () => _tipSheet(p, elf),
                  ),
                ],
              ),
            ),
          ),
          // 左下信息
          Positioned(
            left: 16,
            right: 84,
            bottom: 26,
            child: SafeArea(
              top: false,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Flexible(
                        child: Text(
                          '@${elf.name}',
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                            color: Colors.white,
                          ),
                        ),
                      ),
                      const SizedBox(width: 6),
                      Text(
                        elf.serial,
                        style: const TextStyle(fontSize: 10.5, color: Colors.white54),
                      ),
                    ],
                  ),
                  const SizedBox(height: 5),
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: Colors.white.withOpacity(0.16),
                          borderRadius: BorderRadius.circular(5),
                        ),
                        child: Text(
                          'Lv${elf.level} · ${elf.levelName}',
                          style: const TextStyle(fontSize: 9.5, color: Colors.white70),
                        ),
                      ),
                      const SizedBox(width: 6),
                      Text(
                        '${p.views} 次注视 · 均停 ${p.dwell}s',
                        style: const TextStyle(fontSize: 9.5, color: Colors.white54),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    p.body,
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 12.5, color: Colors.white, height: 1.55),
                  ),
                  if (p.context != null) ...[
                    const SizedBox(height: 5),
                    Text(
                      p.context!,
                      style: const TextStyle(fontSize: 9.5, color: Colors.white38),
                    ),
                  ],
                ],
              ),
            ),
          ),
          // 播放进度（贴底）
          if (isActive && _vc != null && _vc!.value.isInitialized)
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: VideoProgressIndicator(
                _vc!,
                allowScrubbing: true,
                padding: EdgeInsets.zero,
                colors: const VideoProgressColors(
                  playedColor: Colors.white,
                  bufferedColor: Colors.white24,
                  backgroundColor: Colors.white10,
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _videoLayer() {
    if (_failed) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.videocam_off_outlined, size: 34, color: Colors.white38),
            const SizedBox(height: 10),
            const Text('视频加载失败', style: TextStyle(fontSize: 12, color: Colors.white54)),
            const SizedBox(height: 12),
            GestureDetector(
              onTap: _retry,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                decoration: BoxDecoration(
                  color: Colors.white.withOpacity(0.14),
                  borderRadius: BorderRadius.circular(18),
                ),
                child: const Text('重试', style: TextStyle(fontSize: 12, color: Colors.white)),
              ),
            ),
          ],
        ),
      );
    }
    if (_loading || _vc == null || !_vc!.value.isInitialized) {
      return const Center(child: CircularProgressIndicator(color: AppColors.cyan));
    }
    final c = _vc!;
    return Stack(
      fit: StackFit.expand,
      children: [
        FittedBox(
          fit: BoxFit.cover,
          child: SizedBox(
            width: c.value.size.width,
            height: c.value.size.height,
            child: VideoPlayer(c),
          ),
        ),
        if (!c.value.isPlaying)
          Center(
            child: Container(
              width: 62,
              height: 62,
              decoration: BoxDecoration(
                color: Colors.black.withOpacity(0.45),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.play_arrow, color: Colors.white, size: 34),
            ),
          ),
      ],
    );
  }

  Widget _railButton({
    required IconData icon,
    required String label,
    required String semantic,
    required VoidCallback? onTap,
    Color color = Colors.white,
  }) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Column(
        children: [
          Icon(icon, size: 27, color: color, semanticLabel: semantic),
          const SizedBox(height: 4),
          Text(label, style: const TextStyle(fontSize: 10, color: Colors.white70)),
        ],
      ),
    );
  }

  // —— 空态 ——

  Widget _empty() {
    final mine = _state.myElf;
    return Container(
      color: AppColors.bg,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.play_circle_outline, size: 58, color: AppColors.textMuted),
              const SizedBox(height: 14),
              const Text(
                '视频流还是空的。',
                style: TextStyle(fontSize: 14, color: AppColors.textSub),
              ),
              const SizedBox(height: 6),
              Text(
                mine == null
                    ? '先去市场买一只 AI，再给它装上「视频生成」。'
                    : '给它装上「视频生成」，然后在「我的 AI」里让它创作，视频会出现在这里。',
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 11.5, color: AppColors.textMuted, height: 1.7),
              ),
              const SizedBox(height: 16),
              GhostButton(
                label: '刷新视频流',
                icon: Icons.refresh,
                onTap: () => _loadFeed(),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // —— 评论弹层 ——

  void _commentsSheet(ElfPost p, Elf elf) {
    final input = TextEditingController();
    void send() {
      final err = _state.addComment(p.id, input.text);
      if (err != null) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err)));
        return;
      }
      input.clear();
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
          animation: _state,
          builder: (ctx, _) {
            final list = _state.commentsOf(p.id);
            return Padding(
              padding: EdgeInsets.only(bottom: MediaQuery.of(ctx).viewInsets.bottom),
              child: SizedBox(
                height: MediaQuery.of(ctx).size.height * 0.6,
                child: Column(
                  children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 14, 8, 6),
                      child: Row(
                        children: [
                          Text(
                            '评论 · ${p.replies}',
                            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.text),
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
                                                style: const TextStyle(fontSize: 10, color: AppColors.textFaint),
                                              ),
                                            ],
                                          ),
                                          const SizedBox(height: 3),
                                          Text(
                                            c.text,
                                            style: const TextStyle(fontSize: 13, color: AppColors.text, height: 1.5),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ],
                                );
                              },
                            ),
                    ),
                    const Divider(height: 1, color: AppColors.strokeSoft),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(12, 8, 12, 10),
                      child: Row(
                        children: [
                          Expanded(
                            child: TextField(
                              controller: input,
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

  // —— 打赏弹层 ——

  void _tipSheet(ElfPost p, Elf elf) {
    const tiers = [10, 50, 100];
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.bgDeep,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) {
        return AnimatedBuilder(
          animation: _state,
          builder: (ctx, _) {
            return Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '打赏 ${elf.name}',
                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: AppColors.text),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '创作者拿 50% 收益。你有 💎${_state.wallet.diamonds}',
                    style: const TextStyle(fontSize: 11, color: AppColors.textMuted),
                  ),
                  const SizedBox(height: 14),
                  Row(
                    children: tiers.map((t) {
                      return Expanded(
                        child: Padding(
                          padding: EdgeInsets.only(right: t == tiers.last ? 0 : 8),
                          child: GhostButton(
                            label: '💎 $t',
                            onTap: () async {
                              final err = await _state.tip(elfId: elf.id, postId: p.id, amount: t);
                              if (!mounted || !ctx.mounted) return;
                              if (err != null) {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  SnackBar(content: Text(err)),
                                );
                              } else {
                                Navigator.of(ctx).pop();
                                ScaffoldMessenger.of(context).showSnackBar(
                                  SnackBar(
                                    content: Text('已打赏 💎$t 给 ${elf.name}'),
                                    backgroundColor: AppColors.violet,
                                  ),
                                );
                              }
                            },
                          ),
                        ),
                      );
                    }).toList(),
                  ),
                ],
              ),
            );
          },
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
