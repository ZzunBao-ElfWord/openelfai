import 'package:flutter/material.dart';
import '../models/elf.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';

/// 手动创作弹层：人类指挥 AI 选能力 + 填主题 → 产出发布。
class CreatePostSheet extends StatefulWidget {
  final Elf elf;
  const CreatePostSheet({super.key, required this.elf});

  @override
  State<CreatePostSheet> createState() => _CreatePostSheetState();
}

class _CreatePostSheetState extends State<CreatePostSheet> {
  String? _selectedModuleId;
  final _topicCtrl = TextEditingController();

  static const _trackLabels = {
    'writing': '写作',
    'visual': '视觉',
    'video': '视频',
    'audio': '语音',
    'research': '知识',
    'memory': '记忆',
    'social': '社交',
    'system': '系统',
  };

  @override
  void dispose() {
    _topicCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = AppState.instance;
    // 已装的非 auto 能力（auto 是自动运营中枢，不走手动创作）
    final installed = state
        .modulesOf(widget.elf.id)
        .where((m) => m.id != 'auto')
        .toList();
    final all = state.modules.where((m) => m.id != 'auto').toList();

    return Container(
      decoration: const BoxDecoration(
        color: AppColors.bgDeep,
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      child: SafeArea(
        child: Padding(
          padding: EdgeInsets.only(
            bottom: MediaQuery.of(context).viewInsets.bottom,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _header(),
              const Divider(height: 1, color: AppColors.strokeSoft),
              ConstrainedBox(
                constraints: BoxConstraints(
                  maxHeight: MediaQuery.of(context).size.height * 0.42,
                ),
                child: installed.isEmpty
                    ? _emptyInstall()
                    : ListView(
                        padding: const EdgeInsets.symmetric(vertical: 6),
                        children: _groupedTracks(state, installed, all),
                      ),
              ),
              if (installed.isNotEmpty) ...[
                const SizedBox(height: 4),
                _topicInput(),
                _bottomBar(state, installed),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _header() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 8, 6),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '让 ${widget.elf.name} 创作',
                  style: const TextStyle(
                    fontSize: 16, fontWeight: FontWeight.w700, color: AppColors.text,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '选一个它已装的能力，给个方向',
                  style: TextStyle(fontSize: 10.5, color: AppColors.textMuted),
                ),
              ],
            ),
          ),
          IconButton(
            icon: const Icon(Icons.close, size: 18, color: AppColors.textMuted),
            onPressed: () => Navigator.of(context).pop(),
          ),
        ],
      ),
    );
  }

  List<Widget> _groupedTracks(
    AppState state,
    List<AbilityModule> installed,
    List<AbilityModule> all,
  ) {
    final byTrack = <String, List<AbilityModule>>{};
    for (final m in installed) {
      (byTrack[m.track] ??= []).add(m);
    }
    final list = <Widget>[];
    for (final track in byTrack.keys) {
      list.add(Padding(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 4),
        child: Text(
          _trackLabels[track] ?? track,
          style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: AppColors.textSub),
        ),
      ));
      list.addAll(byTrack[track]!.map((m) => _moduleTile(m)));
    }
    // 未装的灰色展示
    final installedIds = installed.map((m) => m.id).toSet();
    final notInstalled = all.where((m) => !installedIds.contains(m.id)).toList();
    if (notInstalled.isNotEmpty) {
      list.add(const SizedBox(height: 8));
      list.add(Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Text(
          '未装（去「我的 AI」装配）',
          style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: AppColors.textFaint),
        ),
      ));
      list.addAll(notInstalled.map((m) => _moduleTile(m, installed: false)));
    }
    return list;
  }

  Widget _moduleTile(AbilityModule m, {bool installed = true}) {
    final selected = _selectedModuleId == m.id;
    return InkWell(
      onTap: installed ? () => setState(() => _selectedModuleId = m.id) : null,
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: selected
                ? AppColors.cyan
                : AppColors.strokeSoft,
          ),
          color: !installed ? AppColors.surface.withOpacity(0.4) : null,
        ),
        child: Row(
          children: [
            Container(
              width: 32,
              height: 32,
              decoration: BoxDecoration(
                gradient: selected
                    ? AppColors.brandGradient
                    : LinearGradient(
                        colors: [AppColors.violet.withOpacity(0.3), AppColors.cyan.withOpacity(0.15)],
                      ),
                borderRadius: BorderRadius.circular(8),
              ),
              alignment: Alignment.center,
              child: Text(
                m.glyph,
                style: TextStyle(
                  fontSize: 15, fontWeight: FontWeight.w700,
                  color: selected ? AppColors.bgDeep : AppColors.violetSoft,
                ),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    installed ? m.name : '${m.name} · 未装',
                    style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w600,
                      color: installed ? AppColors.text : AppColors.textFaint,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '算力 ${m.compute} · ${m.summary}',
                    style: const TextStyle(fontSize: 10.5, color: AppColors.textMuted),
                  ),
                ],
              ),
            ),
            if (selected)
              const Icon(Icons.check_circle, size: 18, color: AppColors.cyan),
          ],
        ),
      ),
    );
  }

  Widget _emptyInstall() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.backpack_outlined, size: 40, color: AppColors.textFaint),
            const SizedBox(height: 12),
            const Text(
              '先给它装一个能力包，再指挥它创作',
              style: TextStyle(fontSize: 12, color: AppColors.textMuted),
            ),
            const SizedBox(height: 16),
            BrandButton(
              label: '去装配能力',
              icon: Icons.tune,
              // 装配区已内嵌在「我的 AI」页，关掉弹层即可看到
              onTap: () => Navigator.of(context).pop(),
            ),
          ],
        ),
      ),
    );
  }

  Widget _topicInput() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      child: TextField(
        controller: _topicCtrl,
        style: const TextStyle(fontSize: 12.5, color: AppColors.text),
        decoration: InputDecoration(
          hintText: '给个方向（可选，空着也行）',
          hintStyle: const TextStyle(fontSize: 11.5, color: AppColors.textFaint),
          filled: true,
          fillColor: AppColors.surface,
          contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(10),
            borderSide: BorderSide.none,
          ),
        ),
      ),
    );
  }

  Widget _bottomBar(AppState state, List<AbilityModule> installed) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
      child: Row(
        children: [
          Expanded(
            child: Text(
              _selectedModuleId == null
                  ? '先选一个能力'
                  : '算力消耗：${state.module(_selectedModuleId!)?.compute ?? 0} · AI 剩余 ${widget.elf.energy}',
              style: const TextStyle(fontSize: 11, color: AppColors.textMuted),
            ),
          ),
          const SizedBox(width: 8),
          BrandButton(
            label: '让它创作',
            icon: Icons.auto_awesome_outlined,
            expand: false,
            onTap: _selectedModuleId == null
                ? null
                : () async {
                    final err = await state.manualPost(
                      elfId: widget.elf.id,
                      moduleId: _selectedModuleId!,
                      topic: _topicCtrl.text.trim(),
                    );
                    if (!context.mounted) return;
                    Navigator.of(context).pop();
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text(err ?? '已发布，去世界看看')),
                    );
                  },
          ),
        ],
      ),
    );
  }
}
