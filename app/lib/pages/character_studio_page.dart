import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../compliance/ai_creation_policy.dart';
import '../config/api_config.dart';
import '../services/platform_api.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'wallet_page.dart';

/// 形象工坊（对话式）：
/// 描述形象 → 选风格 → 免费预览 3 版 → 选一版 → 命名 → 出正式形象。
/// 入口来自工作台输入框的「形象工坊」技能 chip。
class CharacterStudioPage extends StatefulWidget {
  /// 从输入框带过来的第一句描述，进来后直接出预览。
  final String initialPrompt;

  const CharacterStudioPage({super.key, this.initialPrompt = ''});

  @override
  State<CharacterStudioPage> createState() => _CharacterStudioPageState();
}

enum _Stage { brief, previewLoading, previews, naming, generating, done }

class _PreviewOption {
  final int seed;
  final CharacterPreview preview;
  const _PreviewOption({required this.seed, required this.preview});
}

class _CharacterStudioPageState extends State<CharacterStudioPage> {
  static const List<String> _styles = ['通用', '像素画', '言情漫画', '细腻厚涂'];

  static const List<String> _samples = [
    '银发少年，白色长风衣，雨夜霓虹下的侧脸',
    '像素风小机器人，荧光绿眼睛，背着旧帆布包',
    '夏日车站的少女，长发被风吹起，校服外套搭肩',
  ];

  static const Map<String, String> _tierLabels = {
    'common': '普通',
    'rare': '稀有',
    'epic': '史诗',
    'legendary': '传说',
  };

  final _input = TextEditingController();
  final _scroll = ScrollController();

  _Stage _stage = _Stage.brief;
  String _style = _styles.first;
  String _prompt = '';
  String? _draftId;

  /// 预览返回的组合，按顺序展示。
  List<_PreviewOption> _options = const [];
  int? _selected;

  CharacterCard? _card;
  bool _busy = false;

  /// 对话气泡：true = AI 说，false = 用户说。
  final List<(String, bool)> _bubbles = [];

