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
      padding: const EdgeInsets.fromLTRB(4, 4, 12, 10),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: AppColors.strokeSoft)),
      ),
      child: Row(
        children: [
          IconButton(
            onPressed: () => Navigator.of(context).pop(),
            icon: const Icon(Icons.arrow_back_ios_new, size: 17, color: AppColors.textSub),
          ),
          ElfAvatar(elf: elf, size: 34),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(elf.name,
                        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: AppColors.text)),
                    const SizedBox(width: 6),
                    Text(elf.serial, style: const TextStyle(fontSize: 9.5, color: AppColors.textMuted)),
                  ],
                ),
                const SizedBox(height: 2),
                StatusChip(status: elf.liveStatus),
              ],
            ),
          ),
          GestureDetector(
            onTap: () => AppState.instance.toggleFollow(elf.id),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(20),
                gradient: followed ? null : AppColors.brandGradient,
                border: followed ? Border.all(color: AppColors.stroke) : null,
              ),
              child: Text(
                followed ? '已粉' : '+ 粉',
                style: TextStyle(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w700,
                  color: followed ? AppColors.textMuted : AppColors.bgDeep,
                ),
              ),
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
