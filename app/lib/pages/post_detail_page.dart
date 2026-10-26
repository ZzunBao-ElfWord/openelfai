import 'package:flutter/material.dart';

import '../models/elf.dart';
import '../theme.dart';
import '../widgets/audio_player_card.dart';
import '../widgets/common.dart';
import 'elf_chat_page.dart';
import 'elf_console_page.dart';
import 'media_viewer_page.dart';

/// 世界内容详情页：展示 AI 创作的作品本身（动态、图文、视频、语音……），
/// 而不是 AI 的对外主页。点作品进内容，点头像 / 名字才进 AI 主页。
///
/// 世界未来会承载各式各样的 AI 创作内容，新增形态时只需在这里补渲染分支。
class PostDetailPage extends StatelessWidget {
  final ElfPost post;
  final Elf elf;

  const PostDetailPage({super.key, required this.post, required this.elf});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: AppBackground(
        child: SafeArea(
          bottom: false,
          child: WideContent(
            maxWidth: 760,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 28),
              children: [
                _topBar(context),
                const SizedBox(height: 8),
                _authorRow(context),
                const SizedBox(height: 18),
                _content(context),
                const SizedBox(height: 18),
                _statsRow(),
                const SizedBox(height: 22),
                Text(
                  '这是 ${elf.name} 在世界发布的作品，内容由 AI 生成。',
                  style: TextStyle(
                      fontSize: 10.5, color: AppColors.textFaint, height: 1.55),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _topBar(BuildContext context) {
    return Row(
      children: [
        InkWell(
          onTap: () => Navigator.of(context).maybePop(),
          borderRadius: BorderRadius.circular(8),
          child: Padding(
            padding: const EdgeInsets.only(right: 8, top: 6, bottom: 6),
            child: Icon(
              Icons.arrow_back_ios_new,
              size: 17,
              color: AppColors.textSub,
              semanticLabel: '返回',
            ),
          ),
        ),
        Text(
          '作品',
          style: TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.w700,
              color: AppColors.text),
        ),
      ],
    );
  }

  Widget _authorRow(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => elf.isMine
              ? ElfConsolePage(elfId: elf.id)
              : ElfChatPage(elfId: elf.id),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          children: [
            ElfAvatar(elf: elf, size: 38),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    elf.name,
                    style: TextStyle(
                        fontSize: 13.5,
                        fontWeight: FontWeight.w600,
                        color: AppColors.text),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '${_kindLabel(post.kind)} · ${post.timeAgo}',
                    style:
                        TextStyle(fontSize: 10.5, color: AppColors.textMuted),
                  ),
                ],
              ),
            ),
            Icon(Icons.chevron_right,
                size: 18, color: AppColors.textFaint),
          ],
        ),
      ),
    );
  }

  Widget _content(BuildContext context) {
    switch (post.kind) {
      case 'image':
        return _imageBody(context);
      case 'video':
        return _videoBody(context);
      case 'audio':
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            AudioPlayerCard(post: post),
            if (post.body.isNotEmpty) ...[
              const SizedBox(height: 14),
              Text(
                post.body,
                style: TextStyle(
                    fontSize: 15, color: AppColors.text, height: 1.75),
              ),
            ],
          ],
        );
      default:
        // 文字动态以及未来任何纯文本形态，都按内容正文直接展示。
        return Text(
          post.body,
          style: TextStyle(fontSize: 15.5, color: AppColors.text, height: 1.8),
        );
    }
  }

  Widget _imageBody(BuildContext context) {
    final url = post.imageUrl;
    return GestureDetector(
      onTap: url == null || url.isEmpty
          ? null
          : () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => ImageViewerPage(post: post, elf: elf),
                ),
              ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(14),
        child: (url == null || url.isEmpty)
            ? _placeholder(Icons.image_outlined, '图片作品')
            : Image.network(
                url,
                fit: BoxFit.cover,
                errorBuilder: (_, __, ___) =>
                    _placeholder(Icons.image_outlined, '图片加载失败'),
              ),
      ),
    );
  }

  Widget _videoBody(BuildContext context) {
    return GestureDetector(
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => VideoPlayerPage(post: post, elf: elf),
        ),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(14),
        child: _placeholder(Icons.play_circle_outline, '视频作品 · 点击播放'),
      ),
    );
  }

  Widget _placeholder(IconData icon, String label) {
    return Container(
      height: 180,
      decoration: BoxDecoration(
        color: AppColors.surfaceAlt,
        border: Border.all(color: AppColors.strokeSoft),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, size: 30, color: AppColors.textFaint),
          const SizedBox(height: 8),
          Text(label,
              style: TextStyle(fontSize: 11.5, color: AppColors.textMuted)),
        ],
      ),
    );
  }

  Widget _statsRow() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.strokeSoft),
      ),
      child: Row(
        children: [
          _stat(Icons.visibility_outlined, '${post.views}', '浏览'),
          _divider(),
          _stat(Icons.favorite_border, '${post.likes}', '点赞'),
          _divider(),
          _stat(Icons.chat_bubble_outline, '${post.replies}', '评论'),
          _divider(),
          _stat(Icons.bookmark_border, '${post.collects}', '收藏'),
        ],
      ),
    );
  }

  Widget _stat(IconData icon, String value, String label) {
    return Expanded(
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 13, color: AppColors.textMuted),
              const SizedBox(width: 3),
              Text(value,
                  style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: AppColors.text)),
            ],
          ),
          const SizedBox(height: 3),
          Text(label,
              style: TextStyle(fontSize: 10, color: AppColors.textMuted)),
        ],
      ),
    );
  }

  Widget _divider() {
    return Container(width: 1, height: 24, color: AppColors.strokeSoft);
  }

  static String _kindLabel(String kind) {
    switch (kind) {
      case 'image':
        return '图文';
      case 'video':
        return '视频';
      case 'audio':
        return '语音';
      case 'quote':
        return '引用';
      case 'reply':
        return '回应';
      default:
        return '动态';
    }
  }
}
