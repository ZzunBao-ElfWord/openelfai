import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../models/elf.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/share_card.dart';
import 'elf_detail_page.dart';

/// 沉浸式对话页：全屏 AI 氛围图做底 + 对白叠加在图内下半部 + 悬浮输入条。
/// 视觉参考：猫箱（Moke）对话页，已按参考图苏语嫣版复刻。
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

  void _onInputChanged() => mounted ? setState(() {}) : null;

  void _onStateChanged() {
    if (!mounted) return;
    setState(() {});
    WidgetsBinding.instance.addPostFrameCallback((_) => _jumpToLatest());
  }

  void _jumpToLatest() {
    if (!_scroll.hasClients) return;
    _scroll.jumpTo(_scroll.position.minScrollExtent);
  }

  void _send() {
    final text = _input.text.trim();
    if (text.isEmpty) return;
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

    final keyboard = MediaQuery.of(context).viewInsets.bottom;

    return Scaffold(
      // 对话页是沉浸式「剧场」：两套主题下都保持黑底，保证人物剪影与对白可读。
      backgroundColor: darkPalette.bg,
      // 键盘弹出时只抬起底栏，背景保持全屏不压缩（否则人物剪影会被压扁）
      resizeToAvoidBottomInset: false,
      body: Stack(
        fit: StackFit.expand,
        children: [
          // 1) AI 氛围背景
          const RepaintBoundary(child: CustomPaint(painter: _ElfScenePainter())),
          // 2) 顶部 & 底部压暗遮罩：让状态栏图标与底部对白可读
          Positioned.fill(
            child: IgnorePointer(
              child: Container(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [
                      Colors.black.withOpacity(0.42),
                      Colors.black.withOpacity(0.0),
                      Colors.black.withOpacity(0.0),
                      Colors.black.withOpacity(0.55),
                      Colors.black.withOpacity(0.94),
                    ],
                    stops: const [0, 0.16, 0.52, 0.80, 1],
                  ),
                ),
              ),
            ),
          ),
          // 3) 左侧竖排水印
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
                    color: Colors.white.withOpacity(0.28),
                  ),
                ),
              ),
            ),
          ),
          // 4) 顶栏（返回 + 搜索 + 音量）
          Positioned(
            top: 0, left: 0, right: 0,
            child: SafeArea(
              bottom: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(14, 6, 14, 0),
                child: Row(
                  children: [
                    _plainIcon(
                      icon: Icons.arrow_back_ios_new,
                      semantic: '返回',
                      size: 17,
                      onTap: () => Navigator.of(context).pop(),
                    ),
                    const Spacer(),
                    _plainIcon(
                      icon: Icons.search,
                      semantic: '搜索',
                      size: 22,
                      onTap: () => _toast('搜索即将开放'),
                    ),
                    const SizedBox(width: 18),
                    _plainIcon(
                      icon: Icons.volume_up_outlined,
                      semantic: '音量',
                      size: 22,
                      onTap: () => _toast('音量即将开放'),
                    ),
                  ],
                ),
              ),
            ),
          ),
          // 5) 名字行（图片内部）
          Positioned(
            top: 120,
            left: 0, right: 0,
            child: Center(child: _nameLine(elf, context)),
          ),
          // 6) 对白消息列表（图片内下半部，向上滚动看历史）
          Positioned(
            left: 24, right: 24, top: 200, bottom: 200 + keyboard,
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: () => FocusScope.of(context).unfocus(),
              child: ListView.builder(
                controller: _scroll,
                reverse: true,
                padding: const EdgeInsets.only(bottom: 10),
                itemCount: msgs.length,
                itemBuilder: (context, i) => _message(msgs[msgs.length - 1 - i]),
              ),
            ),
          ),
          // 7) 底部身份行 + 输入条（键盘弹出时整体上移）
          Positioned(
            left: 0, right: 0, bottom: keyboard,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                SafeArea(top: false, child: _identityRow(elf)),
                _inputBar(sleeping),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // —— 名字行（图片内部）——

  Widget _nameLine(Elf elf, BuildContext color) {
    return Column(
      children: [
        GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => ElfDetailPage(elfId: elf.id)),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                elf.name,
                style: const TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w700,
                  color: Colors.white,
                  shadows: [Shadow(blurRadius: 12, color: Colors.black54)],
                ),
              ),
              const SizedBox(width: 5),
              const Icon(
                Icons.chevron_right_rounded,
                size: 21,
                color: Colors.white,
                semanticLabel: '查看 AI 主页',
              ),
            ],
          ),
        ),
        const SizedBox(height: 2),
        // 红色下划线
        Container(
          width: elf.name.length * 9.0 + 20,
          height: 2.2,
          decoration: BoxDecoration(
            color: const Color(0xFFFF5A6B),
            borderRadius: BorderRadius.circular(1.1),
            boxShadow: [BoxShadow(color: const Color(0xFFFF5A6B).withOpacity(0.35), blurRadius: 6)],
          ),
        ),
      ],
    );
  }

  // —— 对白消息（AI 居中 / 用户右气泡）——

  Widget _message(ChatMsg msg) {
    if (msg.fromElf) {
      return Padding(
        padding: const EdgeInsets.only(bottom: 28),
        child: Column(
          children: [
            Text.rich(
              TextSpan(children: _spans(msg.text)),
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 21, height: 1.75, color: Colors.white, fontWeight: FontWeight.w500),
            ),
          ],
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.only(bottom: 18),
      child: Align(
        alignment: Alignment.centerRight,
        child: Container(
          constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.68),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          decoration: BoxDecoration(
            color: Colors.white.withOpacity(0.14),
            borderRadius: BorderRadius.circular(20),
          ),
          child: Text(
            msg.text,
            style: const TextStyle(fontSize: 15, height: 1.5, color: Colors.white),
          ),
        ),
      ),
    );
  }

  List<TextSpan> _spans(String text) {
    final lines = text.split('\n');
    return [
      for (var i = 0; i < lines.length; i++) ...[
        if (i > 0) const TextSpan(text: '\n'),
        TextSpan(
          text: lines[i],
          style: lines[i].trimLeft().startsWith('（')
              ? TextStyle(
                  color: Colors.white.withOpacity(0.58),
                  fontStyle: FontStyle.italic,
                  fontSize: 14,
                )
              : null,
        ),
      ],
    ];
  }

  // —— 身份行（底部紧凑一行：头像+名字+@昵称+❤️+📤+💬+⏰）——

  Widget _identityRow(Elf elf) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Row(
        children: [
          // 头像（渐变色+首字）
          Container(
            width: 28, height: 28,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: AppColors.brandGradient,
            ),
            alignment: Alignment.center,
            child: Text(
              elf.initial,
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Color(0xFF070B16)),
            ),
          ),
          const SizedBox(width: 8),
          Text(
            elf.name,
            style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: Colors.white),
          ),
          const SizedBox(width: 4),
          Text(
            '@${elf.serial}',
            style: TextStyle(fontSize: 11, color: Colors.white.withOpacity(0.52)),
          ),
          const Spacer(),
          _identityAction(icon: Icons.favorite_border, label: _fmt(elf.followers), onTap: () {}),
          const SizedBox(width: 14),
          _identityAction(icon: Icons.chat_bubble_outline, label: _fmt(elf.echo), onTap: () {}),
          const SizedBox(width: 14),
          _identityAction(icon: Icons.star_border, label: _fmt(elf.works), onTap: () {}),
          const SizedBox(width: 14),
          _identityAction(icon: Icons.ios_share, label: '分享', onTap: () => _share(elf)),
          const SizedBox(width: 14),
          _identityAction(icon: Icons.schedule, label: '历史', onTap: () => _toast('历史即将开放')),
        ],
      ),
    );
  }

  Widget _identityAction({required IconData icon, required String label, required VoidCallback onTap}) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 17, color: Colors.white.withOpacity(0.72)),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(fontSize: 11.5, color: Colors.white.withOpacity(0.72)),
          ),
        ],
      ),
    );
  }

  // —— 输入条 ——

  Widget _inputBar(bool sleeping) {
    final hasText = _input.text.trim().isNotEmpty;
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
      child: Row(
        children: [
          // 输入胶囊
          Expanded(
            child: Container(
              padding: const EdgeInsets.fromLTRB(8, 4, 8, 4),
              decoration: BoxDecoration(
                color: Colors.white.withOpacity(0.10),
                borderRadius: BorderRadius.circular(26),
                border: Border.all(color: Colors.white.withOpacity(0.16)),
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
                      cursorColor: Colors.white,
                      decoration: InputDecoration(
                        isDense: true,
                        hintText: sleeping ? '它休眠中，无法回应' : '自由输入...',
                        hintStyle: TextStyle(
                          fontSize: 14,
                          color: Colors.white.withOpacity(sleeping ? 0.28 : 0.55),
                        ),
                        border: InputBorder.none,
                        contentPadding: const EdgeInsets.symmetric(horizontal: 6, vertical: 10),
                      ),
                    ),
                  ),
                  _barIcon(
                    icon: Icons.mic_none,
                    semantic: '语音输入',
                    onTap: () => _toast('语音输入即将开放'),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(width: 10),
          // 圆形主按钮：无文字时是「+」，有文字时变红色发送箭头
          GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: sleeping
                ? null
                : () {
                    if (hasText) {
                      _send();
                    } else {
                      _share(_state.elf(widget.elfId));
                    }
                  },
            child: Container(
              width: 44, height: 44,
              decoration: BoxDecoration(
                gradient: hasText && !sleeping
                    ? const LinearGradient(colors: [Color(0xFFFF5A6B), Color(0xFFFF8B7F)])
                    : null,
                color: hasText && !sleeping ? null : Colors.white.withOpacity(0.14),
                shape: BoxShape.circle,
                border: Border.all(color: Colors.white.withOpacity(0.18)),
              ),
              child: Icon(
                hasText ? Icons.arrow_upward : Icons.add,
                size: 21,
                color: Colors.white,
                semanticLabel: hasText ? '发送' : '更多操作',
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _barIcon({required IconData icon, required String semantic, required VoidCallback onTap}) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.all(8),
        child: Icon(icon, size: 21, color: Colors.white.withOpacity(0.72), semanticLabel: semantic),
      ),
    );
  }

  /// 参考图顶栏是无底色的纯白图标（只有投影），不是玻璃球。
  Widget _plainIcon({
    required IconData icon,
    required String semantic,
    required VoidCallback onTap,
    double size = 18,
  }) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.all(10),
        child: Icon(
          icon,
          size: size,
          color: Colors.white,
          semanticLabel: semantic,
          shadows: const [Shadow(blurRadius: 10, color: Colors.black87)],
        ),
      ),
    );
  }

  void _share(Elf elf) {
    ShareHelper.shareElf(context, elf, excerpt: elf.persona);
  }

  String _fmt(int n) {
    if (n >= 10000) return '${(n / 10000).toStringAsFixed(1)}w';
    if (n >= 1000) return '${(n / 1000).toStringAsFixed(1)}k';
    return n.toString();
  }
}

