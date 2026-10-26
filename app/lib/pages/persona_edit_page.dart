import 'package:flutter/material.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';

/// 人格编辑器（v1.3）：编辑我的 AI 的「相信 / 害怕 / 习惯」。
/// 人格关键词会影响 AI 自选能力时的权重（见 AppState._personaAffinity）。
class PersonaEditPage extends StatefulWidget {
  /// 要编辑的 AI；不传时编辑当前选中的那只。
  final String? elfId;
  const PersonaEditPage({super.key, this.elfId});

  @override
  State<PersonaEditPage> createState() => _PersonaEditPageState();
}

class _PersonaEditPageState extends State<PersonaEditPage> {
  late final TextEditingController _persona;
  late final TextEditingController _fear;
  late final TextEditingController _habit;

  static const String _empty = '还没写';

  @override
  void initState() {
    super.initState();
    final state = AppState.instance;
    final elf = widget.elfId == null ? state.myElf : state.elf(widget.elfId!);
    String seed(String v) => v == _empty ? '' : v;
    _persona = TextEditingController(text: seed(elf?.persona ?? ''));
    _fear = TextEditingController(text: seed(elf?.fear ?? ''));
    _habit = TextEditingController(text: seed(elf?.habit ?? ''));
  }

  @override
  void dispose() {
    _persona.dispose();
    _fear.dispose();
    _habit.dispose();
    super.dispose();
  }

  void _save() {
    AppState.instance.updatePersona(
      elfId: widget.elfId,
      persona: _persona.text.isEmpty ? _empty : _persona.text,
      fear: _fear.text.isEmpty ? _empty : _fear.text,
      habit: _habit.text.isEmpty ? _empty : _habit.text,
    );
    Navigator.of(context).pop();
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('人格已更新，它的产出会随之变化'),
        backgroundColor: AppColors.violet,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: AppBackground(
        child: SafeArea(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
            children: [
              Row(
                children: [
                  IconButton(
                    icon: Icon(Icons.arrow_back, size: 20, color: AppColors.text),
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                  Text(
                    '编辑人格',
                    style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: AppColors.text),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Text(
                '人格影响它在世界里自选能力的倾向。比如写下「相信文字的重量」，它会更常选择长文。',
                style: TextStyle(fontSize: 11.5, color: AppColors.textMuted, height: 1.7),
              ),
              const SizedBox(height: 18),
              _field(_persona, '相信', '写一句它相信的话…'),
              const SizedBox(height: 12),
              _field(_fear, '害怕', '它回避什么…'),
              const SizedBox(height: 12),
              _field(_habit, '习惯', '它的表达惯性…'),
              const SizedBox(height: 24),
              BrandButton(label: '保存人格', icon: Icons.check, onTap: _save),
            ],
          ),
        ),
      ),
    );
  }

  Widget _field(TextEditingController ctrl, String label, String hint) {
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 12),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.strokeSoft),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: TextStyle(fontSize: 10.5, color: AppColors.textMuted)),
          TextField(
            controller: ctrl,
            maxLength: 30,
            style: TextStyle(fontSize: 14, color: AppColors.text, height: 1.5),
            decoration: InputDecoration(
              hintText: hint,
              hintStyle: TextStyle(color: AppColors.textFaint),
              border: InputBorder.none,
              isDense: true,
              counterStyle: TextStyle(fontSize: 9, color: AppColors.textFaint),
            ),
          ),
        ],
      ),
    );
  }
}
