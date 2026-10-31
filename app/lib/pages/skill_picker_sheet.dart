import 'package:flutter/material.dart';

import '../theme.dart';

/// 技能面板里的一项：官方技能或当前 AI 已学会的技能。
class SkillChoice {
  final String id;
  final String name;
  final String glyph;
  final String summary;

  /// 官方技能固定置顶，和用户已学会的技能区分展示。
  final bool official;

  const SkillChoice({
    required this.id,
    required this.name,
    required this.glyph,
    required this.summary,
    this.official = false,
  });
}

/// WorkBuddy 式「技能」面板：搜索 + 技能列表 + 管理技能。
/// 选中后返回 [SkillChoice]，由输入框渲染成技能 chip。
class SkillPickerSheet extends StatefulWidget {
  final List<SkillChoice> skills;
  final VoidCallback? onManage;

  const SkillPickerSheet({super.key, required this.skills, this.onManage});

  @override
  State<SkillPickerSheet> createState() => _SkillPickerSheetState();
}

class _SkillPickerSheetState extends State<SkillPickerSheet> {
  final _searchCtrl = TextEditingController();
  String _query = '';

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  List<SkillChoice> get _filtered {
    final q = _query.trim().toLowerCase();
    if (q.isEmpty) return widget.skills;
    return widget.skills
        .where((s) =>
            s.name.toLowerCase().contains(q) ||
            s.summary.toLowerCase().contains(q))
        .toList();
  }

  @override
  Widget build(BuildContext context) {
    final filtered = _filtered;
    final official = filtered.where((s) => s.official).toList();
    final mine = filtered.where((s) => !s.official).toList();
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(18)),
      ),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            _header(context),
            _searchField(),
            Flexible(
              child: filtered.isEmpty
                  ? _empty()
                  : ListView(
                      padding: const EdgeInsets.fromLTRB(14, 4, 14, 8),
                      shrinkWrap: true,
                      children: [
                        if (official.isNotEmpty) ...[
                          _groupLabel('官方技能'),
                          ...official.map(_tile),
                        ],
                        if (mine.isNotEmpty) ...[
                          _groupLabel('我的技能'),
                          ...mine.map(_tile),
                        ],
                      ],
                    ),
            ),
            _manageBar(context),
          ],
        ),
      ),
    );
  }

  Widget _header(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 8, 6),
      child: Row(
        children: [
          Text(
            '技能',
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w700,
              color: AppColors.text,
            ),
          ),
          const Spacer(),
          IconButton(
            icon: Icon(Icons.close, size: 18, color: AppColors.textMuted),
            onPressed: () => Navigator.of(context).pop(),
          ),
        ],
      ),
    );
  }

  Widget _searchField() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 0, 14, 6),
      child: TextField(
        controller: _searchCtrl,
        onChanged: (v) => setState(() => _query = v),
        style: TextStyle(fontSize: 12.5, color: AppColors.text),
        decoration: InputDecoration(
          isDense: true,
          hintText: '搜索技能',
          hintStyle: TextStyle(fontSize: 11.5, color: AppColors.textFaint),
          prefixIcon:
              Icon(Icons.search, size: 16, color: AppColors.textMuted),
          filled: true,
          fillColor: AppColors.surfaceAlt,
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(10),
            borderSide: BorderSide.none,
          ),
        ),
      ),
    );
  }

  Widget _groupLabel(String text) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 10, 4, 4),
      child: Text(
        text,
        style: TextStyle(
          fontSize: 10.5,
          fontWeight: FontWeight.w600,
          color: AppColors.textFaint,
        ),
      ),
    );
  }

  Widget _tile(SkillChoice skill) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: InkWell(
        onTap: () => Navigator.of(context).pop(skill),
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            color: AppColors.surfaceAlt,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Row(
            children: [
              Container(
                width: 34,
                height: 34,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  gradient: skill.official ? AppColors.brandGradient : null,
                  color: skill.official ? null : AppColors.surface,
                  borderRadius: BorderRadius.circular(9),
                ),
                child: Text(
                  skill.glyph,
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: skill.official ? AppColors.onBrand : AppColors.cyan,
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(
                          child: Text(
                            skill.name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                              color: AppColors.text,
                            ),
                          ),
                        ),
                        if (skill.official) ...[
                          const SizedBox(width: 6),
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 5, vertical: 1),
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(4),
                              border: Border.all(color: AppColors.strokeSoft),
                            ),
                            child: Text(
                              '官方',
                              style: TextStyle(
                                  fontSize: 9, color: AppColors.textMuted),
                            ),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      skill.summary,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style:
                          TextStyle(fontSize: 10.5, color: AppColors.textMuted),
                    ),
                  ],
                ),
              ),
              Icon(Icons.chevron_right, size: 16, color: AppColors.textFaint),
            ],
          ),
        ),
      ),
    );
  }

  Widget _empty() {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 28),
      child: Center(
        child: Text(
          '没有匹配的技能',
          style: TextStyle(fontSize: 12, color: AppColors.textMuted),
        ),
      ),
    );
  }

  Widget _manageBar(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 4, 14, 12),
      child: SizedBox(
        width: double.infinity,
        child: OutlinedButton(
          onPressed: () {
            Navigator.of(context).pop();
            widget.onManage?.call();
          },
          style: OutlinedButton.styleFrom(
            foregroundColor: AppColors.textSub,
            side: BorderSide(color: AppColors.stroke),
            padding: const EdgeInsets.symmetric(vertical: 12),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
            ),
          ),
          child: const Text('管理技能', style: TextStyle(fontSize: 13)),
        ),
      ),
    );
  }
}
