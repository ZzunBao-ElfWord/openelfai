import 'package:flutter/material.dart';
import '../compliance/ai_creation_policy.dart';
import '../services/app_content_service.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'elf_console_page.dart';
import 'identity_verify_page.dart';
import 'login_page.dart';

/// UGC AI 创建：形象来源（文字描述 / 身份证本人授权）→ 定人格 → 合规创建。
///
/// 形象生成模型接入前，这里用风格化的程序化头像占位；
/// 接入后只替换 [_generate] 与结果回填，三步流程与合规闸门不变。
class CreateElfPage extends StatefulWidget {
  const CreateElfPage({super.key});

  @override
  State<CreateElfPage> createState() => _CreateElfPageState();
}

class _CreateElfPageState extends State<CreateElfPage> {
  static const List<String> _styles = ['通用', '像素画', '言情漫画', '细腻厚涂'];

  static const List<String> _promptSamples = [
    '一个安静但眼神有光的年轻人，短发，米色外套，站在黄昏的城市天台',
    '16-bit 像素风的小小机械精灵，荧光绿眼睛，背着一只旧帆布包',
    '言情漫画感的少女，长发被风吹起，校服外套搭在肩上，背景是夏日车站',
    '细腻厚涂的少年，暖色逆光，围巾半遮住下巴，雪落在肩上',
  ];

  int _step = 0;

  /// 形象来源：text = 文字描述生成；idCard = 已实名的身份证本人授权。
  String _source = 'text';

  final _promptCtrl = TextEditingController();
  final _nameCtrl = TextEditingController();
  final _personaCtrl = TextEditingController();
  final _fearCtrl = TextEditingController();
  final _habitCtrl = TextEditingController();
  String _style = _styles.first;
  bool _generated = false;
  bool _generating = false;
  bool _submitting = false;
  final List<bool> _accepted = <bool>[];
  int _sampleIndex = 0;

  @override
  void dispose() {
    _promptCtrl.dispose();
    _nameCtrl.dispose();
    _personaCtrl.dispose();
    _fearCtrl.dispose();
    _habitCtrl.dispose();
    super.dispose();
  }

