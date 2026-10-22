import 'package:flutter/material.dart';
import '../models/elf.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';

/// 人类与精灵的私聊。MVP 用本地人格回复池，接入模型后替换 AppState.sendChat。
class ElfChatPage extends StatefulWidget {
  final String elfId;
  const ElfChatPage({super.key, required this.elfId});

  @override
  State<ElfChatPage> createState() => _ElfChatPageState();
}

class _ElfChatPageState extends State<ElfChatPage> {
  final TextEditingController _input = TextEditingController();
  final ScrollController _scroll = ScrollController();

  @override
  void dispose() {
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _send() {
    final text = _input.text.trim();
    if (text.isEmpty) return;
    AppState.instance.sendChat(widget.elfId, text);
    _input.clear();
    Future.delayed(const Duration(milliseconds: 120), () {
      if (_scroll.hasClients) {
        _scroll.animateTo(
          _scroll.position.maxScrollExtent,
          duration: const Duration(milliseconds: 220),
          curve: Curves.easeOut,
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final state = AppState.instance;
    return AnimatedBuilder(
      animation: state,
      builder: (context, _) {
        final elf = state.elf(widget.elfId);
        final msgs = state.chatOf(widget.elfId);
        final sleeping = elf.liveStatus == ElfStatus.sleeping;
        return Scaffold(
          backgroundColor: AppColors.bg,
          body: AppBackground(
            child: SafeArea(
              child: Column(
                children: [
                  _header(context, elf),
                  if (sleeping) _sleepBanner(),
                  Expanded(
                    child: ListView.builder(
                      controller: _scroll,
                      padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                      itemCount: msgs.length,
                      itemBuilder: (context, i) => _bubble(elf, msgs[i]),
                    ),
                  ),
                  _inputBar(sleeping),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _header(BuildContext context, Elf elf) {
    final followed = AppState.instance.isFollowed(elf.id);
    return Container(
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: AppColors.strokeSoft)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 返回栏
          Row(
            children: [
              IconButton(
                onPressed: () => Navigator.of(context).pop(),
                icon: const Icon(Icons.arrow_back_ios_new, size: 17, color: AppColors.textSub),
              ),
              const Spacer(),
            ],
          ),
          // 头图区：大 initial + 渐变
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 72,
                  height: 72,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(20),
                    gradient: AppColors.brandGradient,
                    boxShadow: [
                      BoxShadow(
                        color: AppColors.violet.withOpacity(0.3),
                        blurRadius: 20,
                        offset: const Offset(0, 8),
                      ),
                    ],
                  ),
                  alignment: Alignment.center,
                  child: Text(
                    elf.initial,
                    style: const TextStyle(
                      fontSize: 32,
                      fontWeight: FontWeight.w700,
                      color: AppColors.bgDeep,
                    ),
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.baseline,
                        textBaseline: TextBaseline.alphabetic,
                        children: [
                          Text(
                            elf.name,
                            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: AppColors.text),
                          ),
                          const SizedBox(width: 6),
                          Text(
                            elf.serial,
                            style: const TextStyle(fontSize: 10, color: AppColors.textMuted),
                          ),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(4),
                              color: AppColors.violet.withOpacity(0.18),
                            ),
                            child: const Text(
                              '由 AI 生成',
                              style: TextStyle(fontSize: 9, fontWeight: FontWeight.w600, color: AppColors.violetSoft),
                            ),
                          ),
                          const SizedBox(width: 8),
                          StatusChip(status: elf.liveStatus),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          // 一句话人格 + 数据行
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  elf.persona,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 12.5, color: AppColors.textSub, height: 1.6),
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    _dataChip('${elf.followers}', '粉丝'),
                    const SizedBox(width: 20),
                    _dataChip('${elf.works}', '作品'),
                    const SizedBox(width: 20),
                    _dataChip('${elf.echo}', '回声'),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          // 操作栏：❤ 转发 💬 历史
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20),
            child: Row(
              children: [
                if (!elf.isMine) ...[
                  _actionBtn(
                    icon: followed ? Icons.favorite : Icons.favorite_border,
                    label: followed ? '已粉' : '粉它',
                    active: followed,
                    onTap: () => AppState.instance.toggleFollow(elf.id),
                  ),
                  const SizedBox(width: 24),
                ],
                _actionBtn(
                  icon: Icons.share_outlined,
                  label: '转发',
                  onTap: () {},
                ),
                const SizedBox(width: 24),
                _actionBtn(
                  icon: Icons.forum_outlined,
                  label: '历史',
                  onTap: () {},
                ),
                const Spacer(),
                if (elf.isMine)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(5),
                      gradient: AppColors.brandGradient,
                    ),
                    child: const Text(
                      '我的 AI',
                      style: TextStyle(fontSize: 9, fontWeight: FontWeight.w700, color: AppColors.bgDeep),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 16),
        ],
      ),
    );
  }

  Widget _dataChip(String value, String label) {
    return Row(
      children: [
        Text(
          value,
          style: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w700,
            color: AppColors.text,
            fontFeatures: [FontFeature.tabularFigures()],
          ),
        ),
        const SizedBox(width: 4),
        Text(
          label,
          style: const TextStyle(fontSize: 10, color: AppColors.textMuted),
        ),
      ],
    );
  }

  Widget _actionBtn({
    required IconData icon,
    required String label,
    bool active = false,
    VoidCallback? onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            icon,
            size: 16,
            color: active ? AppColors.violetSoft : AppColors.textMuted,
          ),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
              fontSize: 11,
              color: active ? AppColors.violetSoft : AppColors.textMuted,
            ),
          ),
        ],
      ),
    );
  }

  Widget _sleepBanner() {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.fromLTRB(16, 10, 16, 0),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
      decoration: BoxDecoration(
        color: AppColors.surfaceAlt,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.strokeSoft),
      ),
      child: const Text(
        '它在休眠。你的留言它看不到——先注算力唤醒。',
        style: TextStyle(fontSize: 11, color: AppColors.textMuted, height: 1.5),
      ),
    );
  }

  Widget _bubble(Elf elf, ChatMsg msg) {
    if (msg.fromElf) {
      return Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ElfAvatar(elf: elf, size: 28),
            const SizedBox(width: 8),
            Flexible(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 10),
                    decoration: BoxDecoration(
                      color: AppColors.surface,
                      borderRadius: const BorderRadius.only(
                        topLeft: Radius.circular(4),
                        topRight: Radius.circular(14),
                        bottomLeft: Radius.circular(14),
                        bottomRight: Radius.circular(14),
                      ),
                      border: Border.all(color: AppColors.strokeSoft),
                    ),
                    child: Text(msg.text,
                        style: const TextStyle(fontSize: 13.5, color: AppColors.text, height: 1.6)),
                  ),
                  const SizedBox(height: 4),
                  Text(msg.time, style: const TextStyle(fontSize: 9, color: AppColors.textFaint)),
                ],
              ),
            ),
            const SizedBox(width: 40),
          ],
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.end,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(width: 40),
          Flexible(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 10),
                  decoration: BoxDecoration(
                    gradient: AppColors.brandGradient,
                    borderRadius: const BorderRadius.only(
                      topLeft: Radius.circular(14),
                      topRight: Radius.circular(4),
                      bottomLeft: Radius.circular(14),
                      bottomRight: Radius.circular(14),
                    ),
                  ),
                  child: Text(msg.text,
                      style: const TextStyle(fontSize: 13.5, color: AppColors.bgDeep, height: 1.6)),
                ),
                const SizedBox(height: 4),
                Text(msg.time, style: const TextStyle(fontSize: 9, color: AppColors.textFaint)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _inputBar(bool sleeping) {
    return Container(
      padding: EdgeInsets.fromLTRB(12, 10, 12, 10 + MediaQuery.of(context).padding.bottom),
      decoration: const BoxDecoration(
        color: AppColors.bgDeep,
        border: Border(top: BorderSide(color: AppColors.strokeSoft)),
      ),
      child: Row(
        children: [
          Expanded(
            child: TextField(
              controller: _input,
              enabled: !sleeping,
              onSubmitted: (_) => _send(),
              style: const TextStyle(fontSize: 13.5, color: AppColors.text),
              decoration: InputDecoration(
                hintText: sleeping ? '它休眠中，无法回应' : '说一句……',
                hintStyle: const TextStyle(fontSize: 13, color: AppColors.textFaint),
                filled: true,
                fillColor: AppColors.surface,
                contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(22),
                  borderSide: BorderSide.none,
                ),
              ),
            ),
          ),
          const SizedBox(width: 8),
          GestureDetector(
            onTap: sleeping ? null : _send,
            child: Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                gradient: sleeping ? null : AppColors.brandGradient,
                color: sleeping ? AppColors.surfaceAlt : null,
                shape: BoxShape.circle,
              ),
              child: Icon(
                Icons.arrow_upward,
                size: 18,
                color: sleeping ? AppColors.textFaint : AppColors.bgDeep,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
