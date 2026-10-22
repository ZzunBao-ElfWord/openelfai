import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../models/elf.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/share_card.dart';
import 'elf_detail_page.dart';

/// 沉浸式对话页：全屏氛围背景 + 居中对白 + 悬浮输入条。
/// 视觉参考猫箱式对话：没有气泡列表的边框感，AI 的话直接浮在画面下方。
class ElfChatPage extends StatefulWidget {
  final String elfId;
  const ElfChatPage({super.key, required this.elfId});

  @override
  State<ElfChatPage> createState() => _ElfChatPageState();
}

class _ElfChatPageState extends State<ElfChatPage> {
  final TextEditingController _input = TextEditingController();
  final ScrollController _scroll = ScrollController();

  AppState get _state => AppState.instance;
  bool _autoscroll = true;

  @override
  void initState() {
    super.initState();
    _state.addListener(_onStateChanged);
    _input.addListener(_onInputChanged);
  }

  @override
  void dispose() {
    _state.removeListener(_onStateChanged);
    _input.removeListener(_onInputChanged);
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _onInputChanged() {
    if (mounted) setState(() {});
  }

  void _onStateChanged() {
    if (!mounted) return;
    setState(() {});
    if (_autoscroll) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _jumpToLatest());
    }
  }

  void _jumpToLatest() {
    if (!_scroll.hasClients) return;
    _scroll.animateTo(
      _scroll.position.minScrollExtent,
      duration: const Duration(milliseconds: 240),
      curve: Curves.easeOut,
    );
  }

  void _send() {
    final text = _input.text.trim();
    if (text.isEmpty) return;
    _autoscroll = true;
    _state.sendChat(widget.elfId, text);
    _input.clear();
    WidgetsBinding.instance.addPostFrameCallback((_) => _jumpToLatest());
  }

  void _toast(String text) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(text), duration: const Duration(seconds: 2)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final elf = _state.elf(widget.elfId);
    final msgs = _state.chatOf(widget.elfId);
    final sleeping = elf.liveStatus == ElfStatus.sleeping;
    return Scaffold(
      backgroundColor: const Color(0xFF05070F),
      resizeToAvoidBottomInset: true,
      body: Stack(
        fit: StackFit.expand,
        children: [
          const RepaintBoundary(child: CustomPaint(painter: _NightRoomPainter())),
          // 上下压暗，保证文字可读
          IgnorePointer(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Colors.black.withOpacity(0.35),
                    Colors.transparent,
                    Colors.black.withOpacity(0.20),
                    Colors.black.withOpacity(0.82),
                  ],
                  stops: const [0, 0.28, 0.62, 1],
                ),
              ),
            ),
          ),
          // 左侧竖排水印
          Positioned(
            left: 9,
            top: 132,
            child: IgnorePointer(
              child: RotatedBox(
                quarterTurns: 3,
                child: Text(
                  '由 AI 生成',
                  style: TextStyle(
                    fontSize: 9,
                    letterSpacing: 5,
                    color: Colors.white.withOpacity(0.32),
                  ),
                ),
              ),
            ),
          ),
          SafeArea(
            child: Column(
              children: [
                _topBar(context, elf),
                Expanded(
                  child: GestureDetector(
                    behavior: HitTestBehavior.opaque,
                    onTap: () => FocusScope.of(context).unfocus(),
                    child: NotificationListener<ScrollNotification>(
                      onNotification: (n) {
                        if (n.metrics.pixels > n.metrics.minScrollExtent + 80) {
                          _autoscroll = false;
                        } else if (n.metrics.pixels <= n.metrics.minScrollExtent + 8) {
                          _autoscroll = true;
                        }
                        return false;
                      },
                      child: ListView.builder(
                        controller: _scroll,
                        reverse: true,
                        padding: const EdgeInsets.fromLTRB(26, 10, 26, 14),
                        itemCount: msgs.length,
                        itemBuilder: (context, i) => _message(msgs[msgs.length - 1 - i]),
                      ),
                    ),
                  ),
                ),
                _identity(elf),
                if (sleeping) _sleepChip(),
                _inputBar(sleeping),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // —— 顶栏 ——

  Widget _topBar(BuildContext context, Elf elf) {
    final followed = _state.isFollowed(elf.id);
    return Padding(
      padding: const EdgeInsets.fromLTRB(10, 6, 10, 2),
      child: Row(
        children: [
          _glassIcon(
            icon: Icons.arrow_back_ios_new,
            semantic: '返回',
            size: 17,
            onTap: () => Navigator.of(context).pop(),
          ),
          const Spacer(),
          if (!elf.isMine) ...[
            _glassIcon(
              icon: followed ? Icons.favorite : Icons.favorite_border,
              semantic: followed ? '取消关注' : '关注',
              size: 17,
              color: followed ? AppColors.danger : Colors.white,
              onTap: () => _state.toggleFollow(elf.id),
            ),
            const SizedBox(width: 8),
          ],
          _glassIcon(
            icon: Icons.more_horiz,
            semantic: '更多',
            size: 18,
            onTap: () => _moreSheet(elf),
          ),
        ],
      ),
    );
  }

  Widget _glassIcon({
    required IconData icon,
    required String semantic,
    required VoidCallback onTap,
    double size = 18,
    Color color = Colors.white,
  }) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Container(
        width: 38,
        height: 38,
        decoration: BoxDecoration(
          color: Colors.black.withOpacity(0.28),
          shape: BoxShape.circle,
          border: Border.all(color: Colors.white.withOpacity(0.10)),
        ),
        child: Icon(icon, size: size, color: color, semanticLabel: semantic),
      ),
    );
  }

  // —— 单条对白 ——

  Widget _message(ChatMsg msg) {
    if (msg.fromElf) {
      return Padding(
        padding: const EdgeInsets.only(bottom: 22),
        child: Column(
          children: [
            Text.rich(
              TextSpan(children: _spans(msg.text)),
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 15, height: 1.85, color: Colors.white),
            ),
            const SizedBox(height: 6),
            Text(
              msg.time,
              style: TextStyle(fontSize: 9, color: Colors.white.withOpacity(0.28)),
            ),
          ],
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.only(bottom: 20),
      child: Align(
        alignment: Alignment.centerRight,
        child: Container(
          constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.72),
          padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 10),
          decoration: BoxDecoration(
            color: Colors.white.withOpacity(0.10),
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: Colors.white.withOpacity(0.14)),
          ),
          child: Text(
            msg.text,
            style: const TextStyle(fontSize: 14, height: 1.6, color: Colors.white),
          ),
        ),
      ),
    );
  }

  /// 括号里的动作描写弱化为灰蓝色，台词保持白色。
  List<TextSpan> _spans(String text) {
    final lines = text.split('\n');
    return [
      for (var i = 0; i < lines.length; i++) ...[
        if (i > 0) const TextSpan(text: '\n'),
        TextSpan(
          text: lines[i],
          style: lines[i].trimLeft().startsWith('（')
              ? TextStyle(
                  color: Colors.white.withOpacity(0.62),
                  fontStyle: FontStyle.italic,
                  fontSize: 13.5,
                )
              : null,
        ),
      ],
    ];
  }

  // —— 角色信息（输入条上方）——

  Widget _identity(Elf elf) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 16, 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Flexible(
                child: Text(
                  elf.name,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                    color: Colors.white,
                    shadows: [Shadow(blurRadius: 10, color: Colors.black54)],
                  ),
                ),
              ),
              const SizedBox(width: 6),
              Text(
                elf.serial,
                style: TextStyle(fontSize: 10, color: Colors.white.withOpacity(0.42)),
              ),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: Colors.white.withOpacity(0.12),
                  borderRadius: BorderRadius.circular(5),
                ),
                child: Text(
                  'Lv${elf.level} · ${elf.levelName}',
                  style: TextStyle(fontSize: 9, color: Colors.white.withOpacity(0.72)),
                ),
              ),
              const Spacer(),
              GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => ElfDetailPage(elfId: elf.id)),
                ),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
                  child: Icon(
                    Icons.open_in_new,
                    size: 15,
                    color: Colors.white.withOpacity(0.66),
                    semanticLabel: '查看 AI 主页',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Row(
            children: [
              Expanded(
                child: Text(
                  elf.persona,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 11, color: Colors.white.withOpacity(0.52)),
                ),
              ),
              const SizedBox(width: 10),
              _metaText('${elf.followers} 粉丝'),
              _dot(),
              _metaText('${elf.works} 作品'),
              _dot(),
              _metaText('${elf.echo} 回声'),
            ],
          ),
        ],
      ),
    );
  }

  Widget _metaText(String text) => Text(
        text,
        style: TextStyle(fontSize: 9.5, color: Colors.white.withOpacity(0.40)),
      );

  Widget _dot() => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 5),
        child: Text('·', style: TextStyle(fontSize: 9.5, color: Colors.white.withOpacity(0.3))),
      );

  Widget _sleepChip() {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.10),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Colors.white.withOpacity(0.12)),
      ),
      child: Text(
        '它在休眠 · 留言不会被回应',
        style: TextStyle(fontSize: 10.5, color: Colors.white.withOpacity(0.62)),
      ),
    );
  }

  // —— 输入条 ——

  Widget _inputBar(bool sleeping) {
    final hasText = _input.text.trim().isNotEmpty;
    return Padding(
      // Scaffold 已随键盘上移，这里不再重复叠加 viewInsets。
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
      child: Container(
        padding: const EdgeInsets.fromLTRB(8, 6, 6, 6),
        decoration: BoxDecoration(
          color: Colors.black.withOpacity(0.34),
          borderRadius: BorderRadius.circular(28),
          border: Border.all(color: Colors.white.withOpacity(0.14)),
        ),
        child: Row(
          children: [
            _barIcon(
              icon: Icons.phone_outlined,
              semantic: '语音通话',
              onTap: () => _toast('通话功能即将开放'),
            ),
            Expanded(
              child: TextField(
                controller: _input,
                enabled: !sleeping,
                textInputAction: TextInputAction.send,
                onSubmitted: (_) => _send(),
                style: const TextStyle(fontSize: 14, color: Colors.white),
                cursorColor: AppColors.cyan,
                decoration: InputDecoration(
                  isDense: true,
                  hintText: sleeping ? '它休眠中，无法回应' : '自由输入…',
                  hintStyle: TextStyle(
                    fontSize: 14,
                    color: Colors.white.withOpacity(sleeping ? 0.28 : 0.42),
                  ),
                  border: InputBorder.none,
                  contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
                ),
              ),
            ),
            _barIcon(
              icon: Icons.mic_none,
              semantic: '语音输入',
              onTap: () => _toast('语音输入即将开放'),
            ),
            const SizedBox(width: 4),
            GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: sleeping
                  ? null
                  : () {
                      if (hasText) {
                        _send();
                      } else {
                        _moreSheet(_state.elf(widget.elfId));
                      }
                    },
              child: Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  gradient: hasText && !sleeping ? AppColors.brandGradient : null,
                  color: hasText && !sleeping ? null : Colors.white.withOpacity(0.12),
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  hasText ? Icons.arrow_upward : Icons.add,
                  size: 19,
                  color: hasText && !sleeping ? AppColors.bgDeep : Colors.white.withOpacity(0.8),
                  semanticLabel: hasText ? '发送' : '更多操作',
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _barIcon({
    required IconData icon,
    required String semantic,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.all(8),
        child: Icon(
          icon,
          size: 21,
          color: Colors.white.withOpacity(0.72),
          semanticLabel: semantic,
        ),
      ),
    );
  }

  // —— 更多操作 ——

  void _moreSheet(Elf elf) {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.bgDeep,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 36,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.stroke,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(height: 12),
              _sheetRow(
                icon: Icons.ios_share,
                label: '分享这只 AI',
                onTap: () {
                  Navigator.of(ctx).pop();
                  ShareHelper.shareElf(context, elf, excerpt: elf.persona);
                },
              ),
              _sheetRow(
                icon: Icons.open_in_new,
                label: '查看 AI 主页',
                onTap: () {
                  Navigator.of(ctx).pop();
                  Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => ElfDetailPage(elfId: elf.id)),
                  );
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _sheetRow({
    required IconData icon,
    required String label,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 14),
        child: Row(
          children: [
            Icon(icon, size: 18, color: AppColors.textSub),
            const SizedBox(width: 12),
            Text(label, style: const TextStyle(fontSize: 14, color: AppColors.text)),
          ],
        ),
      ),
    );
  }
}

/// 程序化生成的「夜间房间」背景：月光窗口 + 台灯光晕 + 尘埃。
class _NightRoomPainter extends CustomPainter {
  const _NightRoomPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;

    // 底色：深海军蓝 → 墨黑
    canvas.drawRect(
      rect,
      Paint()
        ..shader = const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Color(0xFF0B1222), Color(0xFF0E1A33), Color(0xFF070A14)],
          stops: [0, 0.52, 1],
        ).createShader(rect),
    );

    // 右上：月光从窗外透进来
    _glow(canvas, Offset(size.width * 0.86, size.height * 0.16), size.width * 0.82,
        const Color(0xFF2E7E9C), 0.55);
    // 左中：紫色环境光
    _glow(canvas, Offset(size.width * 0.06, size.height * 0.44), size.width * 0.72,
        const Color(0xFF4A2E86), 0.38);
    // 左下：暖色台灯
    _glow(canvas, Offset(size.width * 0.10, size.height * 0.84), size.width * 0.46,
        const Color(0xFF9A642E), 0.34);

    // 窗框
    final window = Rect.fromLTWH(size.width * 0.46, size.height * 0.05, size.width * 0.5,
        size.height * 0.34);
    canvas.drawRRect(
      RRect.fromRectAndRadius(window, const Radius.circular(10)),
      Paint()..color = Colors.white.withOpacity(0.035),
    );
    canvas.drawRRect(
      RRect.fromRectAndRadius(window, const Radius.circular(10)),
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1
        ..color = Colors.white.withOpacity(0.08),
    );
    // 窗棂
    final frame = Paint()
      ..color = Colors.white.withOpacity(0.05)
      ..strokeWidth = 1.4;
    canvas.drawLine(
      Offset(window.center.dx, window.top),
      Offset(window.center.dx, window.bottom),
      frame,
    );
    canvas.drawLine(
      Offset(window.left, window.center.dy),
      Offset(window.right, window.center.dy),
      frame,
    );

    // 雨丝：只落在窗内
    final rnd = math.Random(17);
    canvas.save();
    canvas.clipRRect(RRect.fromRectAndRadius(window, const Radius.circular(10)));
    final rain = Paint()
      ..strokeWidth = 0.9
      ..color = Colors.white.withOpacity(0.055);
    for (var i = 0; i < 46; i++) {
      final x = window.left + rnd.nextDouble() * window.width;
      final y = window.top + rnd.nextDouble() * window.height;
      final len = 6 + rnd.nextDouble() * 14;
      canvas.drawLine(Offset(x, y), Offset(x - 1.4, y + len), rain);
    }
    canvas.restore();

    // 空中尘埃
    final dust = Paint();
    for (var i = 0; i < 90; i++) {
      final x = rnd.nextDouble() * size.width;
      final y = rnd.nextDouble() * size.height * 0.75;
      dust.color = Colors.white.withOpacity(0.02 + rnd.nextDouble() * 0.045);
      canvas.drawCircle(Offset(x, y), 0.6 + rnd.nextDouble() * 0.9, dust);
    }

    // 四周暗角
    canvas.drawRect(
      rect,
      Paint()
        ..shader = const RadialGradient(
          radius: 0.95,
          colors: [Colors.transparent, Color(0xCC04060D)],
          stops: [0.52, 1],
        ).createShader(rect),
    );
  }

  void _glow(Canvas canvas, Offset center, double radius, Color color, double alpha) {
    final shader = RadialGradient(
      colors: [color.withOpacity(alpha), color.withOpacity(alpha * 0.35), Colors.transparent],
      stops: const [0, 0.45, 1],
    ).createShader(Rect.fromCircle(center: center, radius: radius));
    canvas.drawCircle(center, radius, Paint()..shader = shader);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
