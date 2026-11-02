import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../compliance/ai_creation_policy.dart';
import '../config/api_config.dart';
import '../models/elf.dart';
import '../services/app_content_service.dart';
import '../services/platform_api.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'identity_verify_page.dart';
import 'login_page.dart';
import 'wallet_page.dart';

/// 换一组时需要重新生成 seed 的槽位索引。
/// 有选中时保留选中槽，其余全部刷新；无选中或越界时全部刷新。
List<int> previewRefreshIndices(int slotCount, int? selected) {
  if (selected == null || selected < 0 || selected >= slotCount) {
    return List.generate(slotCount, (i) => i);
  }
  return List.generate(slotCount, (i) => i)
      .where((i) => i != selected)
      .toList();
}

enum _SlotStatus { loading, ready, failed }

class _PreviewSlot {
  int seed;
  CharacterPreview? preview;
  Uint8List? bytes;
  _SlotStatus status;
  _PreviewSlot({required this.seed}) : status = _SlotStatus.loading;
}

/// P3 AI 创建：同一页面内分三步。
///
/// 1. 角色设定（名称 / 风格 / 形象描述 / 人格三项 / 合规声明）
/// 2. 形象预览（服务端合成缩略图 → 确认生成大图）
/// 3. 铸造（链上确权后扣 200 钻石，形象生成免费）
class CreateElfPage extends StatefulWidget {
  const CreateElfPage({super.key});

  @override
  State<CreateElfPage> createState() => _CreateElfPageState();
}

class _CreateElfPageState extends State<CreateElfPage> {
  static const List<String> _styles = ['通用', '像素画', '言情漫画', '细腻厚涂'];

  /// 风格样图：由 server/scripts/gen_style_samples.js 按固定 seed 预生成。
  static const Map<String, String> _styleSamples = {
    '通用': 'assets/styles/style_general.png',
    '像素画': 'assets/styles/style_pixel.png',
    '言情漫画': 'assets/styles/style_manga.png',
    '细腻厚涂': 'assets/styles/style_impasto.png',
  };

  static const List<String> _promptSamples = [
    '一个安静但眼神有光的年轻人，短发，米色外套，站在黄昏的城市天台',
    '16-bit 像素风的小小机械精灵，荧光绿眼睛，背着一只旧帆布包',
    '言情漫画感的少女，长发被风吹起，校服外套搭在肩上，背景是夏日车站',
    '细腻厚涂的少年，暖色逆光，围巾半遮住下巴，雪落在肩上',
  ];

  /// 0 角色设定 / 1 形象预览 / 2 铸造。
  int _step = 0;

  /// 形象来源：text = 文字描述生成；idCard = 已实名的身份证本人授权。
  String _source = 'text';

  final _promptCtrl = TextEditingController();
  final _nameCtrl = TextEditingController();
  final _personaCtrl = TextEditingController();
  final _fearCtrl = TextEditingController();
  final _habitCtrl = TextEditingController();
  String _style = _styles.first;
  final List<bool> _accepted = <bool>[];
  int _sampleIndex = 0;

  /// 服务端角色卡草稿：重复进入预览时复用，改动设定后重新创建。
  String? _draftId;
  String? _draftSignature;
  CharacterCard? _card;

  /// 6 个预览槽位，3 列 × 2 行。
  static const int _previewSlotCount = 6;

  List<_PreviewSlot> _slots = [];
  int? _selectedIndex;
  bool _loadingAll = false;
  bool _generating = false;
  bool _minting = false;

  @override
  void initState() {
    super.initState();
    // 输入变化后主按钮的可用状态要跟着变，这里统一触发重建。
    for (final ctrl in [
      _nameCtrl,
      _promptCtrl,
      _personaCtrl,
      _fearCtrl,
      _habitCtrl,
    ]) {
      ctrl.addListener(_onFormChanged);
    }
  }

  void _onFormChanged() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    for (final ctrl in [
      _nameCtrl,
      _promptCtrl,
      _personaCtrl,
      _fearCtrl,
      _habitCtrl,
    ]) {
      ctrl.removeListener(_onFormChanged);
    }
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

