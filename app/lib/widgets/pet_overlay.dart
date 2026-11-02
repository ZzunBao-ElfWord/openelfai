import 'dart:async';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../services/platform_api.dart';
import '../theme.dart';

/// 主容器上的全局悬浮桌宠：可拖拽、点击回应、气泡对话。
/// 动画由透明 WebP 提供，位置写入本地缓存，重启后回到上次的位置。
class PetOverlay extends StatefulWidget {
  const PetOverlay({super.key});

  @override
  State<PetOverlay> createState() => _PetOverlayState();
}

class _PetOverlayState extends State<PetOverlay> {
  static const _idle = 'assets/pet/idle.webp';
  static const _drag = 'assets/pet/drag.webp';
  static const _click = 'assets/pet/click.webp';
  static const _sleep = 'assets/pet/sleep.webp';
  static const _posKey = 'pet.overlay.pos';

  // 资源原始尺寸 338×190，按高度等比换算。
  static const double _petHeight = 140;
  static const double _petWidth = _petHeight * 338 / 190;

  final TextEditingController _input = TextEditingController();
  final List<Map<String, String>> _history = [];

  Offset? _pos;
  String _anim = _idle;
  Timer? _animTimer;
  Timer? _bubbleTimer;
  String? _bubble;
  bool _chatOpen = false;
  bool _sending = false;
  bool _assetsReady = false;

  @override
  void initState() {
    super.initState();
    if (_isNight) _anim = _sleep;
    SharedPreferences.getInstance().then((prefs) {
      final raw = prefs.getString(_posKey);
      if (raw == null || !mounted) return;
      final parts = raw.split(',');
      if (parts.length != 2) return;
      final dx = double.tryParse(parts[0]);
      final dy = double.tryParse(parts[1]);
      if (dx == null || dy == null) return;
      setState(() => _pos = Offset(dx, dy));
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_assetsReady) return;
    _assetsReady = true;
    for (final asset in const [_idle, _drag, _click, _sleep]) {
      precacheImage(AssetImage(asset), context);
    }
  }

  @override
  void dispose() {
    _animTimer?.cancel();
    _bubbleTimer?.cancel();
    _input.dispose();
    super.dispose();
  }

  bool get _isNight {
    final hour = DateTime.now().hour;
    return hour >= 23 || hour < 7;
  }

  Offset _defaultPos(Size size) =>
      Offset(14, size.height - _petHeight - 20);

  Offset _clampPos(Offset pos, Size size) {
    final maxX = (size.width - _petWidth - 6).clamp(6.0, double.infinity);
    final maxY = (size.height - _petHeight - 6).clamp(6.0, double.infinity);
    return Offset(pos.dx.clamp(6.0, maxX), pos.dy.clamp(6.0, maxY));
  }

  void _rest() {
    setState(() => _anim = _isNight ? _sleep : _idle);
  }

  void _play(String asset, int holdMs) {
    _animTimer?.cancel();
    setState(() => _anim = asset);
    if (holdMs > 0) {
      _animTimer = Timer(Duration(milliseconds: holdMs), () {
        if (mounted) _rest();
      });
    }
  }

  Future<void> _savePos() async {
    final pos = _pos;
    if (pos == null) return;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_posKey, '${pos.dx},${pos.dy}');
  }

  void _hideBubbleLater() {
    _bubbleTimer?.cancel();
    _bubbleTimer = Timer(const Duration(seconds: 10), () {
      if (mounted) setState(() => _bubble = null);
    });
  }

  void _onTapPet() {
    if (_chatOpen) {
      setState(() => _chatOpen = false);
      return;
    }
    _play(_click, 1600);
    setState(() {
      _chatOpen = true;
      _bubble ??= '想聊点什么？';
    });
    _hideBubbleLater();
  }