  @override
  void initState() {
    super.initState();
    if (widget.initialPrompt.isNotEmpty) _input.text = widget.initialPrompt;
    _bubbles.add((
      '我是形象工坊。说说你想做的形象：气质、发型、服装、场景都可以写进来，先给你免费看 3 版。',
      true,
    ));
    if (widget.initialPrompt.isNotEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _submitBrief());
    }
  }

  @override
  void dispose() {
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _say(String text, {bool ai = true}) {
    if (!mounted) return;
    setState(() => _bubbles.add((text, ai)));
    _scrollToEnd();
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) return;
      _scroll.animateTo(
        _scroll.position.maxScrollExtent,
        duration: const Duration(milliseconds: 220),
        curve: Curves.easeOut,
      );
    });
  }

  Uint8List? _decodeThumb(String dataUrl) {
    final comma = dataUrl.indexOf(',');
    final raw = comma >= 0 ? dataUrl.substring(comma + 1) : dataUrl;
    if (raw.isEmpty) return null;
    try {
      return base64Decode(raw);
    } catch (_) {
      return null;
    }
  }

  /// 服务端错误转成用户能懂的短句。
  String _errorText(Object error) {
    if (error is! PlatformApiException) return '网络开小差了，请稍后重试';
    switch (error.code) {
      case 'INSUFFICIENT_BALANCE':
      case 'insufficient_balance':
        return '钻石不足，请先到钱包充值';
      case 'IDENTITY_REQUIRED':
        return '请先完成实名认证';
      case 'CARD_LOCKED':
        return '这张角色卡已经生成过，可以再来一版';
      case 'CARD_NOT_FOUND':
        return '角色卡不存在，请重新开始';
      case 'NETWORK_ERROR':
        return '网络连接失败，请检查网络后重试';
      default:
        return error.message;
    }
  }

  void _fail(Object error) {
    _busy = false;
    _stage = _stage == _Stage.generating ? _Stage.naming : _Stage.brief;
    _say(_errorText(error));
  }

  /// 第一步：拿到描述，用占位名建草稿，然后并发取 3 版免费预览。
  Future<void> _submitBrief() async {
    if (_busy) return;
    final text = _input.text.trim();
    if (text.isEmpty) {
      _say('先描述一下你想要的形象，一句话也可以。');
      return;
    }
    final blocked = AiCreationPolicy.checkTexts([text]);
    if (blocked != null) {
      _say(blocked);
      return;
    }
    _input.clear();
    _say(text, ai: false);
    _prompt = text;
    setState(() {
      _busy = true;
      _stage = _Stage.previewLoading;
    });
    _say('收到，按「$_style」风格先合成 3 版预览。预览免费，正式形象也不收费。');
    try {
      final draft = await PlatformApi.instance.createCharacterDraft(
        name: '形象草稿',
        source: 'text',
        style: _style,
        prompt: _prompt,
        persona: '',
        fear: '',
        habit: '',
      );
      _draftId = draft.id;
      final options = await _loadPreviews();
      if (!mounted) return;
      setState(() {
        _options = options;
        _selected = null;
        _busy = false;
        _stage = _Stage.previews;
      });
      _say('3 版预览出来了，挑一版最有感觉的。');
    } catch (error) {
      if (mounted) _fail(error);
    }
  }

  Future<List<_PreviewOption>> _loadPreviews() async {
    final id = _draftId;
    if (id == null) return const [];
    final rng = Random();
    final seeds = List.generate(3, (_) => rng.nextInt(0x7fffffff));
    final previews = await Future.wait(
      seeds.map((seed) => PlatformApi.instance.previewCharacter(id, seed: seed)),
    );
    return [
      for (var i = 0; i < seeds.length; i++)
        _PreviewOption(seed: seeds[i], preview: previews[i]),
    ];
  }

  /// 重掷 3 版（同一张草稿，只换种子）。
  Future<void> _reshuffle() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _stage = _Stage.previewLoading;
    });
    _say('换一组组合，再给你 3 版。');
    try {
      final options = await _loadPreviews();
      if (!mounted) return;
      setState(() {
        _options = options;
        _selected = null;
        _busy = false;
        _stage = _Stage.previews;
      });
    } catch (error) {
      if (mounted) _fail(error);
    }
  }

  void _pick(int index) {
    final id = _draftId;
    if (id == null || _busy) return;
    setState(() {
      _selected = index;
      _stage = _Stage.naming;
    });
    _say('就这版了。给它起个名字（最多 ${AiCreationPolicy.maxNameLength} 个字），'
        '之后可以铸造为你的 AI。');
  }

  /// 第二步：命名后生成正式形象。
  Future<void> _submitName() async {
    if (_busy) return;
    final name = _input.text.trim();
    final id = _draftId;
    final index = _selected;
    if (id == null || index == null || _options.isEmpty) return;
    if (name.isEmpty) {
      _say('先给它起个名字。');
      return;
    }
    if (name.runes.length > AiCreationPolicy.maxNameLength) {
      _say('名字最多 ${AiCreationPolicy.maxNameLength} 个字。');
      return;
    }
    final blocked = AiCreationPolicy.checkTexts([name]);
    if (blocked != null) {
      _say(blocked);
      return;
    }
    _input.clear();
    _say(name, ai: false);
    setState(() {
      _busy = true;
      _stage = _Stage.generating;
    });
    _say('正在生成正式形象…');
    try {
      final draft = await PlatformApi.instance.updateCharacterDraft(
        id,
        name: name,
        source: 'text',
        style: _style,
        prompt: _prompt,
        persona: '',
        fear: '',
        habit: '',
      );
      final chosen = _options[index];
      final card = await PlatformApi.instance.generateCharacter(
        draft.id,
        seed: chosen.seed,
        traits: chosen.preview.traits,
      );
      if (!mounted) return;
      setState(() {
        _card = card;
        _busy = false;
        _stage = _Stage.done;
      });
      _say('形象生成好了（内容由 AI 生成）。需要的话可以直接铸造为你的 AI。');
    } catch (error) {
      if (mounted) _fail(error);
    }
  }

  Future<void> _mint() async {
    final card = _card;
    if (card == null || _busy) return;
    final state = AppState.instance;
    final go = await showDialog<bool>(
      context: context,
      builder: (dctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        title: Text('铸造为你的 AI', style: TextStyle(color: AppColors.text)),
        content: Text(
          '铸造会扣除 💎${AppState.createElfCost}（当前余额 💎${state.wallet.diamonds}）。'
          '形象生成免费，这一步只做资产登记。',
          style: TextStyle(fontSize: 13, height: 1.6, color: AppColors.textSub),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dctx).pop(false),
            child: Text('取消', style: TextStyle(color: AppColors.textMuted)),
          ),
          TextButton(
            onPressed: () => Navigator.of(dctx).pop(true),
            child: Text('确认铸造', style: TextStyle(color: AppColors.cyan)),
          ),
        ],
      ),
    );
    if (go != true || !mounted) return;
    setState(() => _busy = true);
    try {
      final result = await PlatformApi.instance.mintCharacter(card.id);
      state.adoptMintedElf(result.elf);
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      setState(() => _busy = false);
      if (error is PlatformApiException &&
          (error.code == 'INSUFFICIENT_BALANCE' ||
              error.code == 'insufficient_balance')) {
        await Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => const WalletPage()),
        );
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(_errorText(error))),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          children: [
            _header(),
            Expanded(
              child: ListView(
                controller: _scroll,
                padding: const EdgeInsets.fromLTRB(14, 6, 14, 12),
                children: [
                  for (final bubble in _bubbles)
                    _bubble(text: bubble.$1, ai: bubble.$2),
                  ..._stageWidgets(),
                ],
              ),
            ),
            _composer(),
          ],
        ),
      ),
    );
  }

  Widget _header() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 8, 12, 6),
      child: Row(
        children: [
          IconButton(
            icon: Icon(Icons.close, size: 18, color: AppColors.textMuted),
            onPressed: () => Navigator.of(context).pop(),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '形象工坊',
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: AppColors.text,
                  ),
                ),
                Text(
                  '文字描述 → 免费预览 → 正式形象 · 内容由 AI 生成',
                  style:
                      TextStyle(fontSize: 10, color: AppColors.textFaint),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _bubble({required String text, required bool ai}) {
    return Align(
      alignment: ai ? Alignment.centerLeft : Alignment.centerRight,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
        constraints: BoxConstraints(
          maxWidth: MediaQuery.sizeOf(context).width * 0.78,
        ),
        decoration: BoxDecoration(
          color: ai ? AppColors.surface : null,
          gradient: ai ? null : AppColors.brandGradient,
          borderRadius: BorderRadius.circular(12),
          border: ai ? Border.all(color: AppColors.strokeSoft) : null,
        ),
        child: Text(
          text,
          style: TextStyle(
            fontSize: 12,
            height: 1.6,
            color: ai ? AppColors.textSub : AppColors.onBrand,
          ),
        ),
      ),
    );
  }

  List<Widget> _stageWidgets() {
    switch (_stage) {
      case _Stage.brief:
        return [_styleChips(), _samplePills()];
      case _Stage.previewLoading:
      case _Stage.generating:
        return [_loadingCard()];
      case _Stage.previews:
        return [_previewGrid()];
      case _Stage.naming:
        return [_selectedCard()];
      case _Stage.done:
        return [_finalCard()];
    }
  }

  Widget _styleChips() {
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Wrap(
        spacing: 6,
        runSpacing: 6,
        children: [
          for (final style in _styles)
            InkWell(
              onTap: () => setState(() => _style = style),
              borderRadius: BorderRadius.circular(999),
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 11, vertical: 5),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(999),
                  color: _style == style ? AppColors.surfaceAlt : null,
                  border: Border.all(
                    color: _style == style
                        ? AppColors.cyan
                        : AppColors.strokeSoft,
                  ),
                ),
                child: Text(
                  style,
                  style: TextStyle(
                    fontSize: 10.5,
                    color: _style == style
                        ? AppColors.text
                        : AppColors.textMuted,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _samplePills() {
    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Wrap(
        spacing: 6,
        runSpacing: 6,
        children: [
          for (final sample in _samples)
            InkWell(
              onTap: () {
                _input.text = sample;
                _input.selection =
                    TextSelection.collapsed(offset: sample.length);
              },
              borderRadius: BorderRadius.circular(999),
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(999),
                  border: Border.all(color: AppColors.strokeSoft),
                ),
                child: Text(
                  sample,
                  style: TextStyle(fontSize: 10, color: AppColors.textSub),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _loadingCard() {
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 6),
      padding: const EdgeInsets.symmetric(vertical: 18),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.strokeSoft),
      ),
      child: Center(
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: AppColors.cyan,
              ),
            ),
            const SizedBox(width: 10),
            Text(
              '正在合成形象…',
              style: TextStyle(fontSize: 11.5, color: AppColors.textMuted),
            ),
          ],
        ),
      ),
    );
  }

  Widget _previewGrid() {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  '挑一版继续 · ${_tierLabels[_options.first.preview.rarityTier] ?? '普通'}起',
                  style:
                      TextStyle(fontSize: 10.5, color: AppColors.textMuted),
                ),
              ),
              TextButton(
                onPressed: _busy ? null : _reshuffle,
                child: Text(
                  '换一组',
                  style: TextStyle(fontSize: 11, color: AppColors.cyan),
                ),
              ),
            ],
          ),
          Row(
            children: [
              for (var i = 0; i < _options.length; i++) ...[
                if (i > 0) const SizedBox(width: 8),
                Expanded(child: _previewTile(i)),
              ],
            ],
          ),
        ],
      ),
    );
  }

  Widget _previewTile(int index) {
    final option = _options[index];
    final bytes = _decodeThumb(option.preview.thumbDataUrl);
    final tier = _tierLabels[option.preview.rarityTier] ?? '普通';
    return InkWell(
      onTap: () => _pick(index),
      borderRadius: BorderRadius.circular(10),
      child: Container(
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: AppColors.strokeSoft),
        ),
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            AspectRatio(
              aspectRatio: 1,
              child: bytes == null
                  ? Container(
                      color: AppColors.surfaceAlt,
                      alignment: Alignment.center,
                      child: Icon(Icons.image_outlined,
                          size: 20, color: AppColors.textFaint),
                    )
                  : Image.memory(bytes, fit: BoxFit.cover),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      tier,
                      style:
                          TextStyle(fontSize: 10, color: AppColors.textMuted),
                    ),
                  ),
                  Text(
                    '选它',
                    style: TextStyle(fontSize: 10, color: AppColors.cyan),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _selectedCard() {
    final index = _selected;
    if (index == null || index >= _options.length) return const SizedBox();
    final bytes = _decodeThumb(_options[index].preview.thumbDataUrl);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          if (bytes != null)
            ClipRRect(
              borderRadius: BorderRadius.circular(10),
              child: Image.memory(bytes, width: 84, height: 84, fit: BoxFit.cover),
            ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              '在下方输入角色名，回车即可生成正式形象。',
              style: TextStyle(fontSize: 10.5, color: AppColors.textMuted),
            ),
          ),
        ],
      ),
    );
  }

  Widget _finalCard() {
    final card = _card;
    final url = ApiConfig.resolveAssetUrl(card?.imageUrl);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: url == null
                ? Container(
                    height: 200,
                    color: AppColors.surfaceAlt,
                    alignment: Alignment.center,
                    child: Text(
                      '形象文件缺失，可再来一版',
                      style:
                          TextStyle(fontSize: 11, color: AppColors.textMuted),
                    ),
                  )
                : Image.network(url, fit: BoxFit.cover),
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              Expanded(
                child: Text(
                  card?.name ?? '',
                  style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w600,
                    color: AppColors.text,
                  ),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: AppColors.surfaceAlt,
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Text(
                  'AI 生成',
                  style: TextStyle(fontSize: 9, color: AppColors.textMuted),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: GhostButton(
                  label: '再来一版',
                  onTap: _busy ? null : _reshuffle,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: BrandButton(
                  label: '铸造为我的 AI',
                  icon: Icons.auto_awesome_outlined,
                  onTap: _busy ? null : _mint,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _composer() {
    final hint = switch (_stage) {
      _Stage.brief => '描述你想要的形象…',
      _Stage.naming => '角色名（最多 ${AiCreationPolicy.maxNameLength} 字）',
      _ => '这一轮完成了，可以点上面的按钮继续',
    };
    final enabled = _stage == _Stage.brief || _stage == _Stage.naming;
    return Container(
      padding: EdgeInsets.fromLTRB(
        14,
        10,
        14,
        10 + MediaQuery.viewInsetsOf(context).bottom,
      ),
      decoration: BoxDecoration(
        color: AppColors.surface,
        border: Border(top: BorderSide(color: AppColors.strokeSoft)),
      ),
      child: Row(
        children: [
          Expanded(
            child: TextField(
              controller: _input,
              enabled: enabled && !_busy,
              minLines: 1,
              maxLines: 4,
              textInputAction: TextInputAction.send,
              onSubmitted: (_) {
                if (_stage == _Stage.brief) {
                  unawaited(_submitBrief());
                } else if (_stage == _Stage.naming) {
                  unawaited(_submitName());
                }
              },
              style: TextStyle(fontSize: 12, color: AppColors.text),
              decoration: InputDecoration(
                isDense: true,
                hintText: hint,
                hintStyle:
                    TextStyle(fontSize: 11.5, color: AppColors.textFaint),
                filled: true,
                fillColor: AppColors.surfaceAlt,
                contentPadding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10),
                  borderSide: BorderSide.none,
                ),
              ),
            ),
          ),
          const SizedBox(width: 8),
          InkWell(
            onTap: !enabled || _busy
                ? null
                : () {
                    if (_stage == _Stage.brief) {
                      unawaited(_submitBrief());
                    } else {
                      unawaited(_submitName());
                    }
                  },
            borderRadius: BorderRadius.circular(999),
            child: Container(
              width: 34,
              height: 34,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: enabled && !_busy ? AppColors.brandGradient : null,
                color: enabled && !_busy ? null : AppColors.surfaceAlt,
              ),
              child: Icon(
                Icons.arrow_upward,
                size: 17,
                color: enabled && !_busy
                    ? AppColors.onBrand
                    : AppColors.textFaint,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