  // Keep the server draft/preview/on-chain flow explicitly selected by the user.
  /// 角色设定的指纹：任一项变化都要用一张新的服务端草稿。
  String get _signature => [
        _nameCtrl.text.trim(),
        _source,
        _style,
        _promptCtrl.text.trim(),
        _personaCtrl.text.trim(),
        _fearCtrl.text.trim(),
        _habitCtrl.text.trim(),
      ].join('\u0001');

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

  bool get _declarationsDone {
    final declarations = _declarations;
    return declarations.isNotEmpty &&
        List.generate(declarations.length, _acceptedAt).every((v) => v);
  }

  bool get _settingsReady {
    final nameOk = _nameCtrl.text.trim().isNotEmpty;
    final promptOk = _source == 'idCard' || _promptCtrl.text.trim().isNotEmpty;
    return nameOk && promptOk && _declarationsDone;
  }

  int _nextSeed() => Random().nextInt(0x7fffffff);

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

  Future<void> _openIdentityVerify() async {
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => const IdentityVerifyPage()),
    );
    if (!mounted) return;
    setState(() {});
  }

  /// 每一步失败都给具体中文提示；实名与余额问题直接引导到对应页面。
  void _showFailure(Object error) {
    if (error is PlatformApiException) {
      if (error.code == 'IDENTITY_REQUIRED') {
        unawaited(_guideIdentity());
        return;
      }
      if (error.code == 'INSUFFICIENT_BALANCE' ||
          error.code == 'insufficient_balance') {
        unawaited(_guideWallet());
        return;
      }
    }
    _toast(_errorText(error));
  }

  String _errorText(Object error) {
    if (error is! PlatformApiException) return '网络开小差了，请稍后重试';
    switch (error.code) {
      case 'CHAIN_DISABLED':
        return '链服务未开通，暂时无法铸造';
      case 'CHAIN_UPSTREAM_ERROR':
      case 'CHAIN_FAILED':
      case 'HTTP_502':
        return '链上服务暂时不可用，请稍后重试';
      case 'IDENTITY_REQUIRED':
        return '请先完成实名认证';
      case 'INSUFFICIENT_BALANCE':
      case 'insufficient_balance':
        return '钻石不足，请先到钱包充值';
      case 'COMMERCE_DISABLED':
        return '消费服务尚未开放，暂时无法铸造';
      case 'CARD_NOT_GENERATED':
        return '形象还没生成，请先确认生成';
      case 'CARD_LOCKED':
        return '形象已生成，如需调整请重新开始';
      case 'CARD_NOT_FOUND':
        return '角色卡不存在，请重新设定';
      case 'CARD_IMAGE_MISSING':
        return '形象文件缺失，请重新生成';
      case 'MINT_IN_PROGRESS':
        return '这只 AI 正在铸造中，请稍后刷新';
      case 'MINT_ORPHAN_STUCK':
        return '铸造状态异常，请联系客服处理';
      case 'MINT_SETTLE_FAILED':
        return error.message;
      case 'NETWORK_ERROR':
        return '网络连接失败，请检查网络后重试';
      default:
        return error.message;
    }
  }

  Future<void> _guideIdentity() async {
    _toast('请先完成实名认证');
    await _openIdentityVerify();
  }

  Future<void> _guideWallet() async {
    final balance = AppState.instance.wallet.diamonds;
    final go = await showDialog<bool>(
      context: context,
      builder: (dctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        title: Text('钻石不足', style: TextStyle(color: AppColors.text)),
        content: Text(
          '铸造需要 💎${AppState.createElfCost}，当前余额 💎$balance。去钱包充值后再回来铸造。',
          style: TextStyle(fontSize: 13, height: 1.6, color: AppColors.textSub),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dctx).pop(false),
            child: Text('取消', style: TextStyle(color: AppColors.textMuted)),
          ),
          TextButton(
            onPressed: () => Navigator.of(dctx).pop(true),
            child: Text('去钱包', style: TextStyle(color: AppColors.cyan)),
          ),
        ],
      ),
    );
    if (go != true || !mounted) return;
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => const WalletPage()),
    );
    if (mounted) setState(() {});
  }

  Future<bool> _validateSettings() async {
    final state = AppState.instance;
    if (state.currentUser == null) {
      _toast('请先登录');
      return false;
    }
    if (_source == 'idCard' && !state.isIdentityVerified) {
      await _openIdentityVerify();
      if (!state.isIdentityVerified) {
        _toast('请先完成实名认证');
        return false;
      }
    }
    final name = _nameCtrl.text.trim();
    if (name.isEmpty) {
      _toast('先给这只 AI 起个名字');
      return false;
    }
    if (name.runes.length > AiCreationPolicy.maxNameLength) {
      _toast('名字最多 ${AiCreationPolicy.maxNameLength} 个字');
      return false;
    }
    if (_source == 'text' && _promptCtrl.text.trim().isEmpty) {
      _toast('先描述你想要的形象');
      return false;
    }
    final blocked = AiCreationPolicy.checkTexts([
      name,
      _source == 'text' ? _promptCtrl.text : '',
      _personaCtrl.text,
      _fearCtrl.text,
      _habitCtrl.text,
    ]);
    if (blocked != null) {
      _toast(blocked);
      return false;
    }
    if (!_declarationsDone) {
      _toast('请先勾选全部合规声明');
      return false;
    }
    return true;
  }

  /// 返回可用的草稿 id；改动设定或上一张卡已生成时，重新创建一张草稿。
  Future<String?> _ensureDraft() async {
    final signature = _signature;
    final existing = _draftId;
    if (existing != null && _draftSignature == signature) return existing;

    final name = _nameCtrl.text.trim();
    final prompt = _source == 'idCard' ? '' : _promptCtrl.text.trim();
    final canUpdate = existing != null && (_card?.status ?? 'draft') == 'draft';
    try {
      final card = canUpdate
          ? await PlatformApi.instance.updateCharacterDraft(
              existing,
              name: name,
              source: _source,
              style: _style,
              prompt: prompt,
              persona: _personaCtrl.text.trim(),
              fear: _fearCtrl.text.trim(),
              habit: _habitCtrl.text.trim(),
            )
          : await PlatformApi.instance.createCharacterDraft(
              name: name,
              source: _source,
              style: _style,
              prompt: prompt,
              persona: _personaCtrl.text.trim(),
              fear: _fearCtrl.text.trim(),
              habit: _habitCtrl.text.trim(),
            );
      if (!mounted) return null;
      setState(() {
        _card = card;
        _draftId = card.id;
        _draftSignature = signature;
        _selectedIndex = null;
        _slots = [];
      });
      return card.id;
    } on PlatformApiException catch (error) {
      if (error.code != 'CARD_LOCKED') {
        if (mounted) _showFailure(error);
        return null;
      }
      // 已生成的角色卡不能再改设定，换一张新草稿继续。
      try {
        final card = await PlatformApi.instance.createCharacterDraft(
          name: name,
          source: _source,
          style: _style,
          prompt: prompt,
          persona: _personaCtrl.text.trim(),
          fear: _fearCtrl.text.trim(),
          habit: _habitCtrl.text.trim(),
        );
        if (!mounted) return null;
        setState(() {
          _card = card;
          _draftId = card.id;
          _draftSignature = signature;
          _selectedIndex = null;
          _slots = [];
        });
        return card.id;
      } catch (retryError) {
        if (mounted) _showFailure(retryError);
        return null;
      }
    } catch (error) {
      if (mounted) _showFailure(error);
      return null;
    }
  }

  /// 为指定索引列表生成新 seed 并占位为 loading。indices 为 null 时全量初始化。
  void _initSlotsFor({List<int>? indices}) {
    if (indices == null) {
      _slots = List.generate(
          _previewSlotCount, (i) => _PreviewSlot(seed: _nextSeed()));
    } else {
      for (final i in indices) {
        _slots[i] = _PreviewSlot(seed: _nextSeed());
      }
    }
  }

  /// 拉取指定槽位的预览（并发）。indices 为空时拉全部。
  Future<void> _loadPreviews({List<int>? indices}) async {
    if (_generating) return;
    final id = await _ensureDraft();
    if (!mounted || id == null) return;
    // _ensureDraft 在新建/更新草稿时会清空 _slots，此时需要重新初始化全部槽位。
    if (_slots.length != _previewSlotCount) {
      _initSlotsFor();
    }
    final ids = indices ?? List.generate(_previewSlotCount, (i) => i);
    final tasks = ids.map((i) async {
      try {
        final p = await PlatformApi.instance
            .previewCharacter(id, seed: _slots[i].seed);
        if (mounted)
          setState(() {
            _slots[i].preview = p;
            _slots[i].bytes = _decodeThumb(p.thumbDataUrl);
            _slots[i].status = _SlotStatus.ready;
          });
      } catch (_) {
        if (mounted) setState(() => _slots[i].status = _SlotStatus.failed);
      }
    });
    setState(() => _loadingAll = indices == null);
    await Future.wait(tasks);
    if (mounted) setState(() => _loadingAll = false);
  }

  Future<void> _continueFromSettings() async {
    if (!await _validateSettings()) return;
    if (!mounted) return;
    setState(() => _step = 1);
    _selectedIndex = null;
    _initSlotsFor();
    await _loadPreviews();
  }

  Future<void> _changePreview() async {
    if (_loadingAll || _generating) return;
    final toRefresh = previewRefreshIndices(_previewSlotCount, _selectedIndex);
    _initSlotsFor(indices: toRefresh);
    await _loadPreviews(indices: toRefresh);
  }

  Future<void> _generate() async {
    final idx = _selectedIndex;
    final id = _draftId;
    if (idx == null || id == null || _generating) return;
    final slot = _slots[idx];
    if (slot.status != _SlotStatus.ready) return;
    setState(() => _generating = true);
    try {
      final card = await PlatformApi.instance.generateCharacter(
        id,
        seed: slot.seed,
        traits: slot.preview?.traits,
      );
      if (!mounted) return;
      setState(() {
        _card = card;
        _generating = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _generating = false);
      _showFailure(error);
    }
  }

  Future<void> _mint() async {
    final card = _card;
    if (card == null || _minting) return;
    final state = AppState.instance;
    if (state.wallet.diamonds < AppState.createElfCost) {
      await _guideWallet();
      return;
    }
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        title: Text('确认铸造', style: TextStyle(color: AppColors.text)),
        content: Text(
          '铸造将扣除 💎${AppState.createElfCost}（当前余额 💎${state.wallet.diamonds}）。'
          '形象生成免费，这一步只做链上确权与资产登记。',
          style: TextStyle(fontSize: 13, height: 1.6, color: AppColors.textSub),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dctx).pop(false),
            child: Text('再想想', style: TextStyle(color: AppColors.textMuted)),
          ),
          TextButton(
            onPressed: () => Navigator.of(dctx).pop(true),
            child: Text('确认铸造', style: TextStyle(color: AppColors.cyan)),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _minting = true);
    try {
      final result = await PlatformApi.instance.mintCharacter(card.id);
      final elf = state.adoptMintedElf(result.elf);
      // 快照刷新会校正余额与 activeElfId；失败不影响已落地的本地结果。
      unawaited(state.refreshEarnings());
      if (!mounted) return;
      setState(() => _minting = false);
      await _showMinted(result, elf);
    } catch (error) {
      if (!mounted) return;
      setState(() => _minting = false);
      _showFailure(error);
    }
  }

  Future<void> _showMinted(MintResult result, Elf? elf) async {
    final nav = Navigator.of(context);
    final image = ApiConfig.resolveAssetUrl(
      result.imageUrl ?? result.thumbUrl ?? result.card?.imageUrl,
    );
    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (dctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        title: Text('铸造成功', style: TextStyle(color: AppColors.text)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (image != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(14),
                  // 弹窗内容由 IntrinsicWidth 布局，图片必须给有限宽度；
                  // 用 double.infinity 会触发 input.isFinite 断言失败，整个弹窗渲染成空白。
                  child: SizedBox(
                    height: 160,
                    width: MediaQuery.sizeOf(dctx).width - 80,
                    child: Image.network(
                      image,
                      fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => const SizedBox.shrink(),
                    ),
                  ),
                ),
              ),
            Text(
              '${elf?.name ?? result.card?.name ?? '你的 AI'} 已铸造并归入你的账户资产。',
              style:
                  TextStyle(fontSize: 13, height: 1.6, color: AppColors.text),
            ),
            const SizedBox(height: 8),
            Text('铸造序号',
                style: TextStyle(fontSize: 11, color: AppColors.textMuted)),
            const SizedBox(height: 2),
            Text('#${result.tokenId ?? '-'}',
                style: TextStyle(
                    fontSize: 12,
                    color: AppColors.textSub,
                    fontFamily: 'monospace')),
            if (result.dciId != null && result.dciId!.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text('链上确权',
                  style: TextStyle(fontSize: 11, color: AppColors.textMuted)),
              const SizedBox(height: 2),
              Text(result.dciId!,
                  style: TextStyle(
                      fontSize: 11,
                      color: AppColors.cyan,
                      fontFamily: 'monospace')),
            ],
            const SizedBox(height: 10),
            Text('已自动切换为当前 AI，可在「我」里继续配置人格与技能。',
                style: TextStyle(fontSize: 11, color: AppColors.textMuted)),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () {
              Navigator.of(dctx).pop();
              // 回到首页并切到「我」，新 AI 已在本地列表且为当前 AI。
              nav.pop(true);
            },
            child: Text('返回首页', style: TextStyle(color: AppColors.cyan)),
          ),
        ],
      ),
    );
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
                        0 => _stepSettings(),
                        1 => _stepPreview(state),
                        _ => _stepMint(state),
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
                  Text('选一条形象来源、写下人格，生成形象后再决定是否铸造。',
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
    const titles = ['角色设定', '形象预览', '铸造'];
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

  // —— 第 1 步：角色设定 ——

  Widget _stepSettings() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('角色设定',
            style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: AppColors.text)),
        const SizedBox(height: 10),
        _field(
          label: '名字',
          hint: '最多 ${AiCreationPolicy.maxNameLength} 个字',
          controller: _nameCtrl,
          maxLength: AiCreationPolicy.maxNameLength,
        ),
        const SizedBox(height: 4),
        _sourceSection(),
        const SizedBox(height: 18),
        _styleSection(),
        const SizedBox(height: 18),
        if (_source == 'text') _textPromptPanel() else _idCardPanel(),
        const SizedBox(height: 20),
        _personaSection(),
        const SizedBox(height: 20),
        _complianceSection(),
      ],
    );
  }

  Widget _sourceSection() {
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

  Widget _textPromptPanel() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text('形象描述',
                style: TextStyle(fontSize: 11, color: AppColors.textMuted)),
            const Spacer(),
            _ghostChip(
              icon: Icons.auto_fix_high,
              label: 'AI 帮写',
              onTap: () {
                setState(() {
                  _promptCtrl.text =
                      _promptSamples[_sampleIndex % _promptSamples.length];
                  _sampleIndex++;
                });
              },
            ),
          ],
        ),
        const SizedBox(height: 8),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.stroke),
          ),
          child: TextField(
            controller: _promptCtrl,
            maxLines: 3,
            maxLength: AiCreationPolicy.maxPromptLength,
            style: TextStyle(fontSize: 14, color: AppColors.text),
            textInputAction: TextInputAction.done,
            decoration: InputDecoration(
              counterText: '',
              hintText: '输入你脑海中的形象',
              hintStyle: TextStyle(fontSize: 13, color: AppColors.textMuted),
              border: InputBorder.none,
            ),
          ),
        ),
        const SizedBox(height: 8),
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
      return Container(
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
      );
    }
    return Container(
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
            child:
                Icon(Icons.verified_user, size: 22, color: AppColors.onBrand),
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
                    style: TextStyle(fontSize: 10.5, color: AppColors.textSub)),
              ],
            ),
          ),
        ],
      ),
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
            Text('形象工坊 · 预览免费',
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
    final sample = _styleSamples[style];
    return GestureDetector(
      onTap: () => setState(() => _style = style),
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
            child: ClipRRect(
              borderRadius: BorderRadius.circular(13),
              child: Stack(
                fit: StackFit.expand,
                children: [
                  if (sample != null)
                    Image.asset(
                      sample,
                      fit: BoxFit.cover,
                      filterQuality: FilterQuality.medium,
                      errorBuilder: (_, __, ___) => _styleFallback(colors),
                    )
                  else
                    _styleFallback(colors),
                  if (selected)
                    Container(
                      color: Colors.black.withOpacity(0.35),
                      child: const Icon(
                        Icons.check,
                        size: 22,
                        color: Colors.white,
                      ),
                    ),
                ],
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

  Widget _styleFallback(List<Color> colors) {
    return Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: colors,
        ),
      ),
      child: Icon(
        Icons.brush_outlined,
        size: 20,
        color: Colors.white.withOpacity(0.9),
      ),
    );
  }

  List<Color> _gradientOf(String style) => switch (style) {
        '像素画' => const [Color(0xFF4ADE80), Color(0xFF0F766E)],
        '言情漫画' => const [Color(0xFFF9A8D4), Color(0xFF7C3AED)],
        '细腻厚涂' => const [Color(0xFFF2B07B), Color(0xFF7A3B2E)],
        _ => [AppColors.violet, AppColors.cyan],
      };

  Widget _personaSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('人格',
            style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: AppColors.text)),
        const SizedBox(height: 6),
        Text('人格会决定它自动运营时的选题倾向，人类指挥始终优先。',
            style: TextStyle(fontSize: 10.5, color: AppColors.textMuted)),
        const SizedBox(height: 12),
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

  // —— 合规闸门 ——

  Widget _complianceSection() {
    final byIdCard = _source == 'idCard';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
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

  // —— 第 2 步：形象预览 ——

  Widget _stepPreview(AppState state) {
    final generated = _card?.generated ?? false;
    final selected = _selectedIndex != null ? _slots[_selectedIndex!] : null;
    final tier =
        generated ? (_card?.rarityTier) : (selected?.preview?.rarityTier);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text('形象预览',
                style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: AppColors.text)),
            const Spacer(),
            if (tier != null) _rarityChip(tier),
          ],
        ),
        const SizedBox(height: 10),
        if (generated) _generatedImageBox() else _previewGrid(),
        const SizedBox(height: 14),
        if (!generated)
          Row(
            children: [
              _ghostChip(
                  icon: Icons.shuffle,
                  label: '换一组',
                  onTap: _loadingAll || _generating ? () {} : _changePreview),
            ],
          ),
        const SizedBox(height: 14),
        Text(
          generated
              ? '形象已生成并锁定组合。形象生成免费，下一步铸造才会扣除钻石。'
              : '预览由站内形象工坊免费合成；挑一版最有感觉的，确认生成同样不收费。',
          style: TextStyle(
              fontSize: 10.5, height: 1.6, color: AppColors.textMuted),
        ),
        const SizedBox(height: 10),
        if (state.wallet.diamonds < AppState.createElfCost)
          Text(
            '当前余额 💎${state.wallet.diamonds}，铸造需要 💎${AppState.createElfCost}，可先去钱包充值。',
            style: TextStyle(fontSize: 10.5, color: AppColors.warn),
          ),
      ],
    );
  }

  Widget _generatedImageBox() {
    final url = ApiConfig.resolveAssetUrl(_card?.imageUrl);
    return Container(
      width: double.infinity,
      height: 360,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(22),
        gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [AppColors.surface, AppColors.surfaceAlt]),
        border: Border.all(color: AppColors.stroke),
      ),
      clipBehavior: Clip.antiAlias,
      child: url != null
          ? ClipRRect(
              borderRadius: BorderRadius.circular(16),
              child: Image.network(url,
                  fit: BoxFit.contain,
                  errorBuilder: (_, __, ___) => _fallbackArt('形象图加载失败，可换一组重试')))
          : _fallbackArt('还没有预览'),
    );
  }

  Widget _previewGrid() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(22),
        gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [AppColors.surface, AppColors.surfaceAlt]),
        border: Border.all(color: AppColors.stroke),
      ),
      child: GridView.builder(
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        itemCount: _previewSlotCount,
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 3,
          crossAxisSpacing: 10,
          mainAxisSpacing: 10,
        ),
        itemBuilder: (context, i) => _slotCell(i),
      ),
    );
  }

  Widget _slotCell(int i) {
    if (i >= _slots.length) {
      return Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.stroke),
        ),
      );
    }
    final slot = _slots[i];
    final selected = _selectedIndex == i;
    return GestureDetector(
      onTap: _generating ? null : () => _selectSlot(i),
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
              color: selected ? AppColors.cyan : AppColors.stroke,
              width: selected ? 2 : 1),
        ),
        clipBehavior: Clip.antiAlias,
        child: AspectRatio(
          aspectRatio: 1,
          child: _slotContent(slot, selected),
        ),
      ),
    );
  }

  Widget _slotContent(_PreviewSlot slot, bool selected) {
    switch (slot.status) {
      case _SlotStatus.loading:
        return Center(
            child: SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(
                    strokeWidth: 2, color: AppColors.cyan)));
      case _SlotStatus.failed:
        return GestureDetector(
          onTap: () => _retrySlot(slot.seed),
          child: Center(
              child: Icon(Icons.refresh, size: 18, color: AppColors.textMuted)),
        );
      case _SlotStatus.ready:
        return Stack(
          fit: StackFit.expand,
          children: [
            if (slot.bytes != null)
              Image.memory(slot.bytes!,
                  fit: BoxFit.cover,
                  gaplessPlayback: true,
                  filterQuality: FilterQuality.medium),
            if (selected)
              Positioned(
                  top: 6,
                  right: 6,
                  child: Icon(Icons.check_circle,
                      color: AppColors.cyan, size: 18)),
          ],
        );
    }
  }

  void _selectSlot(int i) {
    if (i >= _slots.length || _slots[i].status != _SlotStatus.ready) return;
    setState(() {
      if (_selectedIndex == i) {
        _openZoom(i);
      } else {
        _selectedIndex = i;
      }
    });
  }

  Future<void> _retrySlot(int seed) async {
    final id = _draftId;
    if (id == null || _generating) return;
    final idx = _slots.indexWhere((s) => s.seed == seed);
    if (idx < 0) return;
    setState(() => _slots[idx].status = _SlotStatus.loading);
    try {
      final p = await PlatformApi.instance.previewCharacter(id, seed: seed);
      if (!mounted) return;
      setState(() {
        _slots[idx].preview = p;
        _slots[idx].bytes = _decodeThumb(p.thumbDataUrl);
        _slots[idx].status = _SlotStatus.ready;
      });
    } catch (_) {
      if (mounted) setState(() => _slots[idx].status = _SlotStatus.failed);
    }
  }

  Future<void> _openZoom(int i) async {
    final bytes = _slots[i].bytes;
    if (bytes == null) return;
    await showDialog<void>(
      context: context,
      builder: (ctx) => Dialog(
        backgroundColor: Colors.black87,
        insetPadding: const EdgeInsets.all(24),
        child: InteractiveViewer(
          child: Image.memory(bytes,
              fit: BoxFit.contain, filterQuality: FilterQuality.medium),
        ),
      ),
    );
  }

  Widget _fallbackArt(String text) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.blur_on, size: 34, color: AppColors.textFaint),
        const SizedBox(height: 10),
        Text(text, style: TextStyle(fontSize: 11, color: AppColors.textMuted)),
        const SizedBox(height: 10),
        _ghostChip(
          icon: Icons.refresh,
          label: '重新预览',
          onTap: _loadingAll ? () {} : _changePreview,
        ),
      ],
    );
  }

  Widget _rarityChip(String tier) {
    final color = switch (tier) {
      'legendary' => AppColors.warn,
      'epic' => AppColors.violet,
      'rare' => AppColors.cyan,
      _ => AppColors.textSub,
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: color.withOpacity(0.14),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withOpacity(0.4)),
      ),
      child: Text('稀有度 · ${_rarityLabel(tier)}',
          style: TextStyle(fontSize: 10, color: color)),
    );
  }

  String _rarityLabel(String? tier) => switch (tier) {
        'legendary' => '传说',
        'epic' => '史诗',
        'rare' => '稀有',
        'common' => '普通',
        _ => '待评估',
      };

  // —— 第 3 步：铸造 ——

  Widget _stepMint(AppState state) {
    final card = _card;
    final balance = state.wallet.diamonds;
    final enough = balance >= AppState.createElfCost;
    final imageUrl = ApiConfig.resolveAssetUrl(card?.imageUrl);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('铸造',
            style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: AppColors.text)),
        const SizedBox(height: 7),
        Text('铸造将扣除 ${AppState.createElfCost} 钻石，形象生成免费。',
            style: TextStyle(
                fontSize: 11.5, height: 1.6, color: AppColors.textSub)),
        const SizedBox(height: 14),
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.stroke),
          ),
          child: Row(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(14),
                child: SizedBox(
                  width: 58,
                  height: 58,
                  child: imageUrl != null
                      ? Image.network(
                          imageUrl,
                          fit: BoxFit.cover,
                          errorBuilder: (_, __, ___) => _previewThumb(),
                        )
                      : _previewThumb(),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      card?.name.trim().isNotEmpty == true
                          ? card!.name
                          : (_nameCtrl.text.trim().isEmpty
                              ? '未命名'
                              : _nameCtrl.text.trim()),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
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
                      _source == 'idCard'
                          ? '本人身份证授权 · ${state.identity?.maskedName ?? ''}'
                          : (_promptCtrl.text.trim().isEmpty
                              ? '文字描述形象'
                              : _promptCtrl.text.trim()),
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
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            color: AppColors.surfaceAlt,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.stroke),
          ),
          child: Row(
            children: [
              Text('铸造费',
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
            child: Row(
              children: [
                Expanded(
                  child: Text('钻石不足，先充值再铸造（10 钻石 = 1 元）。',
                      style: TextStyle(fontSize: 10.5, color: AppColors.warn)),
                ),
                TextButton(
                  onPressed: _guideWallet,
                  child: Text('去钱包', style: TextStyle(color: AppColors.cyan)),
                ),
              ],
            ),
          ),
        const SizedBox(height: 16),
        _checkRow('链上确权', '铸造成功才占用链上序号'),
        _checkRow('资产归属', '编号、形象与技能随 AI 一起转移'),
        _checkRow('生成内容标识', '形象持续加注「AI 生成」'),
        const SizedBox(height: 12),
        Text(
          '铸造是给这只 AI 做资产登记，不是投资或炒作。形象本身由站内形象工坊生成，'
          '不涉及外部钱包或加密资产风险。',
          style: TextStyle(
              fontSize: 10.5, height: 1.6, color: AppColors.textMuted),
        ),
      ],
    );
  }

  Widget _previewThumb() {
    final bytes = _selectedIndex != null ? _slots[_selectedIndex!].bytes : null;
    if (bytes != null) {
      return Image.memory(bytes,
          fit: BoxFit.cover, filterQuality: FilterQuality.medium);
    }
    return ColoredBox(
      color: AppColors.surfaceHigh,
      child: Icon(Icons.auto_awesome, size: 20, color: AppColors.textFaint),
    );
  }

  // —— 底部主按钮 ——

  Widget _footer(AppState state) {
    final String label;
    final bool enabled;
    final bool idCardUnverified =
        _source == 'idCard' && !state.isIdentityVerified;
    switch (_step) {
      case 0:
        label = idCardUnverified ? '去实名认证' : '下一步 · 形象预览';
        enabled = idCardUnverified || _settingsReady;
        break;
      case 1:
        final generated = _card?.generated ?? false;
        final hasSelection = _selectedIndex != null;
        label =
            generated ? '下一步 · 铸造' : (hasSelection ? '确认生成所选形象' : '先挑一版最有感觉的');
        enabled = generated
            ? (!_loadingAll && !_generating)
            : (hasSelection && !_loadingAll && !_generating);
        break;
      default:
        label = _minting ? '铸造中…' : '铸造 AI · 💎${AppState.createElfCost}';
        enabled = (_card?.generated ?? false) && !_minting;
        break;
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
            onPressed: !enabled ? null : () => _handlePrimary(state),
            child: Text(label,
                style:
                    const TextStyle(fontSize: 14, fontWeight: FontWeight.w700)),
          ),
        ),
      ),
    );
  }

  Future<void> _handlePrimary(AppState state) async {
    switch (_step) {
      case 0:
        if (_source == 'idCard' && !state.isIdentityVerified) {
          await _openIdentityVerify();
          return;
        }
        await _continueFromSettings();
        return;
      case 1:
        if (_card?.generated ?? false) {
          setState(() => _step = 2);
          return;
        }
        await _generate();
        return;
      default:
        await _mint();
        return;
    }
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
}
