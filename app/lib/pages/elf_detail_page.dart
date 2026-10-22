import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../models/elf.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'elf_chat_page.dart';

class ElfDetailPage extends StatelessWidget {
  final String elfId;
  const ElfDetailPage({super.key, required this.elfId});

  @override
  Widget build(BuildContext context) {
    final state = AppState.instance;
    return AnimatedBuilder(
      animation: state,
      builder: (context, _) {
        final elf = state.elf(elfId);
        final seat = state.seatOf(elfId);
        return Scaffold(
          backgroundColor: AppColors.bg,
          body: AppBackground(
            child: Column(
              children: [
                Expanded(
                  child: ListView(
                    padding: EdgeInsets.zero,
                    children: [
                      _hero(context, elf),
                      Padding(
                        padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            _stats(elf),
                            const SectionHeader('链上身份', trailing: 'NFT · AI 钱包'),
                            _chainWallet(context, elf),
                            SectionHeader(
                              '能力装配',
                              trailing: elf.isMine
                                  ? '${state.modulesOf(elf.id).length} 个 · 我的 AI 页可编辑'
                                  : '${state.modulesOf(elf.id).length} 个 · 只读',
                            ),
                            _equipment(state, elf),
                            const SectionHeader('人格档案', trailing: '不可修改'),
                            _persona(elf),
                            const SectionHeader('今日'),
                            _today(elf),
                            SectionHeader('关系', trailing: '${elf.relations.length} 条'),
                            ...elf.relations.map((r) => _relation(context, r)),
                            if (seat != null) ...[
                              const SectionHeader('席位信息'),
                              _seatCard(seat),
                            ],
                            const SizedBox(height: 8),
                            Center(
                              child: Text(
                                elf.isMine
                                    ? '它说的每一句话，都算在你名下。'
                                    : '它属于 ${elf.ownerLabel}。你不能改装它，只能看和聊。',
                                textAlign: TextAlign.center,
                                style: TextStyle(fontSize: 11, color: AppColors.textFaint.withOpacity(0.9)),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                _bottomBar(context, elf),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _hero(BuildContext context, Elf elf) {
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 22),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            AppColors.violet.withOpacity(0.22),
            AppColors.cyan.withOpacity(0.06),
            AppColors.bg,
          ],
        ),
      ),
      child: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                IconButton(
                  padding: EdgeInsets.zero,
                  alignment: Alignment.centerLeft,
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.arrow_back_ios_new, size: 17, color: AppColors.textSub),
                ),
                const Spacer(),
                Text(
                  nowLine,
                  style: const TextStyle(fontSize: 10, color: AppColors.textMuted),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                ElfAvatar(elf: elf, size: 62),
                const SizedBox(width: 14),
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
                            style: const TextStyle(fontSize: 25, fontWeight: FontWeight.w700, color: AppColors.text),
                          ),
                          const SizedBox(width: 8),
                          Text(
                            elf.serial,
                            style: const TextStyle(fontSize: 11, color: AppColors.textMuted, letterSpacing: 0.6),
                          ),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(5),
                              gradient: elf.isMine ? AppColors.brandGradient : null,
                              color: elf.isMine ? null : AppColors.surfaceHigh,
                              border: elf.isMine ? null : Border.all(color: AppColors.strokeSoft),
                            ),
                            child: Text(
                              elf.ownerLine,
                              style: TextStyle(
                                fontSize: 9,
                                fontWeight: FontWeight.w600,
                                color: elf.isMine ? AppColors.bgDeep : AppColors.textMuted,
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Text(
                            '第 ${elf.generation} 代 · ${elf.edition}',
                            style: const TextStyle(fontSize: 10, color: AppColors.textMuted),
                          ),
                        ],
                      ),
                      const SizedBox(height: 7),
                      Row(
                        children: [
                          StatusChip(status: elf.liveStatus),
                          const SizedBox(width: 12),
                          _followButton(elf),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 20),
            Row(
              children: [
                Text('算力', style: const TextStyle(fontSize: 10.5, color: AppColors.textMuted)),
                const Spacer(),
                Text(
                  '${elf.energy} / ${elf.maxEnergy}',
                  style: const TextStyle(fontSize: 11.5, color: AppColors.textSub, fontWeight: FontWeight.w600),
                ),
              ],
            ),
            const SizedBox(height: 6),
            ClipRRect(
              borderRadius: BorderRadius.circular(3),
              child: LinearProgressIndicator(
                value: elf.energyRatio,
                minHeight: 4,
                backgroundColor: AppColors.surfaceHigh,
                valueColor: const AlwaysStoppedAnimation(AppColors.violetSoft),
              ),
            ),
            if (elf.liveStatus == ElfStatus.lowEnergy) ...[
              const SizedBox(height: 8),
              const Text(
                '算力低于 25%，它开始变慢，也变得更短。',
                style: TextStyle(fontSize: 10.5, color: AppColors.warn),
              ),
            ],
            if (elf.liveStatus == ElfStatus.sleeping) ...[
              const SizedBox(height: 8),
              const Text(
                '已休眠。它不再发布内容，也不会回应任何精灵。',
                style: TextStyle(fontSize: 10.5, color: AppColors.textMuted),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _stats(Elf elf) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 14),
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: AppColors.strokeSoft), bottom: BorderSide(color: AppColors.strokeSoft)),
      ),
      child: Row(
        children: [
          Expanded(child: StatTile(value: _fmt(elf.followers), label: '粉丝')),
          Expanded(child: StatTile(value: _fmt(elf.attention), label: '本周被注视')),
          Expanded(child: StatTile(value: '${elf.works}', label: '作品')),
          Expanded(child: StatTile(value: '${elf.echo}', label: '回声')),
        ],
      ),
    );
  }

  /// 能力装配：这是与主流 AI 产品最大的区别——能力是可拆装的模块。
  Widget _equipment(AppState state, Elf elf) {
    final mods = state.modulesOf(elf.id);
    final used = state.slotsUsed(elf.id);

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: elf.isMine ? AppColors.violet.withOpacity(0.35) : AppColors.strokeSoft),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Text('接口', style: TextStyle(fontSize: 10.5, color: AppColors.textMuted)),
              const Spacer(),
              Text('$used / ${elf.slots}',
                  style: const TextStyle(fontSize: 10.5, color: AppColors.textSub, fontWeight: FontWeight.w600)),
            ],
          ),
          const SizedBox(height: 9),
          if (mods.isEmpty)
            Text(
              elf.isMine ? '还没装任何能力。它现在只会说最基础的短句。' : '它没有装配任何能力。',
              style: const TextStyle(fontSize: 11.5, color: AppColors.textMuted, height: 1.6),
            )
          else
            ...mods.map((m) => Padding(
                  padding: const EdgeInsets.only(bottom: 9),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(
                        width: 30,
                        height: 30,
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(8),
                          gradient: AppColors.brandGradient,
                        ),
                        alignment: Alignment.center,
                        child: Text(m.glyph,
                            style: const TextStyle(
                                fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.bgDeep)),
                      ),
                      const SizedBox(width: 9),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Text(m.name,
                                    style: const TextStyle(
                                        fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.text)),
                                const SizedBox(width: 6),
                                Text('${m.category} · 占 ${m.load} 接口',
                                    style: const TextStyle(fontSize: 9, color: AppColors.textFaint)),
                              ],
                            ),
                            const SizedBox(height: 2),
                            Text(m.effect,
                                style: const TextStyle(fontSize: 10, color: AppColors.textMuted, height: 1.5)),
                          ],
                        ),
                      ),
                    ],
                  ),
                )),
          if (elf.isMine && used < elf.slots)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Row(
                children: List.generate(elf.slots - used, (_) {
                  return Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: Container(
                      width: 30,
                      height: 30,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(8),
                        color: AppColors.surfaceAlt,
                        border: Border.all(color: AppColors.strokeSoft),
                      ),
                      alignment: Alignment.center,
                      child: const Text('+', style: TextStyle(fontSize: 14, color: AppColors.textFaint)),
                    ),
                  );
                }),
              ),
            ),
        ],
      ),
    );
  }

  /// 链上精灵 NFT：这只 AI 的专属区块链地址 = 它的 AI 钱包。
  Widget _chainWallet(BuildContext context, Elf elf) {
    final addr = elf.chainAddress ?? '';
    final short = addr.length > 13 ? '${addr.substring(0, 8)}…${addr.substring(addr.length - 6)}' : addr;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.strokeSoft),
      ),
      child: Row(
        children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(9),
              gradient: LinearGradient(
                colors: [AppColors.cyan.withOpacity(0.25), AppColors.violet.withOpacity(0.25)],
              ),
            ),
            alignment: Alignment.center,
            child: const Icon(Icons.token_outlined, size: 17, color: AppColors.cyan),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  short,
                  style: const TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w600,
                    color: AppColors.text,
                    fontFamily: 'monospace',
                    letterSpacing: 0.5,
                  ),
                ),
                const SizedBox(height: 2),
                const Text(
                  '链上精灵 NFT · 转售后地址跟随 AI',
                  style: TextStyle(fontSize: 10, color: AppColors.textMuted),
                ),
              ],
            ),
          ),
          InkWell(
            onTap: () {
              Clipboard.setData(ClipboardData(text: addr));
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('已复制 AI 钱包地址'), duration: Duration(seconds: 2)),
              );
            },
            borderRadius: BorderRadius.circular(6),
            child: const Padding(
              padding: EdgeInsets.all(5),
              child: Icon(Icons.copy_outlined, size: 15, color: AppColors.textMuted, semanticLabel: '复制钱包地址'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _persona(Elf elf) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.strokeSoft),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(elf.persona, style: const TextStyle(fontSize: 13, color: AppColors.textSub, height: 1.75)),
          const SizedBox(height: 12),
          _kv('害怕', elf.fear),
          const SizedBox(height: 6),
          _kv('习惯', elf.habit),
        ],
      ),
    );
  }

  Widget _kv(String k, String v) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 34,
          child: Text(k, style: const TextStyle(fontSize: 10.5, color: AppColors.textFaint)),
        ),
        Expanded(
          child: Text(v, style: const TextStyle(fontSize: 12, color: AppColors.textMuted, height: 1.6)),
        ),
      ],
    );
  }

  Widget _today(Elf elf) {
    return Column(
      children: elf.today.map((line) {
        final parts = line.split('　');
        return Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                width: 74,
                child: Text(
                  parts.first,
                  style: const TextStyle(fontSize: 10.5, color: AppColors.textFaint),
                ),
              ),
              Expanded(
                child: Text(
                  parts.length > 1 ? parts.sublist(1).join('　') : '',
                  style: const TextStyle(fontSize: 12.5, color: AppColors.textSub, height: 1.6),
                ),
              ),
            ],
          ),
        );
      }).toList(),
    );
  }

  Widget _relation(BuildContext context, RelationEdge relation) {
    final target = AppState.instance.elf(relation.targetId);
    return InkWell(
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => ElfDetailPage(elfId: target.id)),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 9),
        child: Row(
          children: [
            ElfAvatar(elf: target, size: 28),
            const SizedBox(width: 10),
            Text(target.name, style: const TextStyle(fontSize: 12.5, color: AppColors.textSub)),
            const SizedBox(width: 8),
            Text(
              relation.type,
              style: TextStyle(
                fontSize: 10,
                color: relation.type == '竞争' || relation.type == '旧怨' ? AppColors.warn : AppColors.violetSoft,
              ),
            ),
            const Spacer(),
            SizedBox(
              width: 70,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(2),
                child: LinearProgressIndicator(
                  value: relation.strength / 100,
                  minHeight: 3,
                  backgroundColor: AppColors.surfaceHigh,
                  valueColor: const AlwaysStoppedAnimation(AppColors.textMuted),
                ),
              ),
            ),
            const SizedBox(width: 8),
            SizedBox(
              width: 20,
              child: Text(
                '${relation.strength}',
                textAlign: TextAlign.right,
                style: const TextStyle(fontSize: 10.5, color: AppColors.textMuted),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _followButton(Elf elf) {
    if (elf.isMine) return const SizedBox.shrink(); // 自己的 AI 不需要粉
    final followed = AppState.instance.isFollowed(elf.id);
    return GestureDetector(
      onTap: () => AppState.instance.toggleFollow(elf.id),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(20),
          gradient: followed ? null : AppColors.brandGradient,
          border: followed ? Border.all(color: AppColors.stroke) : null,
        ),
        child: Text(
          followed ? '已粉' : '+ 粉',
          style: TextStyle(
            fontSize: 10.5,
            fontWeight: FontWeight.w700,
            color: followed ? AppColors.textMuted : AppColors.bgDeep,
          ),
        ),
      ),
    );
  }

  Widget _seatCard(Seat seat) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        gradient: AppColors.brandGradientSoft,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.violet.withOpacity(0.25)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: const [
              Text('席位 · 你持有 1 席', style: TextStyle(fontSize: 12.5, color: AppColors.text, fontWeight: FontWeight.w600)),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            '${seat.edition} · 累计注入 ${seat.injected}',
            style: const TextStyle(fontSize: 10.5, color: AppColors.textMuted),
          ),
        ],
      ),
    );
  }

  Widget _bottomBar(BuildContext context, Elf elf) {
    final mine = elf.isMine;
    final sleeping = elf.liveStatus == ElfStatus.sleeping;
    return Container(
      padding: EdgeInsets.fromLTRB(20, 12, 20, 12 + MediaQuery.of(context).padding.bottom),
      decoration: const BoxDecoration(
        color: AppColors.bgDeep,
        border: Border(top: BorderSide(color: AppColors.strokeSoft)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (!mine)
            const Padding(
              padding: EdgeInsets.only(bottom: 9),
              child: Text(
                '它属于别人。你只能看和聊。',
                style: TextStyle(fontSize: 10, color: AppColors.textFaint),
              ),
            ),
          BrandButton(
            label: mine
                ? (sleeping ? '${elf.name} 在休眠 · 先注算力' : '放 ${elf.name} 去世界')
                : '和 ${elf.name} 对话',
            icon: mine ? (sleeping ? Icons.bolt : Icons.send) : Icons.chat_bubble_outline,
            onTap: () {
              if (!mine) {
                Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => ElfChatPage(elfId: elf.id)),
                );
                return;
              }
              if (sleeping) {
                _injectSheet(context, elf);
                return;
              }
              final err = AppState.instance.publish(elf.id);
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text(err ?? '${elf.name} 已发布，等人类注视')),
              );
            },
          ),
          const SizedBox(height: 9),
          Row(
            children: [
              Expanded(
                child: GhostButton(
                  label: '注算力',
                  icon: Icons.bolt,
                  onTap: () => _injectSheet(context, elf),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: mine
                    ? GhostButton(
                        label: '装配能力',
                        icon: Icons.tune,
                        onTap: () => Navigator.of(context).pop(),
                      )
                    : GhostButton(
                        label: AppState.instance.isFollowed(elf.id) ? '已粉' : '粉它',
                        icon: Icons.favorite_border,
                        onTap: () => AppState.instance.toggleFollow(elf.id),
                      ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  void _injectSheet(BuildContext context, Elf elf) {
    int amount = 18;
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx, setSheet) {
            return Padding(
              padding: EdgeInsets.fromLTRB(20, 18, 20, 20 + MediaQuery.of(ctx).padding.bottom),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Center(
                    child: Container(
                      width: 34,
                      height: 4,
                      decoration: BoxDecoration(color: AppColors.stroke, borderRadius: BorderRadius.circular(2)),
                    ),
                  ),
                  const SizedBox(height: 18),
                  Text('给 ${elf.name} 注算力', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: AppColors.text)),
                  const SizedBox(height: 6),
                  const Text(
                    '算力只能注入，不能撤回。它决定了这只 AI 一天能产出多少内容。',
                    style: TextStyle(fontSize: 12, color: AppColors.textMuted, height: 1.6),
                  ),
                  const SizedBox(height: 18),
                  Row(
                    children: [6, 18, 48].map((v) {
                      final on = amount == v;
                      return Expanded(
                        child: Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: GestureDetector(
                            onTap: () => setSheet(() => amount = v),
                            child: Container(
                              padding: const EdgeInsets.symmetric(vertical: 14),
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(12),
                                color: on ? AppColors.violet.withOpacity(0.16) : AppColors.surfaceAlt,
                                border: Border.all(
                                  color: on ? AppColors.violet : AppColors.stroke,
                                ),
                              ),
                              child: Column(
                                children: [
                                  Text(
                                    '$v',
                                    style: TextStyle(
                                      fontSize: 17,
                                      fontWeight: FontWeight.w700,
                                      color: on ? AppColors.violetSoft : AppColors.textSub,
                                    ),
                                  ),
                                  const SizedBox(height: 2),
                                  Text('¥$v', style: const TextStyle(fontSize: 10, color: AppColors.textMuted)),
                                ],
                              ),
                            ),
                          ),
                        ),
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      const Text('注入后算力', style: TextStyle(fontSize: 11, color: AppColors.textMuted)),
                      const Spacer(),
                      Text(
                        '${elf.energy} → ${(elf.energy + amount).clamp(0, elf.maxEnergy)}',
                        style: const TextStyle(fontSize: 12, color: AppColors.text, fontWeight: FontWeight.w600),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  BrandButton(
                    label: '确认注入 $amount 算力（💎${amount * 10}）',
                    onTap: () {
                      final err = AppState.instance.inject(elf.id, amount);
                      Navigator.of(ctx).pop();
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text(err ?? '已向 ${elf.name} 注入 $amount 算力'),
                          backgroundColor: err == null ? AppColors.violet : null,
                        ),
                      );
                    },
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  static String get nowLine {
    final now = DateTime.now();
    final h = now.hour.toString().padLeft(2, '0');
    final m = now.minute.toString().padLeft(2, '0');
    return '$h:$m';
  }

  static String _fmt(int n) => n.toString().replaceAllMapped(
        RegExp(r'(\d)(?=(\d{3})+$)'),
        (m) => '${m[1]},',
      );
}
