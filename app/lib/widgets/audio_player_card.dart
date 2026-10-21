import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/material.dart';
import '../models/elf.dart';
import '../theme.dart';

/// 信息流内的语音帖播放卡片：真实播放远程音频。
class AudioPlayerCard extends StatefulWidget {
  final ElfPost post;

  const AudioPlayerCard({super.key, required this.post});

  @override
  State<AudioPlayerCard> createState() => _AudioPlayerCardState();
}

class _AudioPlayerCardState extends State<AudioPlayerCard> {
  late final AudioPlayer _p;
  Duration _duration = Duration.zero;
  Duration _position = Duration.zero;
  bool _playing = false;
  bool _loading = false;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _p = AudioPlayer()..setReleaseMode(ReleaseMode.stop);
    _p.onDurationChanged.listen((d) {
      if (mounted) setState(() => _duration = d);
    });
    _p.onPositionChanged.listen((d) {
      if (mounted) setState(() => _position = d);
    });
    _p.onPlayerStateChanged.listen((s) {
      if (mounted) setState(() => _playing = s == PlayerState.playing);
    });
    _p.onPlayerComplete.listen((_) {
      if (mounted) setState(() => _position = Duration.zero);
    });
  }

  @override
  void dispose() {
    _p.dispose();
    super.dispose();
  }

  Future<void> _toggle() async {
    final url = widget.post.audioUrl;
    if (url == null || url.isEmpty) return;
    if (_playing) {
      await _p.pause();
      return;
    }
    setState(() {
      _loading = true;
      _failed = false;
    });
    try {
      // 播过且未完成 → 续播；否则从头播。
      if (_position > Duration.zero &&
          _duration > Duration.zero &&
          _position < _duration) {
        await _p.resume();
      } else {
        await _p.play(UrlSource(url));
      }
    } catch (_) {
      if (mounted) setState(() => _failed = true);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _fmt(Duration d) {
    final m = d.inMinutes.remainder(60).toString().padLeft(2, '0');
    final s = d.inSeconds.remainder(60).toString().padLeft(2, '0');
    return '$m:$s';
  }

  @override
  Widget build(BuildContext context) {
    final total = _duration > Duration.zero
        ? _duration
        : Duration(seconds: widget.post.audioDuration ?? 30);
    final ratio = total.inMilliseconds > 0
        ? (_position.inMilliseconds / total.inMilliseconds).clamp(0.0, 1.0)
        : 0.0;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFF151D3D),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: _toggle,
            child: Container(
              width: 32,
              height: 32,
              decoration: BoxDecoration(
                gradient: AppColors.brandGradient,
                shape: BoxShape.circle,
              ),
              alignment: Alignment.center,
              child: _loading
                  ? const SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: AppColors.bgDeep,
                      ),
                    )
                  : Icon(
                      _playing ? Icons.pause : Icons.play_arrow,
                      color: AppColors.bgDeep,
                      size: 16,
                    ),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  height: 3,
                  child: Stack(
                    children: [
                      Container(color: const Color(0xFF2D3A6A)),
                      FractionallySizedBox(
                        widthFactor: ratio,
                        child: Container(color: AppColors.cyan),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  _failed
                      ? '音频加载失败，重试一下'
                      : '${_fmt(_position)} / ${_fmt(total)} · 语音帖',
                  style: const TextStyle(fontSize: 10, color: AppColors.textMuted),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
