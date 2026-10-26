import 'package:flutter/material.dart';

import '../models/elf.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';

/// 我的仓库：人类持有的是「技能书」，学到 AI 身上才叫「技能」。
/// 技能书挂在自己的人类地址下，可教给任意一只自有 AI；
/// 学习即销毁（burn），技能永久写入被选中的那只 AI，随该 AI 流转。
class BookshelfPage extends StatefulWidget {
  const BookshelfPage({super.key});

  @override
  State<BookshelfPage> createState() => _BookshelfPageState();
}

class _BookshelfPageState extends State<BookshelfPage> {
  AppState get _state => AppState.instance;

  @override
  void initState() {
    super.initState();
    _state.addListener(_onStateChanged);
  }

  @override
  void dispose() {
    _state.removeListener(_onStateChanged);
    super.dispose();
  }

  void _onStateChanged() {
    if (mounted) setState(() {});
  }

  void _toast(String text) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(text), duration: const Duration(seconds: 2)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final books = _state.books;
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: AppBackground(
        child: WideContent(
          maxWidth: 760,
          child: ListView(
            padding: EdgeInsets.zero,
            children: [
              _hero(context, books.length),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 14, 16, 28),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _ruleCard(),
                    const SizedBox(height: 18),
                    const SectionHeader('我的技能书', trailing: '人类资产 · 不随 AI 流转'),
                    if (books.isEmpty)
                      _emptyState()
                    else
                      ...books.map(_bookRow),
                    const SizedBox(height: 18),
                    Text(
                      '书买入后只能学给自有的 AI：一旦学习就当场销毁，技能永久属于那只 AI，AI 转赠时技能一并转移；未学的书也不能转售或转赠。',
                      style: TextStyle(
                          fontSize: 10.5,
                          color: AppColors.textFaint,
                          height: 1.55),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _hero(BuildContext context, int count) {
    final addr = _state.currentUser?.chainAddress ?? '';
    final short = addr.length > 13
        ? '${addr.substring(0, 6)}…${addr.substring(addr.length - 4)}'
        : addr;
    return Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppColors.violet.withValues(alpha: 0.26),
            AppColors.bg,
          ],
        ),
      ),
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(8, 2, 16, 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              IconButton(
                padding: EdgeInsets.zero,
                alignment: Alignment.centerLeft,
                onPressed: () => Navigator.of(context).pop(),
                icon: Icon(Icons.arrow_back_ios_new,
                    size: 17, color: AppColors.textSub, semanticLabel: '返回'),
              ),
              const SizedBox(height: 2),
              Padding(
                padding: const EdgeInsets.only(left: 8),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.baseline,
                  textBaseline: TextBaseline.alphabetic,
                  children: [
                    Icon(Icons.menu_book_outlined,
                        size: 24, color: AppColors.violetSoft),
                    const SizedBox(width: 8),
                    Text(
                      '我的仓库',
                      style: TextStyle(
                          fontSize: 24,
                          fontWeight: FontWeight.w700,
                          color: AppColors.text),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      '$count 本',
                      style:
                          TextStyle(fontSize: 13, color: AppColors.textMuted),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 6),
              Padding(
                padding: const EdgeInsets.only(left: 8),
                child: Text(
                  short.isEmpty
                      ? '技能书挂在人类地址下，学到 AI 身上才成为技能'
                      : '技能书挂在你的人类地址 $short 下，可教给任意一只自有 AI',
                  style: TextStyle(fontSize: 11, color: AppColors.textMuted),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _ruleCard() {
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 11, 12, 11),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.strokeSoft),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.info_outline, size: 13, color: AppColors.violetSoft),
              const SizedBox(width: 5),
              Text('书的规则',
                  style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                      color: AppColors.violetSoft)),
            ],
          ),
          const SizedBox(height: 7),
          Text(
            '① 人类持有的是「技能书」，学到 AI 身上才叫「技能」；书是人类的资产，不随 AI 转赠流转。\n'
            '② 技能书只能学给自己的 AI：不支持转售、也不支持转赠，未学的书同样不能二手卖出。\n'
            '③ 学习时自行选择教给哪只自有 AI，学习位够即可，不额外收费。\n'
            '④ 学习即销毁，技能永久绑定那只 AI；每只 AI 对同一技能只能学一次。',
            style: TextStyle(
                fontSize: 10.5, color: AppColors.textMuted, height: 1.7),
          ),
        ],
      ),
    );
  }

  Widget _emptyState() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(16, 26, 16, 26),
      decoration: BoxDecoration(
        color: AppColors.surface.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.strokeSoft),
      ),
      child: Column(
        children: [
          Icon(Icons.auto_stories_outlined,
              size: 28, color: AppColors.textFaint),
          const SizedBox(height: 10),
          Text('仓库还是空的',
              style: TextStyle(fontSize: 12.5, color: AppColors.textSub)),
          const SizedBox(height: 4),
          Text('去「发现」页买入技能书；买入后只能学给自有的 AI，不能转售或转赠。',
              textAlign: TextAlign.center,
              style: TextStyle(
                  fontSize: 10.5, color: AppColors.textMuted, height: 1.6)),
        ],
      ),
    );
  }

  Widget _bookRow(BookInstance book) {
    final m = _state.module(book.moduleId);
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.strokeSoft),
        color: AppColors.surface.withValues(alpha: 0.6),
      ),
      child: Row(
        children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              color: AppColors.violet.withValues(alpha: 0.25),
              borderRadius: BorderRadius.circular(9),
            ),
            alignment: Alignment.center,
            child: Text(
              m?.glyph ?? '书',
              style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                  color: AppColors.violetSoft),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '《${m?.name ?? book.moduleId}》',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w600,
                      color: AppColors.text),
                ),
                const SizedBox(height: 2),
                Text(
                  '编号 ${book.id} · ${m?.seats ?? 1} 学习位',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 9.5, color: AppColors.textFaint),
                ),
              ],
            ),
          ),
          TextButton(
            onPressed: () => _learn(book),
            child: const Text('学习', style: TextStyle(fontSize: 12)),
          ),
        ],
      ),
    );
  }

  Future<void> _learn(BookInstance book) async {
    final mine = _state.myElves;
    if (mine.isEmpty) {
      _toast('还没有 AI，先去创建一只或从市场买入');
      return;
    }
    var target = mine.first;
    if (mine.length > 1) {
      final picked = await _pickLearningTarget(book);
      if (picked == null) return;
      target = picked;
    }
    final err = await _state.learn(book.moduleId, target.id);
    if (!mounted) return;
    final name = _state.module(book.moduleId)?.name ?? book.moduleId;
    _toast(err ?? '${target.name} 学会了《$name》，书已销毁');
  }

  /// 书是人类的资产：学习时在自己持有的多只 AI 之间自由选择。
  Future<Elf?> _pickLearningTarget(BookInstance book) {
    final m = _state.module(book.moduleId);
    final seats = m?.seats ?? 1;
    return showDialog<Elf>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        title: Text(
          '把《${m?.name ?? book.moduleId}》教给哪只 AI？',
          style: TextStyle(fontSize: 16, color: AppColors.text),
        ),
        contentPadding: const EdgeInsets.fromLTRB(8, 4, 8, 8),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 6),
              child: Text(
                '书是你的资产，可教给任意一只自有 AI。学习后书当场销毁，技能永久写入选中的那只 AI。',
                style: TextStyle(
                    fontSize: 11.5, color: AppColors.textMuted, height: 1.55),
              ),
            ),
            ..._state.myElves.map((e) {
              final learned = e.learnedSkills.contains(book.moduleId);
              final left = e.skillCapacity - _state.seatsUsed(e.id);
              final can = !learned && left >= seats;
              final note = learned
                  ? '已学会'
                  : left < seats
                      ? '学习位不足（剩 $left）'
                      : '剩余 $left 个学习位';
              return ListTile(
                enabled: can,
                contentPadding: const EdgeInsets.symmetric(horizontal: 16),
                leading: ElfAvatar(elf: e, size: 30),
                title: Text(
                  e.name,
                  style: TextStyle(
                      fontSize: 13,
                      color: can ? AppColors.text : AppColors.textFaint),
                ),
                subtitle: Text(
                  note,
                  style: TextStyle(fontSize: 10.5, color: AppColors.textMuted),
                ),
                trailing: can
                    ? null
                    : Icon(Icons.block, size: 15, color: AppColors.textFaint),
                onTap: can ? () => Navigator.of(ctx).pop(e) : null,
              );
            }),
          ],
        ),
      ),
    );
  }
}