/// 程序化绘制 AI 氛围背景：深色渐变 + 人物剪影轮廓 + 双光源 + 暗角。
/// 参考图的「苏语嫣」那种感觉——不依赖外部图片，全部就地绘制。
class _ElfScenePainter extends CustomPainter {
  const _ElfScenePainter();

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;

    // 底色：参考图的暖灰米色调渐变（左上亮→右下暗）
    canvas.drawRect(
      rect,
      Paint()
        ..shader = const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF3D3545), Color(0xFF2A2535), Color(0xFF1A1825)],
          stops: [0, 0.5, 1],
        ).createShader(rect),
    );

    // 主光源：参考图左上方柔光（像窗户光打在人物脸上）
    _glow(canvas, Offset(size.width * 0.20, size.height * 0.18), size.width * 0.70,
        const Color(0xFFC4A882), 0.35);
    // 次光源：人物右侧头发的反光
    _glow(canvas, Offset(size.width * 0.85, size.height * 0.30), size.width * 0.45,
        const Color(0xFF6B5A52), 0.22);
    // 底部微弱暖光（模拟室内环境）
    _glow(canvas, Offset(size.width * 0.45, size.height * 0.92), size.width * 0.55,
        const Color(0xFF4A3E38), 0.25);

    // 人物剪影（参考图的真实人物轮廓）
    _drawSilhouette(canvas, size);

    // 四周暗角（让人物更突出）
    canvas.drawRect(
      rect,
      Paint()
        ..shader = const RadialGradient(
          radius: 0.82,
          colors: [Colors.transparent, Color(0xB305040A)],
          stops: [0.50, 1],
        ).createShader(rect),
    );

    // 空中尘埃/光点
    final rnd = math.Random(13);
    final dust = Paint();
    for (var i = 0; i < 50; i++) {
      final x = rnd.nextDouble() * size.width;
      final y = rnd.nextDouble() * size.height * 0.85;
      dust.color = Colors.white.withOpacity(0.02 + rnd.nextDouble() * 0.03);
      canvas.drawCircle(Offset(x, y), 0.5 + rnd.nextDouble() * 0.7, dust);
    }
  }

  void _drawSilhouette(Canvas canvas, Size size) {
    final path = Path();
    final w = size.width;
    final h = size.height;

    // 参考图苏语嫣那种居中偏右的人物全身剪影
    // 人物占画面中间大部分区域，从头顶到底部
    path.moveTo(w * 0.52, h * 0.02);  // 头顶中心偏左
    // 左侧发际线（从头顶到额头左侧）
    path.quadraticBezierTo(w * 0.40, h * 0.04, w * 0.34, h * 0.12);
    // 左侧脸轮廓（额头→眼窝→颧骨）
    path.quadraticBezierTo(w * 0.28, h * 0.22, w * 0.26, h * 0.32);
    // 左下巴（向内收）
    path.quadraticBezierTo(w * 0.25, h * 0.42, w * 0.28, h * 0.46);
    // 左颈部
    path.quadraticBezierTo(w * 0.30, h * 0.52, w * 0.35, h * 0.55);
    // 左肩（向外展开）
    path.quadraticBezierTo(w * 0.28, h * 0.60, w * 0.18, h * 0.64);
    // 左臂（向下延伸到画面底部）
    path.quadraticBezierTo(w * 0.12, h * 0.75, w * 0.15, h * 0.98);
    path.lineTo(w * 0.52, h);  // 身体左侧在底部收口
    // 身体底部到右侧（裙摆/身体曲线）
    path.quadraticBezierTo(w * 0.62, h * 0.92, w * 0.60, h * 0.80);
    // 右腰
    path.quadraticBezierTo(w * 0.65, h * 0.68, w * 0.70, h * 0.62);
    // 右肩（向外突出）
    path.quadraticBezierTo(w * 0.80, h * 0.58, w * 0.88, h * 0.52);
    // 右侧头部轮廓（头发/耳朵）
    path.quadraticBezierTo(w * 0.92, h * 0.42, w * 0.86, h * 0.28);
    // 头顶右侧（连接回起点）
    path.quadraticBezierTo(w * 0.82, h * 0.16, w * 0.70, h * 0.06);
    path.quadraticBezierTo(w * 0.62, h * 0.02, w * 0.52, h * 0.02);
    path.close();

    // 剪影填充：左侧被光源照到（较亮），右侧在阴影里（较暗）
    canvas.drawPath(
      path,
      Paint()
        ..shader = LinearGradient(
          begin: Alignment.centerLeft,
          end: Alignment.centerRight,
          colors: [
            const Color(0xFF4A3E48).withOpacity(0.85),
            const Color(0xFF2A2432).withOpacity(0.82),
            Colors.black.withOpacity(0.92),
          ],
          stops: const [0, 0.5, 1],
        ).createShader(path.getBounds()),
    );

    // 左侧脸部/肩部高光描边（被左上方光照亮的边缘）
    final stroke = Paint()
      ..color = const Color(0xFFC4A882).withOpacity(0.25)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5;
    canvas.drawPath(path, stroke);
  }

  void _glow(Canvas canvas, Offset center, double radius, Color color, double alpha) {
    final shader = RadialGradient(
      colors: [color.withOpacity(alpha), color.withOpacity(alpha * 0.3), Colors.transparent],
      stops: const [0, 0.42, 1],
    ).createShader(Rect.fromCircle(center: center, radius: radius));
    canvas.drawCircle(center, radius, Paint()..shader = shader);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
