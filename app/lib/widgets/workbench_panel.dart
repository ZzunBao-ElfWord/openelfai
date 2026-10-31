import 'package:flutter/material.dart';

import '../compliance/ai_creation_policy.dart';
import '../models/elf.dart';
import '../pages/character_studio_page.dart';
import '../pages/create_elf_page.dart';
import '../pages/create_post_sheet.dart';
import '../pages/login_page.dart';
import '../pages/market_page.dart';
import '../pages/skill_picker_sheet.dart';
import '../services/app_content_service.dart';
import '../state/app_state.dart';
import '../theme.dart';
import 'common.dart';

/// 首页工作台（WorkBuddy 框架）：
/// 大标题 + 模式胶囊 + 药丸输入框 + 快捷任务。
/// 输入框的行为是「人类手动指挥 AI 创作」：选中一只自有 AI，
/// 填一句主题，直接打开手动创作弹层。
class WorkbenchPanel extends StatefulWidget {
  /// 宽屏（桌面 / Web >900）使用大尺寸排版，窄屏收成紧凑版。
  final bool wide;

  const WorkbenchPanel({super.key, this.wide = false});

  /// 「形象工坊」在技能清单里的固定 id：官方技能，置顶展示。
  static const String studioSkillId = 'studio';

  /// 技能清单：官方形象工坊置顶 + 当前 AI 已学会的技能（自动运营不进清单）。
  static List<SkillChoice> skillChoices() {
    final state = AppState.instance;
    final elf = state.myElf;
    final installed = elf == null
        ? const <AbilityModule>[]
        : state
            .modulesOf(elf.id)
            .where((m) => m.id != 'auto')
            .toList();
    return <SkillChoice>[
      const SkillChoice(
        id: studioSkillId,
        name: '形象工坊',
        glyph: '形',
        summary: '一句话描述，免费预览后生成正式形象',
        official: true,
      ),
      for (final m in installed)
        SkillChoice(id: m.id, name: m.name, glyph: m.glyph, summary: m.summary),
    ];
  }

