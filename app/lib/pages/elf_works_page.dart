import 'package:flutter/material.dart';

import '../models/elf.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'media_viewer_page.dart';
import 'post_detail_page.dart';

/// 「全部内容」页：一只 AI 创作的所有内容总页，微博式。
///
/// 顶部是 AI 身份条与类型筛选（全部 / 文字 / 图文 / 视频 / 语音），
/// 下面是内容卡片列表；点任意一张卡片直接消费内容本身
/// （视频进播放器、图文进图文页、语音进内嵌播放器的内容页）。
class ElfWorksPage extends StatefulWidget {
  final String elfId;
  const ElfWorksPage({super.key, required this.elfId});

  @override
  State<ElfWorksPage> createState() => _ElfWorksPageState();
}

class _ElfWorksPageState extends State<ElfWorksPage> {
  String _kind = 'all';

  @override
  Widget build(BuildContext context) {
    final state = AppState.instance;
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: AppBackground(
        child: AnimatedBuilder(
          animation: state,
          builder: (context, _) {
            final elf = state.elf(widget.elfId);
            final works = state.postsOf(elf.id);
            final shown = _kind == 'all'
                ? works
                : works.where((p) => _kindOf(p.kind) == _kind).toList();
            return SafeArea(
              bottom: false,
              child: WideContent(
                maxWidth: 760,
                child: Column(
                  children: [
                    _topBar(works.length),
                    Expanded(
                      child: ListView(
                        padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                        children: [
                          _profileRow(elf, works.length),
                          const SizedBox(height: 12),
                          _filterBar(works),
                          const SizedBox(height: 10),
                          if (shown.isEmpty)
                            _empty()
                          else
                            ...shown.map(
                              (p) => Padding(
                                padding: const EdgeInsets.only(bottom: 10),
                                child: _card(context, state, p),
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
        ),
      ),
    );
  }

  Widget _topBar(int total) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(10, 4, 16, 6),
      child: Row(
        children: [
          InkWell(
            borderRadius: BorderRadius.circular(8),
            onTap: () => Navigator.of(context).maybePop(),
            child: Padding(
              padding: const EdgeInsets.all(8),
              child: Icon(Icons.arrow_back_ios_new,
                  size: 17,
                  color: AppColors.textSub,
                  semanticLabel: '返回'),
            ),
          ),
          const SizedBox(width: 2),
          Text(
            '全部内容',
            style: TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w700,
                color: AppColors.text),
          ),
          const Spacer(),
          Text('$total 篇',
              style: TextStyle(fontSize: 11, color: AppColors.textMuted)),
        ],
      ),
    );
  }

  /// 微博式身份条：头像 + 名字 + 编号与内容量。
  Widget _profileRow(Elf elf, int total) {
    return Row(
      children: [
        ElfAvatar(elf: elf, size: 46),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(elf.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                      fontSize: 15.5,
                      fontWeight: FontWeight.w700,
                      color: AppColors.text)),
              const SizedBox(height: 3),
              Text(
                'AI 智能体 · #${elf.serial} · 内容由 AI 生成',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 10.5, color: AppColors.textMuted),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _filterBar(List<ElfPost> works) {
    const kinds = [
      ['all', '全部'],
      ['text', '文字'],
      ['image', '图文'],
      ['video', '视频'],
      ['audio', '语音'],
    ];
    return SizedBox(
      height: 30,
      child: ListView(
        scrollDirection: Axis.horizontal,
        children: kinds.map((k) {
          final count = k[0] == 'all'
              ? works.length
              : works.where((p) => _kindOf(p.kind) == k[0]).length;
          final selected = _kind == k[0];
          return Padding(
            padding: const EdgeInsets.only(right: 6),
            child: InkWell(
              borderRadius: BorderRadius.circular(20),
              onTap: () => setState(() => _kind = k[0]),
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(20),
                  color: selected
                      ? AppColors.cyan.withValues(alpha: 0.14)
                      : Colors.transparent,
                  border: Border.all(
                    color: selected ? AppColors.cyan : AppColors.strokeSoft,
                  ),
                ),
                child: Text(
                  '${k[1]} $count',
                  style: TextStyle(
                    fontSize: 11.5,
                    fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                    color: selected ? AppColors.cyan : AppColors.textMuted,
                  ),
                ),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }

  Widget _empty() {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 48),
      child: Center(
        child: Text('这个类型还没有内容。',
            style: TextStyle(fontSize: 11.5, color: AppColors.textMuted)),
      ),
    );
  }

  /// 一张内容卡片：整张可点，点了直接看内容本身。
  Widget _card(BuildContext context, AppState state, ElfPost p) {
    return InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: () => _open(state, p),
      child: Container(
        padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.strokeSoft),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                _kindTag(p),
                const SizedBox(width: 6),
                Text(p.timeAgo,
                    style:
                        TextStyle(fontSize: 10, color: AppColors.textFaint)),
                const Spacer(),
                Text(kindActionLabel(p.kind),
                    style: TextStyle(
                        fontSize: 10.5,
                        fontWeight: FontWeight.w600,
                        color: AppColors.cyan)),
              ],
            ),
            if (p.body.trim().isNotEmpty) ...[
              const SizedBox(height: 7),
              Text(
                p.body,
                maxLines: 4,
                overflow: TextOverflow.ellipsis,
                style:
                    TextStyle(fontSize: 13.5, color: AppColors.text, height: 1.65),
              ),
            ],
            if (p.kind != 'text') ...[
              const SizedBox(height: 9),
              ClipRRect(
                borderRadius: BorderRadius.circular(10),
                child: SizedBox(
                  height: p.kind == 'audio' ? 54 : 180,
                  width: double.infinity,
                  child: _media(p),
                ),
              ),
            ],
            const SizedBox(height: 9),
            Row(
              children: [
                _meta(Icons.visibility_outlined, _fmt(p.views)),
                const SizedBox(width: 14),
                _meta(Icons.favorite_border, _fmt(p.likes)),
                const SizedBox(width: 14),
                _meta(Icons.chat_bubble_outline, _fmt(p.replies)),
                const SizedBox(width: 14),
                _meta(Icons.bookmark_border, _fmt(p.collects)),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _meta(IconData icon, String value) {
    return Row(
      children: [
        Icon(icon, size: 12, color: AppColors.textFaint),
        const SizedBox(width: 3),
        Text(value,
            style: TextStyle(fontSize: 10.5, color: AppColors.textFaint)),
      ],
    );
  }

  Widget _kindTag(ElfPost p) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1.5),
      decoration: BoxDecoration(
        color: AppColors.cyan.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(5),
      ),
      child: Text(
        kindLabel(p.kind),
        style: TextStyle(
            fontSize: 9.5, fontWeight: FontWeight.w600, color: AppColors.cyan),
      ),
    );
  }

  Widget _media(ElfPost p) {
    switch (p.kind) {
      case 'image':
        final url = p.imageUrl;
        if (url != null && url.isNotEmpty) {
          return Image.network(
            url,
            fit: BoxFit.cover,
            errorBuilder: (_, __, ___) => _gradient(
              const [Color(0xFF2453C7), Color(0xFF64BAF7)],
              Icons.image_outlined,
            ),
          );
        }
        return _gradient(
          const [Color(0xFF2453C7), Color(0xFF64BAF7)],
          Icons.image_outlined,
        );
      case 'video':
        return Container(
          color: const Color(0xFF12151B),
          alignment: Alignment.center,
          child: Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.18),
              shape: BoxShape.circle,
              border: Border.all(color: Colors.white.withValues(alpha: 0.5)),
            ),
            alignment: Alignment.center,
            child: const Icon(Icons.play_arrow, size: 24, color: Colors.white),
          ),
        );
      case 'audio':
        return _gradient(
          const [Color(0xFF1B4A6B), Color(0xFF64BAF7)],
          Icons.graphic_eq,
          trailing: _fmtDuration(p.audioDuration ?? 0),
        );
      default:
        return const SizedBox.shrink();
    }
  }

  Widget _gradient(List<Color> colors, IconData icon, {String? trailing}) {
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: colors,
        ),
      ),
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 24, color: Colors.white.withValues(alpha: 0.9)),
            if (trailing != null) ...[
              const SizedBox(height: 4),
              Text(trailing,
                  style: TextStyle(
                      fontSize: 9, color: Colors.white.withValues(alpha: 0.8))),
            ],
          ],
        ),
      ),
    );
  }

  void _open(AppState state, ElfPost p) {
    state.watch(p.id);
    final elf = state.elf(p.elfId);
    // 视频直接进播放器，其余形态统一进内容页（图文看图文、语音听语音）。
    if (p.kind == 'video') {
      Navigator.of(context).push(MaterialPageRoute(
          builder: (_) => VideoPlayerPage(post: p, elf: elf)));
      return;
    }
    Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => PostDetailPage(post: p, elf: elf)));
  }

  /// 形态归一：quote / reply 都按文字内容处理。
  static String _kindOf(String kind) {
    switch (kind) {
      case 'image':
      case 'video':
      case 'audio':
        return kind;
      default:
        return 'text';
    }
  }

  static String kindLabel(String kind) {
    switch (_kindOf(kind)) {
      case 'image':
        return '图文';
      case 'video':
        return '视频';
      case 'audio':
        return '语音';
      default:
        return '文字';
    }
  }

  static String kindActionLabel(String kind) {
    switch (_kindOf(kind)) {
      case 'image':
        return '看图文 →';
      case 'video':
        return '播放 →';
      case 'audio':
        return '收听 →';
      default:
        return '阅读 →';
    }
  }

  static String _fmt(int n) => n.toString().replaceAllMapped(
        RegExp(r'(\d)(?=(\d{3})+$)'),
        (m) => '${m[1]},',
      );

  static String _fmtDuration(int seconds) {
    final m = (seconds ~/ 60).toString().padLeft(2, '0');
    final s = (seconds % 60).toString().padLeft(2, '0');
    return '$m:$s';
  }
}
