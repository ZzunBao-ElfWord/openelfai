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
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    _init();
  }

  void _init() {
    final url = widget.post.videoUrl;
    if (url == null || url.isEmpty) {
      setState(() => _failed = true);
      return;
    }
    _c?.removeListener(_tick);
    _c?.dispose();
    final c = VideoPlayerController.networkUrl(Uri.parse(url));
    _c = c;
    setState(() {
      _failed = false;
      _loading = true;
    });
    c.initialize().then((_) {
      if (!mounted) return;
      setState(() => _loading = false);
      c.play();
      c.addListener(_tick);
    }).catchError((_) {
      if (mounted) setState(() {
        _failed = true;
        _loading = false;
      });
    });
  }

  void _retry() => _init();

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
                          style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600),
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
            Expanded(
              child: Center(
                child: _failed
                    ? _failedView(reason: '视频加载失败，检查一下网络', onRetry: _retry)
                    : _loading
                        ? const CircularProgressIndicator(color: AppColors.cyan)
                        : _player(),
              ),
            ),
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
                        Text(_fmt(c.value.position), style: const TextStyle(color: Colors.white70, fontSize: 11)),
                        const Spacer(),
                        Text(_fmt(c.value.duration), style: const TextStyle(color: Colors.white38, fontSize: 11)),
                      ],
                    ),
                  ],
                ),
              ),
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

  Widget _player() {
    final c = _c!;
    return GestureDetector(
      onTap: () => c.value.isPlaying ? c.pause() : c.play(),
      child: Stack(
        alignment: Alignment.center,
        children: [
          AspectRatio(aspectRatio: c.value.aspectRatio, child: VideoPlayer(c)),
          if (!c.value.isPlaying)
            Container(
              width: 64,
              height: 64,
              decoration: BoxDecoration(
                color: Colors.black.withOpacity(0.5),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.play_arrow, color: Colors.white, size: 36),
            ),
        ],
      ),
    );
  }

  Widget _failedView({required String reason, required VoidCallback onRetry}) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(Icons.cloud_off, color: Colors.white38, size: 40),
        const SizedBox(height: 10),
        Text(reason, style: const TextStyle(color: Colors.white54, fontSize: 12)),
        const SizedBox(height: 12),
        TextButton.icon(
          onPressed: onRetry,
          icon: const Icon(Icons.refresh, color: AppColors.cyan, size: 16),
          label: const Text('重试', style: TextStyle(color: AppColors.cyan)),
        ),
      ],
    );
  }
}

/// 图片查看页：点开 image 帖进入，双指缩放，可重试加载。
class ImageViewerPage extends StatefulWidget {
  final ElfPost post;
  final Elf elf;
  const ImageViewerPage({super.key, required this.post, required this.elf});

  @override
  State<ImageViewerPage> createState() => _ImageViewerPageState();
}

class _ImageViewerPageState extends State<ImageViewerPage> {
  late int _reloadKey = 0;

  @override
  Widget build(BuildContext context) {
    final url = '${widget.post.imageUrl ?? ''}?reload=$_reloadKey';
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
                  key: ValueKey('img_$_reloadKey'),
                  fit: BoxFit.contain,
                  loadingBuilder: (_, child, progress) {
                    if (progress == null) return child;
                    return const CircularProgressIndicator(color: AppColors.cyan);
                  },
                  errorBuilder: (_, __, ___) => Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.broken_image_outlined, color: Colors.white38, size: 40),
                      const SizedBox(height: 10),
                      const Text('图片加载失败', style: TextStyle(color: Colors.white54, fontSize: 12)),
                      const SizedBox(height: 12),
                      TextButton.icon(
                        onPressed: () => setState(() => _reloadKey++),
                        icon: const Icon(Icons.refresh, color: AppColors.cyan, size: 16),
                        label: const Text('重试', style: TextStyle(color: AppColors.cyan)),
                      ),
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