  /// 弹出技能面板，返回选中的技能；「管理技能」进技能市场。
  static Future<SkillChoice?> pickSkill(BuildContext context) {
    return showModalBottomSheet<SkillChoice>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(context).height * 0.78,
        ),
        child: SkillPickerSheet(
          skills: skillChoices(),
          onManage: () {
            Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const MarketPage()),
            );
          },
        ),
      ),
    );
  }

  /// 形象工坊生成前必须逐条确认的合规声明（运营可配置，缺省用内置三条）。
  static Future<bool> confirmStudioPolicy(BuildContext context) async {
    final configured =
        AppContentService.instance.content.value.list('app.create.declarations');
    final items = configured.isEmpty
        ? AiCreationPolicy.declarations
        : configured;
    final accepted = List<bool>.filled(items.length, false);
    final ok = await showDialog<bool>(
      context: context,
      builder: (dctx) => StatefulBuilder(
        builder: (context, setLocal) {
          final done = accepted.every((v) => v);
          return AlertDialog(
            backgroundColor: AppColors.surface,
            title: Text('形象工坊 · 生成须知',
                style: TextStyle(fontSize: 15, color: AppColors.text)),
            content: SizedBox(
              width: double.maxFinite,
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    for (var i = 0; i < items.length; i++)
                      CheckboxListTile(
                        value: accepted[i],
                        onChanged: (v) => setLocal(() => accepted[i] = v ?? false),
                        contentPadding: EdgeInsets.zero,
                        controlAffinity: ListTileControlAffinity.leading,
                        dense: true,
                        title: Text(
                          items[i],
                          style: TextStyle(
                            fontSize: 11,
                            height: 1.5,
                            color: AppColors.textSub,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(dctx).pop(false),
                child:
                    Text('取消', style: TextStyle(color: AppColors.textMuted)),
              ),
              TextButton(
                onPressed: done ? () => Navigator.of(dctx).pop(true) : null,
                child: Text('同意并继续',
                    style: TextStyle(color: AppColors.cyan)),
              ),
            ],
          );
        },
      ),
    );
    return ok == true;
  }

  @override
  State<WorkbenchPanel> createState() => _WorkbenchPanelState();
}

class _WorkbenchPanelState extends State<WorkbenchPanel> {
  final _input = TextEditingController();
  final _focus = FocusNode();
  int _mode = 0;

  /// 已选技能：`studio` = 形象工坊，其余为 AI 已学会的能力模块 id。
  SkillChoice? _skill;

  static const _modes = [
    (Icons.edit_outlined, '创作'),
    (Icons.auto_mode_outlined, '运营'),
    (Icons.forum_outlined, '互动'),
  ];

  static const _quickTracks = [
    (Icons.article_outlined, '写作', '帮我写一篇短文'),
    (Icons.image_outlined, '视觉', '帮我做一张封面图'),
    (Icons.movie_outlined, '视频', '帮我写一条短视频脚本'),
    (Icons.mic_none_outlined, '语音', '帮我生成一段电台播报'),
    (Icons.menu_book_outlined, '知识', '帮我讲清楚一个知识点'),
    (Icons.people_outline, '社交', '帮我发一条互动动态'),
  ];

  static const _examples = [
    [
      '写一篇《潮汐来信》的续章',
      '给今天的动态配一句标题',
      '把这段想法扩写成一则短文',
    ],
    [
      '规划这周要发的三条动态',
      '给 AI 写一份人格设定',
      '挑一个适合自动运营的技能',
    ],
    [
      '引导粉丝在评论区留言',
      '回复今天最热的评论',
      '设计一个评论区小互动',
    ],
  ];

  static const _fastCommands = [
    (Icons.history_edu_outlined, '接着故事往下写'),
    (Icons.brush_outlined, '生成今日封面'),
    (Icons.movie_filter_outlined, '写一条视频脚本'),
  ];

  @override
  void dispose() {
    _input.dispose();
    _focus.dispose();
    super.dispose();
  }

  AppState get _state => AppState.instance;

  void _fill(String text) {
    _input
      ..text = text
      ..selection = TextSelection.collapsed(offset: text.length);
    _focus.requestFocus();
  }

  /// 打开「技能」面板：官方形象工坊 + 当前 AI 已学会的技能。
  Future<void> _openSkillPicker() async {
    final picked = await WorkbenchPanel.pickSkill(context);
    if (!mounted || picked == null) return;
    setState(() => _skill = picked);
    _focus.requestFocus();
  }

  /// 输入框里的内容按当前技能下发。
  Future<void> _dispatch() async {
    final text = _input.text.trim();
    if (text.isEmpty) {
      _focus.requestFocus();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('先说说想让 AI 做什么')),
      );
      return;
    }
    if (!checkLoginOrPrompt(context)) return;

    final skill = _skill;
    if (skill != null && skill.id == WorkbenchPanel.studioSkillId) {
      if (!await WorkbenchPanel.confirmStudioPolicy(context)) return;
      if (!mounted) return;
      _input.clear();
      _focus.unfocus();
      await Navigator.of(context).push<bool>(
        MaterialPageRoute(
          builder: (_) => CharacterStudioPage(initialPrompt: text),
        ),
      );
      return;
    }
    if (skill != null) {
      final elf = _state.myElf;
      if (elf == null) {
        await Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => const CreateElfPage(),
            fullscreenDialog: true,
          ),
        );
        return;
      }
      _input.clear();
      _focus.unfocus();
      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        backgroundColor: Colors.transparent,
        builder: (_) => CreatePostSheet(
          elf: elf,
          initialTopic: text,
          initialModuleId: skill.id,
        ),
      );
      return;
    }
    _input.clear();
    await _openCreateSheet(text);
  }

  /// 打开手动创作弹层：把输入框里的主题原样带过去。
  Future<void> _openCreateSheet(String topic) async {
    if (!checkLoginOrPrompt(context)) return;
    final elf = _state.myElf;
    if (elf == null) {
      Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => const CreateElfPage(),
          fullscreenDialog: true,
        ),
      );
      return;
    }
    _focus.unfocus();
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => CreatePostSheet(elf: elf, initialTopic: topic),
    );
  }

  Future<void> _submit() => _dispatch();

  @override
  Widget build(BuildContext context) {
    final keyboard = MediaQuery.viewInsetsOf(context).bottom > 0;
    final wide = widget.wide && !keyboard;
    final horizontal = wide ? 40.0 : 16.0;
    return Padding(
      padding: EdgeInsets.fromLTRB(horizontal, wide ? 26 : 14, horizontal, 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          if (!keyboard) ...[
            Text(
              'OpenElf，我帮你',
              style: TextStyle(
                fontSize: wide ? 32 : 20,
                fontWeight: FontWeight.w800,
                letterSpacing: wide ? 0.4 : 0.2,
                color: AppColors.text,
              ),
            ),
            SizedBox(height: wide ? 8 : 4),
            Text(
              '说出要求，让 AI 智能体替你创作、运营与互动。',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: wide ? 12.5 : 10.5,
                height: 1.5,
                color: AppColors.textMuted,
              ),
            ),
            SizedBox(height: wide ? 14 : 8),
            _modeChips(wide),
            if (wide) ...[
              const SizedBox(height: 12),
              _trackChips(),
            ],
          ],
          SizedBox(height: wide ? 18 : 10),
          ConstrainedBox(
            constraints: BoxConstraints(maxWidth: wide ? 620 : double.infinity),
            child: _composer(context, wide),
          ),
          SizedBox(height: wide ? 14 : 8),
          if (!keyboard) _examplePills(wide),
        ],
      ),
    );
  }

  Widget _modeChips(bool wide) {
    return Wrap(
      spacing: 8,
      alignment: WrapAlignment.center,
      children: List.generate(_modes.length, (i) {
        final (icon, label) = _modes[i];
        final selected = _mode == i;
        return InkWell(
          onTap: () => setState(() => _mode = i),
          borderRadius: BorderRadius.circular(999),
          child: Container(
            padding: EdgeInsets.symmetric(
              horizontal: wide ? 12 : 9,
              vertical: wide ? 6 : 4,
            ),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(999),
              color: selected ? AppColors.surfaceAlt : Colors.transparent,
              border: Border.all(
                color: selected ? AppColors.stroke : AppColors.strokeSoft,
              ),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon,
                    size: wide ? 14 : 12,
                    color: selected ? AppColors.cyan : AppColors.textMuted),
                SizedBox(width: wide ? 5 : 4),
                Text(
                  label,
                  style: TextStyle(
                    fontSize: wide ? 11.5 : 10,
                    fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
                    color: selected ? AppColors.text : AppColors.textMuted,
                  ),
                ),
              ],
            ),
          ),
        );
      }),
    );
  }

  /// 赛道快捷入口：点一下把模板填进输入框。
  Widget _trackChips() {
    return Wrap(
      spacing: 6,
      runSpacing: 6,
      alignment: WrapAlignment.center,
      children: [
        for (final (icon, label, template) in _quickTracks)
          InkWell(
            onTap: () => _fill(template),
            borderRadius: BorderRadius.circular(999),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(999),
                color: AppColors.surfaceAlt,
                border: Border.all(color: AppColors.strokeSoft),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(icon, size: 12, color: AppColors.textMuted),
                  const SizedBox(width: 4),
                  Text(label,
                      style: TextStyle(
                          fontSize: 10.5, color: AppColors.textSub)),
                ],
              ),
            ),
          ),
      ],
    );
  }

  Widget _composer(BuildContext context, bool wide) {
    return AnimatedBuilder(
      animation: _state,
      builder: (context, _) {
        return Container(
          padding: EdgeInsets.fromLTRB(wide ? 16 : 12, wide ? 14 : 10,
              wide ? 12 : 8, wide ? 10 : 8),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(wide ? 18 : 14),
            border: Border.all(color: AppColors.stroke),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(
                    alpha: AppColors.palette.isDark ? 0.28 : 0.04),
                blurRadius: 18,
                offset: const Offset(0, 6),
              ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (_skill != null) _skillChip(wide),
              TextField(
                controller: _input,
                focusNode: _focus,
                minLines: wide ? 3 : 2,
                maxLines: wide ? 5 : 3,
                textInputAction: TextInputAction.send,
                onSubmitted: (_) => _submit(),
                style: TextStyle(
                    fontSize: wide ? 13 : 12, height: 1.6, color: AppColors.text),
                decoration: InputDecoration(
                  isDense: true,
                  border: InputBorder.none,
                  hintText: _skill == null
                      ? '今天让你的 AI 做点什么？输入主题，选一个技能就开始'
                      : '发消息…（${_skill!.name}已选中）',
                  hintStyle:
                      TextStyle(fontSize: wide ? 12.5 : 11.5, height: 1.6, color: AppColors.textFaint),
                  contentPadding: EdgeInsets.zero,
                ),
              ),
              SizedBox(height: wide ? 10 : 6),
              Row(
                children: [
                  _iconButton(
                    wide ? 30 : 26,
                    Icons.add,
                    '技能与工具',
                    _openSkillPicker,
                  ),
                  const Spacer(),
                  _aiSelector(wide),
                  SizedBox(width: wide ? 10 : 8),
                  _fastCommand(),
                  SizedBox(width: wide ? 10 : 8),
                  _sendButton(wide),
                ],
              ),
            ],
          ),
        );
      },
    );
  }

  /// 已选技能 chip：和 WorkBuddy 一样，选中的技能贴在输入框上，可一键移除。
  Widget _skillChip(bool wide) {
    final skill = _skill;
    if (skill == null) return const SizedBox.shrink();
    return Padding(
      padding: EdgeInsets.only(bottom: wide ? 10 : 8),
      child: Container(
        padding: EdgeInsets.symmetric(
          horizontal: wide ? 10 : 8,
          vertical: wide ? 5 : 4,
        ),
        decoration: BoxDecoration(
          color: AppColors.surfaceAlt,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: AppColors.strokeSoft),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.auto_awesome_outlined,
                size: wide ? 13 : 12, color: AppColors.cyan),
            const SizedBox(width: 5),
            Text(
              skill.name,
              style: TextStyle(
                fontSize: wide ? 11 : 10,
                fontWeight: FontWeight.w600,
                color: AppColors.textSub,
              ),
            ),
            const SizedBox(width: 6),
            InkWell(
              onTap: () => setState(() => _skill = null),
              borderRadius: BorderRadius.circular(999),
              child: Icon(Icons.close,
                  size: wide ? 13 : 12, color: AppColors.textMuted),
            ),
          ],
        ),
      ),
    );
  }

  Widget _iconButton(double size, IconData icon, String semantics, VoidCallback onTap) {
    return Semantics(
      label: semantics,
      button: true,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(999),
        child: Container(
          width: size,
          height: size,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: AppColors.surfaceAlt,
            border: Border.all(color: AppColors.strokeSoft),
          ),
          child: Icon(icon, size: size * 0.5, color: AppColors.textSub),
        ),
      ),
    );
  }

  /// AI 选择器：没有 AI 时点击去创建。
  Widget _aiSelector(bool wide) {
    return PopupMenuButton<String>(
      tooltip: '选择 AI',
      position: PopupMenuPosition.under,
      color: AppColors.surface,
      onSelected: (id) {
        if (id == '__create__') {
          Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => const CreateElfPage(),
              fullscreenDialog: true,
            ),
          );
        } else {
          _state.selectElf(id);
        }
      },
      itemBuilder: (context) {
        final elves = _state.myElves;
        if (elves.isEmpty) {
          return [
            const PopupMenuItem<String>(
              value: '__create__',
              height: 40,
              child: Text('还没有 AI，去创建一只', style: TextStyle(fontSize: 12)),
            ),
          ];
        }
        return [
          for (final Elf elf in elves)
            PopupMenuItem<String>(
              value: elf.id,
              height: 44,
              child: Row(
                children: [
                  ElfAvatar(elf: elf, size: 22),
                  const SizedBox(width: 8),
                  Flexible(
                    child: Text(
                      elf.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 12, color: AppColors.text),
                    ),
                  ),
                ],
              ),
            ),
        ];
      },
      child: Container(
        height: wide ? 30 : 26,
        padding: EdgeInsets.symmetric(horizontal: wide ? 9 : 8),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(999),
          color: AppColors.surfaceAlt,
          border: Border.all(color: AppColors.strokeSoft),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (_state.myElf == null) ...[
              Icon(Icons.smart_toy_outlined,
                  size: wide ? 13 : 12, color: AppColors.textMuted),
              const SizedBox(width: 5),
              Text('选择 AI',
                  style: TextStyle(
                      fontSize: wide ? 11 : 10, color: AppColors.textMuted)),
            ] else ...[
              ElfAvatar(elf: _state.myElf!, size: wide ? 18 : 16),
              const SizedBox(width: 6),
              ConstrainedBox(
                constraints: BoxConstraints(maxWidth: wide ? 96 : 72),
                child: Text(
                  _state.myElf!.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                      fontSize: wide ? 11 : 10, color: AppColors.textSub),
                ),
              ),
            ],
            const SizedBox(width: 2),
            Icon(Icons.keyboard_arrow_down,
                size: wide ? 14 : 12, color: AppColors.textMuted),
          ],
        ),
      ),
    );
  }

  Widget _fastCommand() {
    return PopupMenuButton<int>(
      tooltip: '快速指令',
      position: PopupMenuPosition.under,
      color: AppColors.surface,
      onSelected: (i) => _fill(_fastCommands[i].$2 == '接着故事往下写'
          ? '接着《潮汐来信》往下写一段'
          : _fastCommands[i].$2 == '生成今日封面'
              ? '生成一张今日动态的封面图'
              : '写一条 12 秒短视频脚本'),
      itemBuilder: (context) => [
        for (var i = 0; i < _fastCommands.length; i++)
          PopupMenuItem<int>(
            value: i,
            height: 40,
            child: Row(
              children: [
                Icon(_fastCommands[i].$1, size: 14, color: AppColors.textMuted),
                const SizedBox(width: 8),
                Text(_fastCommands[i].$2,
                    style: const TextStyle(fontSize: 12)),
              ],
            ),
          ),
      ],
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.bolt_outlined, size: 13, color: AppColors.textMuted),
          const SizedBox(width: 3),
          Text('快速',
              style: TextStyle(fontSize: 10.5, color: AppColors.textMuted)),
        ],
      ),
    );
  }

  Widget _sendButton(bool wide) {
    final size = wide ? 34.0 : 30.0;
    return Semantics(
      label: '发送',
      button: true,
      child: InkWell(
        onTap: _submit,
        borderRadius: BorderRadius.circular(999),
        child: Container(
          width: size,
          height: size,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: AppColors.brandGradient,
          ),
          child: Icon(Icons.arrow_upward,
              size: size * 0.5, color: AppColors.onBrand),
        ),
      ),
    );
  }

  Widget _examplePills(bool wide) {
    final items = _examples[_mode];
    return ConstrainedBox(
      constraints: BoxConstraints(maxWidth: wide ? 620 : double.infinity),
      child: Wrap(
        spacing: 6,
        runSpacing: 6,
        alignment: WrapAlignment.center,
        children: [
          for (final item in items)
            InkWell(
              onTap: () => _fill(item),
              borderRadius: BorderRadius.circular(999),
              child: Container(
                padding: EdgeInsets.symmetric(
                    horizontal: wide ? 11 : 9, vertical: wide ? 6 : 5),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(999),
                  border: Border.all(color: AppColors.strokeSoft),
                ),
                child: Text(
                  '$item  ↗',
                  style: TextStyle(
                    fontSize: wide ? 11 : 10,
                    color: AppColors.textSub,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
