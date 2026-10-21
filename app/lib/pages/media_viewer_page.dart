import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';
import '../models/elf.dart';
import '../theme.dart';
import '../widgets/common.dart';

/// 视频播放页：点开 video 帖进入，真实流媒体播放。
class VideoPlayerPage extends StatefulWidget {
  final ElfPost post;
  final Elf elf;

  const VideoPlayerPage({super.key, required this.post, required this.elf});

  @override
  State<VideoPlayerPage> createState() => _VideoPlayerPageState();
}

class _VideoPlayerPageState extends State<VideoPlayerPage> {
  VideoPlayerController? _c;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    final url = widget.post.videoUrl;
    if (url == null || url.isEmpty) {
      _failed = true;
      return;
    }
    final c = VideoPlayerController.networkUrl(Uri.parse(url));
    _c = c;
    c.initialize().then((_) {
      if (!mounted) return;
      setState(() {});
      c.play();
      c.addListener(_tick);
    }).catchError((_) {
      if (mounted) setState(() => _failed = true);
    });
  }

  void _tick() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _c?.removeListener(_tick);
    _c?.dispose();
    super.dispose();
  }

  String _fmt(Duration d) {
    final m = d.inMinutes.remainder(60).toString().padLeft(2, '0');
    final s = d.inSeconds.remainder(60).toString().padLeft(2, '0');
    return '$m:$s';
  }

  @override
  Widget build(BuildContext context) {
    final c = _c;
    final ready = c != null && c.value.isInitialized;
    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Column(
          children: [
            // 顶栏
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 8, 16, 8),
              child: Row(
                children: [
                  IconButton(
                    icon: const Icon(Icons.arrow_back, color: Colors.white),
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                  ElfAvatar(elf: widget.elf, size: 30),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          widget.elf.name,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        Text(
                          widget.post.context ?? '视频内容',
                          style: const TextStyle(color: Colors.white54, fontSize: 10),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            // 播放区
            Expanded(
              child: Center(
                child: _failed
                    ? const Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.cloud_off, color: Colors.white38, size: 40),
                          SizedBox(height: 10),
                          Text('视频加载失败，检查一下网络',
                              style: TextStyle(color: Colors.white54, fontSize: 12)),
                        ],
                      )
                    : !ready
                        ? const CircularProgressIndicator(color: AppColors.cyan)
                        : GestureDetector(
                            onTap: () {
                              c.value.isPlaying ? c.pause() : c.play();
                            },
                            child: Stack(
                              alignment: Alignment.center,
                              children: [
                                AspectRatio(
                                  aspectRatio: c.value.aspectRatio,
                                  child: VideoPlayer(c),
                                ),
                                if (!c.value.isPlaying)
                                  Container(
                                    width: 64,
                                    height: 64,
                                    decoration: BoxDecoration(
                                      color: Colors.black.withOpacity(0.5),
                                      shape: BoxShape.circle,
                                    ),
                                    child: const Icon(Icons.play_arrow,
                                        color: Colors.white, size: 36),
                                  ),
                              ],
                            ),
                          ),
              ),
            ),
            // 进度条 + 时间
            if (ready)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: Column(
                  children: [
                    VideoProgressIndicator(
                      c,
                      allowScrubbing: true,
                      colors: const VideoProgressColors(
                        playedColor: AppColors.cyan,
                        bufferedColor: Colors.white24,
                        backgroundColor: Colors.white10,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        Text(
                          _fmt(c.value.position),
                          style: const TextStyle(color: Colors.white70, fontSize: 11),
                        ),
                        const Spacer(),
                        Text(
                          _fmt(c.value.duration),
                          style: const TextStyle(color: Colors.white38, fontSize: 11),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            // 文案
            Container(
              width: double.infinity,
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 20),
              child: Text(
                widget.post.body,
                style: const TextStyle(color: Colors.white70, fontSize: 13, height: 1.6),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// 图片查看页：点开 image 帖进入，双指缩放。
class ImageViewerPage extends StatelessWidget {
  final ElfPost post;
  final Elf elf;

  const ImageViewerPage({super.key, required this.post, required this.elf});

  @override
  Widget build(BuildContext context) {
    final url = post.imageUrl ?? '';
    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Stack(
          children: [
            Center(
              child: InteractiveViewer(
                maxScale: 5,
                child: Image.network(
                  url,
                  fit: BoxFit.contain,
                  loadingBuilder: (_, child, progress) {
                    if (progress == null) return child;
                    return const CircularProgressIndicator(color: AppColors.cyan);
                  },
                  errorBuilder: (_, __, ___) => const Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.broken_image_outlined, color: Colors.white38, size: 40),
                      SizedBox(height: 10),
                      Text('图片加载失败', style: TextStyle(color: Colors.white54, fontSize: 12)),
                    ],
                  ),
                ),
              ),
            ),
            Positioned(
              top: 8,
              left: 8,
              child: IconButton(
                icon: const Icon(Icons.close, color: Colors.white),
                onPressed: () => Navigator.of(context).pop(),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
