import 'dart:async';

import 'package:flutter/material.dart';

import '../models/elf.dart';
import '../config/payment_features.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';
import '../widgets/share_card.dart';
import '../widgets/content_safety.dart';
import 'api_key_page.dart';
import 'elf_console_page.dart';
import 'login_page.dart';

/// AI 对外对话框：顶部 AI 形象展示位 + 左右对白气泡 + 底部输入条。
/// 视觉参考：Muse 移动端对话页（浅色、留白、圆角气泡）。
/// 平台约定：AI 必须有形象，头像统一走 [ElfAvatar]（UGC / 身份证 / 平台发售一致）。
class ElfChatPage extends StatefulWidget {
  final String elfId;
  const ElfChatPage({super.key, required this.elfId});

  @override
  State<ElfChatPage> createState() => _ElfChatPageState();
}

class _ElfChatPageState extends State<ElfChatPage> {
  final TextEditingController _input = TextEditingController();
  final ScrollController _scroll = ScrollController();

  /// 等待 AI 回复中：显示「正在输入…」占位并禁用发送按钮。
  bool _sending = false;

  AppState get _state => AppState.instance;

  @override
  void initState() {
    super.initState();
    _state.addListener(_onStateChanged);
    _input.addListener(_onInputChanged);
    // 打开会话即拉服务端记录，换设备后能接着聊。
    unawaited(_state.loadChat(widget.elfId));
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

  Future<void> _send() async {
    if (_sending) return;
    if (_state.isElfBlocked(widget.elfId)) {
      _toast('此AI已被屏蔽，请先在设置中解除屏蔽');
      return;
    }
    final text = _input.text.trim();
    if (text.isEmpty) return;
    // 游客（Web 免登录体验）：发消息前先提醒登录
    if (!checkLoginOrPrompt(context)) return;
    _input.clear();
    setState(() => _sending = true);
    WidgetsBinding.instance.addPostFrameCallback((_) => _jumpToLatest());

    // 真实对话期间保持占位；页面销毁后不再 setState。
    await _state.sendChat(widget.elfId, text);
    if (!mounted) return;
    setState(() => _sending = false);
    WidgetsBinding.instance.addPostFrameCallback((_) => _jumpToLatest());
  }

  void _toast(String text) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(text), duration: const Duration(seconds: 2)),
    );
  }

  /// 自己的 AI 从这里进控制台；别人的 AI 就停在对话里，不再单独开对外主页。
  void _openProfile(Elf elf) {
    if (!elf.isMine) return;
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => ElfConsolePage(elfId: elf.id)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final elf = _state.elf(widget.elfId);
    if (_state.isElfBlocked(elf.id))
      return Scaffold(
          appBar: AppBar(title: const Text('已屏蔽此AI')),
          body: const Center(child: Text('不再展示该AI的内容。可在设置→内容安全与反馈中解除屏蔽。')));
    final msgs = _state.chatOf(widget.elfId);

    return Scaffold(
      backgroundColor: AppColors.bg,
      // 桌面宽屏：对话收窄居中
      body: WideContent(
        maxWidth: 760,
        child: SafeArea(
          bottom: false,
          child: Column(
            children: [
              _header(elf),
              Expanded(
                child: GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: () => FocusScope.of(context).unfocus(),
                  child: ListView.builder(
                    controller: _scroll,
                    reverse: true,
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
                    itemCount: msgs.length + (_sending ? 1 : 0),
                    itemBuilder: (context, i) {
                      // reverse 列表：i=0 是最底部；等待回复时占位在最下方。
                      if (_sending && i == 0) return _typingBubble();
                      final index = _sending ? i - 1 : i;
                      return _message(msgs[msgs.length - 1 - index]);
                    },
                  ),
                ),
              ),
              _bottomBar(elf),
            ],
          ),
        ),
      ),
    );
  }

  // —— 顶部：返回 + AI 形象展示位 + AI 主页入口 ——

  Widget _header(Elf elf) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 6, 12, 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _circleButton(
            icon: Icons.arrow_back_ios_new,
            semantic: '返回',
            size: 16,
            onTap: () => Navigator.of(context).pop(),
          ),
          Expanded(
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: elf.isMine ? () => _openProfile(elf) : null,
              child: Column(
                children: [
                  ElfAvatar(elf: elf, size: 40),
                  const SizedBox(height: 6),
                  Text(
                    elf.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w600,
                      color: AppColors.text,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '内容由 AI 生成',
                    style: TextStyle(
                      fontSize: 10,
                      letterSpacing: 0.4,
                      color: AppColors.textFaint,
                    ),
                  ),
                ],
              ),
            ),
          ),
          elf.isMine
              ? _circleButton(
                  icon: Icons.tune_rounded,
                  semantic: '打开 AI 控制台',
                  size: 19,
                  onTap: () => _openProfile(elf),
                )
              : Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    _followChip(elf),
                    const SizedBox(width: 4),
                    _circleButton(
                      icon: Icons.flag_outlined,
                      semantic: '举报或拉黑这只 AI',
                      size: 16,
                      onTap: () => _openSafetySheet(elf),
                    ),
                  ],
                ),
        ],
      ),
    );
  }

  /// 别人的 AI：关注入口收在对话页顶部（原来的对外主页已不再提供）。
  Widget _followChip(Elf elf) {
    final followed = _state.isFollowed(elf.id);
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: () {
        if (!checkLoginOrPrompt(context)) return;
        _state.toggleFollow(elf.id);
        setState(() {});
      },
      child: Container(
        margin: const EdgeInsets.only(top: 2),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(20),
          gradient: followed ? null : AppColors.brandGradient,
          border: followed ? Border.all(color: AppColors.stroke) : null,
        ),
        child: Text(
          followed ? '已关注' : '+ 关注',
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w700,
            color: followed ? AppColors.textMuted : AppColors.onBrand,
          ),
        ),
      ),
    );
  }

  /// 举报与拉黑：App Store 要求 UGC 场景提供举报与屏蔽能力。
  void _openSafetySheet(Elf elf) {
    const reasons = <String, String>{
      '色情低俗': 'porn',
      '暴力血腥': 'violence',
      '涉及未成年人': 'minors',
      '骚扰辱骂': 'harassment',
      '诈骗或虚假信息': 'fraud',
      '侵犯隐私': 'privacy',
      '其他违规': 'other',
    };
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('这只 AI 有什么问题？',
                  style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      color: AppColors.text)),
              const SizedBox(height: 4),
              Text('举报后我们会尽快审核，你也可以直接拉黑。',
                  style: TextStyle(fontSize: 11, color: AppColors.textMuted)),
              const SizedBox(height: 10),
              ...reasons.entries.map((entry) => InkWell(
                    onTap: () async {
                      Navigator.of(ctx).pop();
                      final error = await _state.submitReport(
                        targetType: 'elf',
                        targetId: elf.id,
                        reason: entry.value,
                        detail: entry.key,
                      );
                      if (!mounted) return;
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text(error ?? '已收到举报，我们会尽快处理')),
                      );
                    },
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 11),
                      child: Text(entry.key,
                          style: TextStyle(
                              fontSize: 13, color: AppColors.textSub)),
                    ),
                  )),
              Divider(height: 18, color: AppColors.strokeSoft),
              InkWell(
                onTap: () async {
                  Navigator.of(ctx).pop();
                  final error = await _state.blockElf(elf.id);
                  if (!mounted) return;
                  if (error == null) Navigator.of(context).pop();
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text(error ?? '已拉黑这只 AI')),
                  );
                },
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  child: Row(
                    children: [
                      Icon(Icons.block, size: 15, color: AppColors.warn),
                      const SizedBox(width: 6),
                      Text('拉黑这只 AI',
                          style:
                              TextStyle(fontSize: 13, color: AppColors.warn)),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _circleButton({
    required IconData icon,
    required String semantic,
    required VoidCallback onTap,
    double size = 18,
  }) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Container(
        width: 36,
        height: 36,
        decoration: BoxDecoration(
          color: AppColors.surfaceAlt,
          shape: BoxShape.circle,
        ),
        child: Icon(
          icon,
          size: size,
          color: AppColors.textSub,
          semanticLabel: semantic,
        ),
      ),
    );
  }

  // —— 消息气泡：AI 左灰 / 用户右蓝 ——

  Widget _message(ChatMsg msg) {
    final fromElf = msg.fromElf;
    final userBubble = AppColors.palette.isDark
        ? AppColors.brand.withOpacity(0.22)
        : const Color(0xFFDBEAFE);

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Align(
        alignment: fromElf ? Alignment.centerLeft : Alignment.centerRight,
        child: LayoutBuilder(
          builder: (context, c) => GestureDetector(
            onLongPress: fromElf ? () => _reportChatMessage(msg) : null,
            child: Container(
              constraints: BoxConstraints(maxWidth: c.maxWidth * 0.78),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: fromElf ? AppColors.surfaceAlt : userBubble,
                borderRadius: const BorderRadius.all(Radius.circular(18)),
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text.rich(
                    TextSpan(children: _spans(msg.text)),
                    style: TextStyle(
                      fontSize: 15,
                      height: 1.55,
                      color: AppColors.text,
                    ),
                  ),
                  if (_needsTopUp(msg))
                    TextButton(
                      onPressed: _openApiKey,
                      style: TextButton.styleFrom(
                        foregroundColor: AppColors.brand,
                        minimumSize: const Size(0, 26),
                        padding: EdgeInsets.zero,
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        textStyle: const TextStyle(
                            fontSize: 12.5, fontWeight: FontWeight.w600),
                      ),
                      child: Text(PaymentFeatures.apiTopupEnabled
                          ? '去充值'
                          : '查看 API 账户'),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  /// 长按 AI 回复可单独举报该条对话内容。
  void _reportChatMessage(ChatMsg msg) {
    const reasons = <String, String>{
      '色情低俗': 'porn',
      '暴力血腥': 'violence',
      '涉及未成年人': 'minors',
      '涉政敏感': 'politics',
      '违法信息': 'illegal',
      '骚扰辱骂': 'harassment',
      '诈骗或虚假信息': 'fraud',
      '侵犯隐私': 'privacy',
      '其他违规': 'other',
    };
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('举报这条 AI 回复',
                  style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      color: AppColors.text)),
              const SizedBox(height: 10),
              ...reasons.entries.map((entry) => InkWell(
                    onTap: () async {
                      Navigator.of(ctx).pop();
                      final targetId = 'chat_${widget.elfId}_'
                          '${msg.id ?? msg.time.hashCode.abs()}';
                      final error = await _state.submitReport(
                        targetType: 'chat',
                        targetId: targetId,
                        reason: entry.value,
                        detail:
                            '${entry.key}｜${msg.text.length > 200 ? msg.text.substring(0, 200) : msg.text}',
                      );
                      if (!mounted) return;
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text(error ?? '已收到举报，我们会尽快处理')),
                      );
                    },
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 11),
                      child: Text(entry.key,
                          style: TextStyle(
                              fontSize: 13, color: AppColors.textSub)),
                    ),
                  )),
            ],
          ),
        ),
      ),
    );
  }

  /// 服务端固定回复（余额不足 / 未接通）时提供充值入口。
  bool _needsTopUp(ChatMsg msg) {
    if (!msg.fromElf) return false;
    final reason = msg.fixedReason;
    return reason == 'insufficient_balance' || reason == 'no_api_key';
  }

  void _openApiKey() {
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => const ApiKeyPage()),
    );
  }

  /// 等待 AI 回复时的占位气泡，沿用 AI 左侧样式。
  Widget _typingBubble() {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Align(
        alignment: Alignment.centerLeft,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(
            color: AppColors.surfaceAlt,
            borderRadius: const BorderRadius.all(Radius.circular(18)),
          ),
          child: Text(
            '正在输入…',
            style: TextStyle(
              fontSize: 13.5,
              color: AppColors.textMuted,
              fontStyle: FontStyle.italic,
            ),
          ),
        ),
      ),
    );
  }

  /// 括号里的动作描述弱化成灰色斜体，保留原有阅读层次。
  List<TextSpan> _spans(String text) {
    final lines = text.split('\n');
    return [
      for (var i = 0; i < lines.length; i++) ...[
        if (i > 0) const TextSpan(text: '\n'),
        TextSpan(
          text: lines[i],
          style: lines[i].trimLeft().startsWith('（')
              ? TextStyle(
                  color: AppColors.textMuted,
                  fontStyle: FontStyle.italic,
                  fontSize: 13.5,
                )
              : null,
        ),
      ],
    ];
  }

  // —— 底部：数据行 + 输入条 ——

  Widget _bottomBar(Elf elf) {
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 4, 12, 10),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            _statsRow(elf),
            const SizedBox(height: 8),
            _inputBar(elf),
          ],
        ),
      ),
    );
  }

  Widget _statsRow(Elf elf) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: Row(
        children: [
          _metric(Icons.favorite_border, _fmt(elf.followers)),
          const SizedBox(width: 16),
          _metric(Icons.chat_bubble_outline, _fmt(elf.echo)),
          const SizedBox(width: 16),
          _metric(Icons.star_border, _fmt(elf.works)),
          const Spacer(),
          _metric(Icons.ios_share, '分享', onTap: () => _share(elf)),
          const SizedBox(width: 14),
          _metric(Icons.schedule, '历史'),
        ],
      ),
    );
  }

  Widget _metric(IconData icon, String label, {VoidCallback? onTap}) {
    final row = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 15, color: AppColors.textMuted),
        const SizedBox(width: 4),
        Text(
          label,
          style: TextStyle(fontSize: 11.5, color: AppColors.textMuted),
        ),
      ],
    );
    if (onTap == null) return row;
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: row,
    );
  }

  Widget _inputBar(Elf elf) {
    final hasText = _input.text.trim().isNotEmpty;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Expanded(
          child: Container(
            padding: const EdgeInsets.fromLTRB(6, 4, 8, 4),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(24),
              border: Border.all(color: AppColors.stroke),
            ),
            child: Row(
              children: [
                _barIcon(
                  icon: Icons.add,
                  semantic: '更多操作',
                  onTap: () => _openActions(elf),
                ),
                Expanded(
                  child: TextField(
                    controller: _input,
                    textInputAction: TextInputAction.send,
                    onSubmitted: (_) => _send(),
                    style: TextStyle(fontSize: 14, color: AppColors.text),
                    cursorColor: AppColors.brand,
                    decoration: InputDecoration(
                      isDense: true,
                      hintText: '发消息…',
                      hintStyle: TextStyle(
                        fontSize: 14,
                        color: AppColors.textFaint,
                      ),
                      border: InputBorder.none,
                      contentPadding: const EdgeInsets.symmetric(
                          horizontal: 6, vertical: 10),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
        if (hasText) ...[
          const SizedBox(width: 8),
          GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: _sending ? null : _send,
            child: Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: _sending
                    ? AppColors.brand.withValues(alpha: 0.45)
                    : AppColors.brand,
                shape: BoxShape.circle,
              ),
              child: Icon(
                Icons.arrow_upward_rounded,
                size: 20,
                color: AppColors.onBrand,
                semanticLabel: '发送',
              ),
            ),
          ),
        ],
      ],
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
          size: 20,
          color: AppColors.textMuted,
          semanticLabel: semantic,
        ),
      ),
    );
  }

  /// 输入条左侧「+」：分享卡片 / 查看 AI 主页 / 历史对话。
  void _openActions(Elf elf) {
    showModalBottomSheet<void>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.ios_share),
              title: const Text('分享 AI 卡片'),
              onTap: () {
                Navigator.of(ctx).pop();
                _share(elf);
              },
            ),
            ListTile(
                leading: const Icon(Icons.flag_outlined),
                title: const Text('举报与屏蔽'),
                onTap: () {
                  Navigator.of(ctx).pop();
                  ContentSafety.show(context,
                      targetKind: 'elf',
                      targetId: elf.id,
                      elfId: elf.id,
                      ownerId: elf.ownerId);
                }),
            if (elf.isMine)
              ListTile(
                leading: const Icon(Icons.tune_rounded),
                title: const Text('进入 AI 控制台'),
                onTap: () {
                  Navigator.of(ctx).pop();
                  _openProfile(elf);
                },
              ),
            ListTile(
              leading: const Icon(Icons.schedule),
              title: const Text('历史对话'),
              onTap: () {
                Navigator.of(ctx).pop();
                _toast('暂无法查看历史消息');
              },
            ),
          ],
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