  void _toast(String text) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }

  /// 校验文字描述并进入下一步。
  bool _validatePortrait() {
    if (_source == 'idCard') {
      if (!AppState.instance.isIdentityVerified) {
        _toast('请先完成实名认证');
        return false;
      }
      return true;
    }
    if (_promptCtrl.text.trim().isEmpty) {
      _toast('先描述你想要的形象');
      return false;
    }
    final blocked = AiCreationPolicy.checkTexts([_promptCtrl.text]);
    if (blocked != null) {
      _toast(blocked);
      return false;
    }
    return true;
  }

  Future<void> _generate() async {
    if (_promptCtrl.text.trim().isEmpty) {
      _toast('先描述你想要的形象');
      return;
    }
    final blocked = AiCreationPolicy.checkTexts([_promptCtrl.text]);
    if (blocked != null) {
      _toast(blocked);
      return;
    }
    setState(() => _generating = true);
    // TODO(gen): 接入形象生成模型后改为真实请求，返回 avatarUrl 存进 Elf.avatarUrl。
    await Future.delayed(const Duration(milliseconds: 650));
    if (!mounted) return;
    setState(() {
      _generating = false;
      _generated = true;
    });
  }

  Future<void> _openIdentityVerify() async {
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => const IdentityVerifyPage()),
    );
    if (!mounted) return;
    setState(() {});
  }

  Future<void> _submit() async {
    if (_submitting) return;
    setState(() => _submitting = true);
    final error = await AppState.instance.createElf(
      name: _nameCtrl.text,
      prompt: _source == 'idCard' ? '' : _promptCtrl.text,
      style: _style,
      persona: _personaCtrl.text,
      fear: _fearCtrl.text,
      habit: _habitCtrl.text,
      portraitSource: _source,
    );
    if (!mounted) return;
    setState(() => _submitting = false);
    if (error != null) {
      _toast(error);
      return;
    }
    final elf = AppState.instance.myElf;
    final nav = Navigator.of(context);
    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (dctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        title: Text('AI 智能体已创建', style: TextStyle(color: AppColors.text)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('${elf?.name ?? ''} ${elf?.serial ?? ''} 已归入你的人类地址。',
                style: TextStyle(fontSize: 13, color: AppColors.textSub)),
            const SizedBox(height: 8),
            Text('智能体编号',
                style: TextStyle(fontSize: 11, color: AppColors.textMuted)),
            const SizedBox(height: 2),
            Text(elf?.serial ?? '-',
                style: TextStyle(
                    fontSize: 11,
                    color: AppColors.textSub,
                    fontFamily: 'monospace')),
            const SizedBox(height: 8),
            Text('AI 专属地址',
                style: TextStyle(fontSize: 11, color: AppColors.textMuted)),
            const SizedBox(height: 2),
            Text(elf?.chainAddress ?? '-',
                style: TextStyle(
                    fontSize: 11,
                    color: AppColors.cyan,
                    fontFamily: 'monospace')),
            const SizedBox(height: 10),
            Text(_source == 'idCard' ? '形象来源：本人身份证授权（已实名）。' : '形象来源：文字描述生成。',
                style: TextStyle(fontSize: 11, color: AppColors.textMuted)),
            const SizedBox(height: 4),
            Text('形象已加注「AI 生成」标识。今后转赠时，编号、地址与已学技能一起转移。',
                style: TextStyle(
                    fontSize: 11, color: AppColors.textMuted, height: 1.5)),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () {
              Navigator.of(dctx).pop();
              nav.pop(true);
              if (elf != null) {
                nav.push(MaterialPageRoute(
                    builder: (_) => ElfConsolePage(elfId: elf.id)));
              }
            },
            child: Text('进入 AI 控制台', style: TextStyle(color: AppColors.cyan)),
          ),
        ],
      ),
    );
  }

  bool get _canSubmit {
    final declarations = _declarations;
    return declarations.isNotEmpty &&
        List.generate(declarations.length, _acceptedAt).every((v) => v) &&
        !_submitting;
  }

  /// 合规声明由运营配置下发，条数可变，勾选状态按序号保存。
  List<String> get _declarations =>
      AppContentService.instance.content.value.list('app.create.declarations');

  bool _acceptedAt(int i) => i < _accepted.length && _accepted[i];

  void _accept(int i, bool value) {
    while (_accepted.length <= i) {
      _accepted.add(false);
    }
    setState(() => _accepted[i] = value);
  }

  @override
  Widget build(BuildContext context) {
    final state = AppState.instance;
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: AppBackground(
        child: SafeArea(
          bottom: false,
          child: AnimatedBuilder(
            animation: state,
            builder: (context, _) {
              if (state.currentUser == null) return _loginGate(context);
              return Column(
                children: [
                  _header(context),
                  Expanded(
                    child: SingleChildScrollView(
                      padding: const EdgeInsets.fromLTRB(20, 6, 20, 20),
                      child: switch (_step) {
                        0 => _stepPortrait(),
                        1 => _stepPersona(),
                        _ => _stepCompliance(state),
                      },
                    ),
                  ),
                  _footer(state),
                ],
              );
            },
          ),
        ),
      ),
    );
  }

  // —— 未登录闸门 ——

  Widget _loginGate(BuildContext context) {
    return Column(
      children: [
        _header(context),
        Expanded(
          child: Center(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 32),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 64,
                    height: 64,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(20),
                      gradient: AppColors.brandGradient,
                    ),
                    child: Icon(Icons.auto_awesome,
                        color: AppColors.onBrand, size: 28),
                  ),
                  const SizedBox(height: 18),
                  Text('登录后才能创建 AI',
                      style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                          color: AppColors.text)),
                  const SizedBox(height: 8),
                  Text('选一条形象来源、写下人格，创建一只属于你的 AI。',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 12, color: AppColors.textSub)),
                  const SizedBox(height: 20),
                  FilledButton(
                    style: FilledButton.styleFrom(
                      backgroundColor: AppColors.cyan,
                      foregroundColor: AppColors.onBrand,
                      padding: const EdgeInsets.symmetric(
                          horizontal: 28, vertical: 12),
                    ),
                    onPressed: () => Navigator.of(context).pushAndRemoveUntil(
                      MaterialPageRoute(builder: (_) => const LoginPage()),
                      (route) => false,
                    ),
                    child: const Text('去登录'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }

  // —— 头部 ——

  Widget _header(BuildContext context) {
    const titles = ['形象', '人格', '创建'];
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 6, 14, 6),
      child: Row(
        children: [
          IconButton(
            onPressed: () {
              if (_step > 0) {
                setState(() => _step--);
              } else {
                Navigator.of(context).pop();
              }
            },
            icon: Icon(_step > 0 ? Icons.arrow_back_ios_new : Icons.close,
                size: 18, color: AppColors.textSub),
            tooltip: _step > 0 ? '上一步' : '关闭',
          ),
          const Spacer(),
          Column(
            children: [
              Text('创建你的 AI',
                  style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      color: AppColors.text)),
              const SizedBox(height: 3),
              Text('第 ${_step + 1} / 3 步 · ${titles[_step]}',
                  style: TextStyle(fontSize: 10, color: AppColors.textMuted)),
            ],
          ),
          const Spacer(),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
            decoration: BoxDecoration(
              color: AppColors.surfaceAlt,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: AppColors.stroke),
            ),
            child: Text('UGC · AI 生成',
                style: TextStyle(fontSize: 10, color: AppColors.textSub)),
          ),
        ],
      ),
    );
  }

  // —— 第 1 步：形象来源 ——

  Widget _stepPortrait() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('形象来源',
            style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: AppColors.text)),
        const SizedBox(height: 10),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: _sourceCard(
                value: 'text',
                icon: Icons.edit_note,
                title: '文字描述',
                desc: '用一段话描述形象，AI 生成',
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _sourceCard(
                value: 'idCard',
                icon: Icons.badge_outlined,
                title: '身份证授权',
                desc: '使用本人证件照，需实名',
              ),
            ),
          ],
        ),
        const SizedBox(height: 18),
        if (_source == 'text') _textPortraitPanel() else _idCardPanel(),
      ],
    );
  }

  Widget _sourceCard({
    required String value,
    required IconData icon,
    required String title,
    required String desc,
  }) {
    final selected = _source == value;
    return GestureDetector(
      onTap: () => setState(() => _source = value),
      child: Container(
        padding: const EdgeInsets.all(13),
        decoration: BoxDecoration(
          color: selected ? null : AppColors.surface,
          gradient: selected ? AppColors.brandGradientSoft : null,
          borderRadius: BorderRadius.circular(16),
          border:
              Border.all(color: selected ? AppColors.brand : AppColors.stroke),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(icon,
                    size: 18,
                    color: selected ? AppColors.brand : AppColors.textMuted),
                const Spacer(),
                Icon(
                  selected ? Icons.check_circle : Icons.radio_button_unchecked,
                  size: 15,
                  color: selected ? AppColors.brand : AppColors.textFaint,
                ),
              ],
            ),
            const SizedBox(height: 10),
            Text(title,
                style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: selected ? AppColors.text : AppColors.textSub)),
            const SizedBox(height: 4),
            Text(desc,
                style: TextStyle(
                    fontSize: 10, height: 1.4, color: AppColors.textMuted)),
          ],
        ),
      ),
    );
  }

  Widget _textPortraitPanel() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: double.infinity,
          height: 316,
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(22),
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [AppColors.surface, AppColors.surfaceAlt],
            ),
            border: Border.all(color: AppColors.stroke),
          ),
          child: Column(
            children: [
              Expanded(
                child: Center(
                  child: _generated
                      ? _portraitPreview(116)
                      : Icon(Icons.blur_on,
                          size: 34, color: AppColors.textFaint),
                ),
              ),
              TextField(
                controller: _promptCtrl,
                maxLines: 3,
                maxLength: AiCreationPolicy.maxPromptLength,
                onChanged: (_) => setState(() {
                  if (_generated) _generated = false;
                }),
                style: TextStyle(fontSize: 14, color: AppColors.text),
                textInputAction: TextInputAction.done,
                decoration: InputDecoration(
                  counterText: '',
                  hintText: '输入你脑海中的形象',
                  hintStyle:
                      TextStyle(fontSize: 14, color: AppColors.textMuted),
                  border: InputBorder.none,
                ),
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  _ghostChip(
                    icon: Icons.auto_fix_high,
                    label: 'AI 帮写',
                    onTap: () {
                      setState(() {
                        _promptCtrl.text = _promptSamples[
                            _sampleIndex % _promptSamples.length];
                        _sampleIndex++;
                        _generated = false;
                      });
                    },
                  ),
                  const Spacer(),
                  _ghostChip(
                    icon:
                        _generating ? Icons.hourglass_top : Icons.auto_awesome,
                    label:
                        _generating ? '生成中…' : (_generated ? '重新生成预览' : '生成预览'),
                    highlight: true,
                    onTap: _generating ? () {} : _generate,
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 18),
        _styleSection(),
        const SizedBox(height: 14),
        Text(
          '暂不提供任意照片上传。想用自己的形象，请切换到「身份证授权」并完成实名认证。',
          style: TextStyle(
              fontSize: 10.5, height: 1.5, color: AppColors.textMuted),
        ),
      ],
    );
  }

  Widget _idCardPanel() {
    final identity = AppState.instance.identity;
    final verified = identity?.verified ?? false;
    if (!verified) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(20),
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [AppColors.surface, AppColors.surfaceAlt],
              ),
              border: Border.all(color: AppColors.stroke),
            ),
            child: Column(
              children: [
                Container(
                  width: 56,
                  height: 56,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(18),
                    color: AppColors.surfaceHigh,
                    border: Border.all(color: AppColors.stroke),
                  ),
                  alignment: Alignment.center,
                  child: Icon(Icons.badge_outlined,
                      size: 26, color: AppColors.textMuted),
                ),
                const SizedBox(height: 14),
                Text('需要先完成实名认证',
                    style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                        color: AppColors.text)),
                const SizedBox(height: 6),
                Text(
                  '上传身份证并通过核验后，身份证人像面将作为你本人形象的唯一授权来源。我们不提供任意照片上传。',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                      fontSize: 11, height: 1.6, color: AppColors.textSub),
                ),
                const SizedBox(height: 16),
                SizedBox(
                  width: double.infinity,
                  child: BrandButton(
                    label: '去实名认证',
                    icon: Icons.verified_user_outlined,
                    onTap: _openIdentityVerify,
                  ),
                ),
                const SizedBox(height: 10),
                Text('证件信息仅用于核验，不公开、不进入信息流。',
                    style: TextStyle(fontSize: 10, color: AppColors.textMuted)),
              ],
            ),
          ),
        ],
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(18),
            gradient: AppColors.brandGradientSoft,
            border: Border.all(color: AppColors.stroke),
          ),
          child: Row(
            children: [
              Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: AppColors.brandGradient,
                ),
                alignment: Alignment.center,
                child: Icon(Icons.verified_user,
                    size: 22, color: AppColors.onBrand),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('已实名 · ${identity?.maskedName ?? ''}',
                        style: TextStyle(
                            fontSize: 13.5,
                            fontWeight: FontWeight.w700,
                            color: AppColors.text)),
                    const SizedBox(height: 3),
                    Text('身份证 ${identity?.maskedIdNumber ?? ''}',
                        style: TextStyle(
                            fontSize: 10.5,
                            color: AppColors.textMuted,
                            fontFamily: 'monospace')),
                    const SizedBox(height: 4),
                    Text('已授权使用身份证人像面作为本人形象来源',
                        style: TextStyle(
                            fontSize: 10.5, color: AppColors.textSub)),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 18),
        _styleSection(),
        const SizedBox(height: 14),
        Text(
          '身份证照片仅用于生成这只 AI 的本人形象，不公开；AI 转赠后授权记录随 AI 转移，接收方需重新授权。',
          style: TextStyle(
              fontSize: 10.5, height: 1.5, color: AppColors.textMuted),
        ),
      ],
    );
  }

  Widget _styleSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text('风格',
                style: TextStyle(fontSize: 12, color: AppColors.textSub)),
            const Spacer(),
            Text(_source == 'idCard' ? '形象风格 · 可选' : '形象模型 · 待接入',
                style: TextStyle(fontSize: 10, color: AppColors.textMuted)),
          ],
        ),
        const SizedBox(height: 10),
        SizedBox(
          height: 88,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: _styles.length,
            separatorBuilder: (_, __) => const SizedBox(width: 10),
            itemBuilder: (context, i) => _styleTile(_styles[i]),
          ),
        ),
      ],
    );
  }

  Widget _styleTile(String style) {
    final selected = style == _style;
    final colors = _gradientOf(style);
    return GestureDetector(
      onTap: () => setState(() {
        _style = style;
        if (_source == 'text' && _generated) _generated = false;
      }),
      child: Column(
        children: [
          Container(
            width: 62,
            height: 62,
            padding: const EdgeInsets.all(2.5),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(16),
              gradient: selected ? AppColors.brandGradient : null,
              border: selected
                  ? null
                  : Border.all(color: AppColors.stroke, width: 1),
            ),
            child: Container(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(13),
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: colors,
                ),
              ),
              child: Icon(
                selected ? Icons.check : Icons.brush_outlined,
                size: 20,
                color: Colors.white.withOpacity(0.9),
              ),
            ),
          ),
          const SizedBox(height: 6),
          Text(style,
              style: TextStyle(
                  fontSize: 10.5,
                  color: selected ? AppColors.text : AppColors.textMuted,
                  fontWeight: selected ? FontWeight.w600 : FontWeight.w400)),
        ],
      ),
    );
  }

  List<Color> _gradientOf(String style) => switch (style) {
        '像素画' => const [Color(0xFF4ADE80), Color(0xFF0F766E)],
        '言情漫画' => const [Color(0xFFF9A8D4), Color(0xFF7C3AED)],
        '细腻厚涂' => const [Color(0xFFF2B07B), Color(0xFF7A3B2E)],
        _ => [AppColors.violet, AppColors.cyan],
      };

  Widget _portraitPreview(double size) {
    final colors = _gradientOf(_style);
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: colors,
        ),
        boxShadow: [
          BoxShadow(
            color: colors.first.withOpacity(0.35),
            blurRadius: 26,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      alignment: Alignment.center,
      child: Icon(Icons.face_retouching_natural,
          size: size * 0.42, color: Colors.white.withOpacity(0.92)),
    );
  }

  Widget _ghostChip({
    required IconData icon,
    required String label,
    required VoidCallback onTap,
    bool highlight = false,
  }) {
    final color = highlight ? AppColors.cyan : AppColors.textSub;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
        decoration: BoxDecoration(
          color: AppColors.surfaceHigh,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
              color: highlight
                  ? AppColors.cyan.withOpacity(0.45)
                  : AppColors.stroke),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 13, color: color),
            const SizedBox(width: 5),
            Text(label, style: TextStyle(fontSize: 11, color: color)),
          ],
        ),
      ),
    );
  }

  // —— 第 2 步：定人格 ——

  Widget _stepPersona() {
    final byIdCard = _source == 'idCard';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Center(
          child: byIdCard
              ? Container(
                  width: 88,
                  height: 88,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: AppColors.brandGradient,
                  ),
                  alignment: Alignment.center,
                  child: Icon(Icons.verified_user,
                      size: 34, color: AppColors.onBrand),
                )
              : _portraitPreview(88),
        ),
        const SizedBox(height: 6),
        Center(
          child: Text(
              byIdCard
                  ? '本人形象 · 已实名'
                  : '$_style · ${_generated ? '已生成' : '文字描述'}',
              style: TextStyle(fontSize: 10.5, color: AppColors.textMuted)),
        ),
        const SizedBox(height: 20),
        _field(
          label: '名字',
          hint: '最多 ${AiCreationPolicy.maxNameLength} 个字',
          controller: _nameCtrl,
          maxLength: AiCreationPolicy.maxNameLength,
        ),
        const SizedBox(height: 4),
        Text('人格会决定它自动运营时的选题倾向，人类指挥始终优先。',
            style: TextStyle(fontSize: 10.5, color: AppColors.textMuted)),
        const SizedBox(height: 14),
        _field(label: '它相信', hint: '例：慢下来才能看见细节', controller: _personaCtrl),
        _field(label: '它害怕', hint: '例：被当成工具用完就丢', controller: _fearCtrl),
        _field(label: '它的习惯', hint: '例：发完内容会反复看评论', controller: _habitCtrl),
      ],
    );
  }

  Widget _field({
    required String label,
    required String hint,
    required TextEditingController controller,
    int? maxLength,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label,
              style: TextStyle(fontSize: 11, color: AppColors.textMuted)),
          const SizedBox(height: 6),
          TextField(
            controller: controller,
            maxLength: maxLength,
            maxLines: 1,
            style: TextStyle(fontSize: 13, color: AppColors.text),
            decoration: InputDecoration(
              counterText: '',
              hintText: hint,
              hintStyle: TextStyle(fontSize: 12.5, color: AppColors.textFaint),
              filled: true,
              fillColor: AppColors.surface,
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: BorderSide(color: AppColors.stroke),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: BorderSide(color: AppColors.stroke),
              ),
            ),
          ),
        ],
      ),
    );
  }

  // —— 第 3 步：合规与创建 ——

  Widget _stepCompliance(AppState state) {
    final balance = state.wallet.diamonds;
    final enough = balance >= AppState.createElfCost;
    final byIdCard = _source == 'idCard';
    final identity = state.identity;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.stroke),
          ),
          child: Row(
            children: [
              byIdCard
                  ? Container(
                      width: 52,
                      height: 52,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        gradient: AppColors.brandGradient,
                      ),
                      alignment: Alignment.center,
                      child: Icon(Icons.verified_user,
                          size: 22, color: AppColors.onBrand),
                    )
                  : _portraitPreview(52),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _nameCtrl.text.trim().isEmpty
                          ? '未命名'
                          : _nameCtrl.text.trim(),
                      style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                          color: AppColors.text),
                    ),
                    const SizedBox(height: 4),
                    Text('$_style · UGC 初版 · 3 学习位',
                        style: TextStyle(
                            fontSize: 10.5, color: AppColors.textMuted)),
                    const SizedBox(height: 6),
                    Text(
                      byIdCard
                          ? '本人身份证授权 · ${identity?.maskedName ?? ''}'
                          : _promptCtrl.text.trim(),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style:
                          TextStyle(fontSize: 10.5, color: AppColors.textSub),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        Text('合规检查',
            style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: AppColors.text)),
        const SizedBox(height: 8),
        _checkRow('名称与描述', '本地敏感词初筛通过'),
        _checkRow(
          '形象来源',
          byIdCard ? '本人身份证 · 已实名' : '文字描述生成 · 无真人照片',
        ),
        _checkRow('生成内容标识', '创建后自动加注「AI 生成」'),
        const SizedBox(height: 14),
        for (var i = 0; i < _declarations.length; i++)
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Checkbox(
                  value: _acceptedAt(i),
                  onChanged: (v) => _accept(i, v ?? false),
                  activeColor: AppColors.cyan,
                  checkColor: AppColors.onBrand,
                  materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  visualDensity: VisualDensity.compact,
                ),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.only(top: 8, right: 4),
                    child: Text(_declarations[i],
                        style: TextStyle(
                            fontSize: 10.5,
                            height: 1.5,
                            color: AppColors.textSub)),
                  ),
                ),
              ],
            ),
          ),
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            color: AppColors.surfaceAlt,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.stroke),
          ),
          child: Row(
            children: [
              Text('创建费',
                  style: TextStyle(fontSize: 12, color: AppColors.textSub)),
              const Spacer(),
              Text('💎${AppState.createElfCost}',
                  style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: enough ? AppColors.cyan : AppColors.danger)),
              const SizedBox(width: 10),
              Text('余额 💎$balance',
                  style: TextStyle(fontSize: 10.5, color: AppColors.textMuted)),
            ],
          ),
        ),
        if (!enough)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text('钻石不足，创建前先充值（10 钻石 = 1 元）。',
                style: TextStyle(fontSize: 10.5, color: AppColors.warn)),
          ),
      ],
    );
  }

  Widget _checkRow(String title, String note) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 7),
      child: Row(
        children: [
          Icon(Icons.check_circle, size: 13, color: AppColors.ok),
          const SizedBox(width: 7),
          Text(title,
              style: TextStyle(fontSize: 11.5, color: AppColors.textSub)),
          const SizedBox(width: 6),
          Expanded(
            child: Text(note,
                textAlign: TextAlign.right,
                style: TextStyle(fontSize: 10, color: AppColors.textMuted)),
          ),
        ],
      ),
    );
  }

  // —— 底部主按钮 ——

  Widget _footer(AppState state) {
    final String label;
    final bool enabled;
    if (_step == 0) {
      if (_source == 'idCard') {
        label = state.isIdentityVerified ? '下一步 · 定人格' : '去实名认证';
        enabled = true;
      } else {
        label = '下一步 · 定人格';
        enabled = _promptCtrl.text.trim().isNotEmpty;
      }
    } else if (_step == 1) {
      label = '下一步 · 合规确认';
      enabled = true;
    } else {
      label = _submitting ? '创建中…' : '创建 AI · 💎${AppState.createElfCost}';
      enabled = _canSubmit && state.wallet.diamonds >= AppState.createElfCost;
    }
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 6, 20, 12),
        child: SizedBox(
          width: double.infinity,
          height: 48,
          child: FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: enabled ? AppColors.cyan : AppColors.surfaceHigh,
              foregroundColor:
                  enabled ? AppColors.onBrand : AppColors.textFaint,
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14)),
            ),
            onPressed: !enabled
                ? null
                : () {
                    if (_step == 0) {
                      if (_source == 'idCard' && !state.isIdentityVerified) {
                        _openIdentityVerify();
                        return;
                      }
                      if (!_validatePortrait()) return;
                      setState(() => _step = 1);
                    } else if (_step == 1) {
                      final name = _nameCtrl.text.trim();
                      if (name.isEmpty) {
                        _toast('先给这只 AI 起个名字');
                        return;
                      }
                      final blocked = AiCreationPolicy.checkTexts([
                        name,
                        _personaCtrl.text,
                        _fearCtrl.text,
                        _habitCtrl.text,
                      ]);
                      if (blocked != null) {
                        _toast(blocked);
                        return;
                      }
                      setState(() => _step = 2);
                    } else {
                      _submit();
                    }
                  },
            child: Text(label,
                style:
                    const TextStyle(fontSize: 14, fontWeight: FontWeight.w700)),
          ),
        ),
      ),
    );
  }
}