  Future<void> _send() async {
    final text = _input.text.trim();
    if (text.isEmpty || _sending) return;
    _input.clear();
    _bubbleTimer?.cancel();
    setState(() {
      _sending = true;
      _bubble = '……';
    });
    try {
      final result = await PlatformApi.instance.chat(
        elfId: '',
        name: '蓝色大肥鱼',
        persona: '你是 OpenElf 桌面上的小精灵「蓝色大肥鱼」，一只蓝色鲸鱼娘。'
            '说话简短亲切，一次最多两句话，不用敬语堆砌。',
        text: text,
        history: List<Map<String, String>>.from(_history),
      );
      final reply = result.reply.trim().isEmpty ? '……' : result.reply.trim();
      _history.add({'role': 'user', 'content': text});
      _history.add({'role': 'assistant', 'content': reply});
      if (_history.length > 10) {
        _history.removeRange(0, _history.length - 10);
      }
      if (!mounted) return;
      setState(() {
        _sending = false;
        _bubble = reply;
      });
      _play(_click, 1200);
      _hideBubbleLater();
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _sending = false;
        _bubble = '网络开小差了，稍后再试试～';
      });
      _hideBubbleLater();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Positioned.fill(
      child: LayoutBuilder(
        builder: (context, constraints) {
          // 用父容器实际尺寸，避免把底部导航栏高度算进可视区。
          final size = constraints.biggest;
          final pos = _clampPos(_pos ?? _defaultPos(size), size);
          const panelWidth = 244.0;
          final left = (pos.dx + _petWidth / 2 - panelWidth / 2)
              .clamp(8.0,
                  (size.width - panelWidth - 8).clamp(8.0, double.infinity));
          final showPanel = _chatOpen || _bubble != null;
          final above = pos.dy > 230;

          return Stack(
            children: [
              if (showPanel)
                Positioned(
                  left: left,
                  width: panelWidth,
                  top: above ? null : pos.dy + _petHeight + 6,
                  bottom: above ? size.height - pos.dy + 6 : null,
                  child: _panel(),
                ),
              Positioned(
                left: pos.dx,
                top: pos.dy,
                width: _petWidth,
                height: _petHeight,
                child: GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: _onTapPet,
                  onPanStart: (_) {
                    _animTimer?.cancel();
                    setState(() {
                      _anim = _drag;
                      _chatOpen = false;
                    });
                  },
                  onPanUpdate: (details) {
                    setState(() {
                      _pos = _clampPos((_pos ?? pos) + details.delta, size);
                    });
                  },
                  onPanEnd: (_) {
                    _savePos();
                    _rest();
                  },
                  child: Image.asset(
                    _anim,
                    width: _petWidth,
                    height: _petHeight,
                    fit: BoxFit.contain,
                    gaplessPlayback: true,
                    filterQuality: FilterQuality.medium,
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _panel() {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppColors.surfaceHigh,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.stroke),
        boxShadow: const [
          BoxShadow(
            color: Color(0x22000000),
            blurRadius: 12,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (_sending)
            Row(
              children: [
                const SizedBox(
                  width: 12,
                  height: 12,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
                const SizedBox(width: 8),
                Text(
                  '让我想想…',
                  style: TextStyle(fontSize: 12, color: AppColors.textSub),
                ),
              ],
            )
          else if (_bubble != null)
            Text(
              _bubble!,
              style: TextStyle(
                fontSize: 12.5,
                height: 1.45,
                color: AppColors.text,
              ),
            ),
          if (_chatOpen) ...[
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _input,
                    textInputAction: TextInputAction.send,
                    onSubmitted: (_) => _send(),
                    style: TextStyle(fontSize: 12.5, color: AppColors.text),
                    decoration: InputDecoration(
                      isDense: true,
                      hintText: '和我说点什么…',
                      hintStyle: TextStyle(
                        fontSize: 12,
                        color: AppColors.textMuted,
                      ),
                      filled: true,
                      fillColor: AppColors.surface,
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 8,
                      ),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(8),
                        borderSide: BorderSide(color: AppColors.strokeSoft),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(8),
                        borderSide: BorderSide(color: AppColors.strokeSoft),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 4),
                IconButton(
                  onPressed: _send,
                  icon: Icon(
                    Icons.send_rounded,
                    size: 18,
                    color: AppColors.cyan,
                  ),
                  visualDensity: VisualDensity.compact,
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(
                    minWidth: 32,
                    minHeight: 32,
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}
