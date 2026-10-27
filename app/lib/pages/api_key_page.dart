import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import '../payments/alipay_service.dart';
import '../config/payment_features.dart';
import '../payments/web_checkout.dart';
import '../payments/web_qr_dialog.dart';
import 'home_shell.dart';
import '../services/platform_api.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';
import '../widgets/legacy_web_orders.dart';

/// 「我的 API Key」：当前账号唯一的平台凭据 + AI 对话余额。
class ApiKeyPage extends StatefulWidget {
  const ApiKeyPage({super.key});

  @override
  State<ApiKeyPage> createState() => _ApiKeyPageState();
}

class _ApiKeyPageState extends State<ApiKeyPage> {
  MyKeyInfo? _info;
  bool _loading = true;
  String? _error;

  /// reveal 出来的完整 Key；null 表示只显示掩码。
  String? _revealed;
  bool _revealing = false;
  bool _resetting = false;

  @override
  void initState() {
    super.initState();
    _load(showLoading: false);
    if (kIsWeb) {
      _recoverWebTopup();
    }
  }

  Future<void> _recoverWebTopup() async {
    final owner = AppState.instance.currentUser?.id;
    if (owner == null) return;
    final pending = await WebTopupStore.read(owner);
    final id = pending?['orderId'];
    if (!mounted ||
        AppState.instance.currentUser?.id != owner ||
        id is! String ||
        !WebCheckout.validOrderId(id)) {
      return;
    }
    await _openTopup(initialOrderId: id);
  }

  Future<void> _load({bool showLoading = true}) async {
    if (showLoading) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final info = await PlatformApi.instance.fetchMyKey();
      if (!mounted) return;
      setState(() {
        _info = info;
        _loading = false;
        _error = null;
      });
    } on PlatformApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.message;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = '加载失败，请稍后重试';
      });
    }
  }

  void _retry() => _load();

  Future<void> _toggleReveal() async {
    if (_revealed != null) {
      setState(() => _revealed = null);
      return;
    }
    if (_revealing) return;
    setState(() => _revealing = true);
    try {
      final key = await PlatformApi.instance.revealKey();
      if (!mounted) return;
      setState(() {
        _revealed = key;
        _revealing = false;
      });
    } on PlatformApiException catch (error) {
      if (!mounted) return;
      setState(() => _revealing = false);
      _snack(error.message);
    } catch (_) {
      if (!mounted) return;
      setState(() => _revealing = false);
      _snack('密钥获取失败，请稍后重试');
    }
  }

  Future<void> _copy() async {
    var key = _revealed;
    if (key == null) {
      try {
        key = await PlatformApi.instance.revealKey();
      } on PlatformApiException catch (error) {
        if (!mounted) return;
        _snack(error.message);
        return;
      } catch (_) {
        if (!mounted) return;
        _snack('密钥获取失败，请稍后重试');
        return;
      }
      if (!mounted) return;
      setState(() => _revealed = key);
    }

    await Clipboard.setData(ClipboardData(text: key));
    if (!mounted) return;
    _snack('已复制 API Key');
  }

  Future<void> _confirmReset() async {
    if (_resetting) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        title: Text(
          '重置密钥',
          style: TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w700,
            color: AppColors.danger,
          ),
        ),
        content: Text(
          '重置后旧 Key 会立即失效，已经配置到外部工具里的 Key 也需要更换。\n\n确认继续？',
          style: TextStyle(
            fontSize: 12.5,
            color: AppColors.textMuted,
            height: 1.6,
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: Text('取消', style: TextStyle(color: AppColors.textMuted)),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text('确认重置', style: TextStyle(color: AppColors.danger)),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _resetting = true);
    try {
      final key = await PlatformApi.instance.resetKey();
      if (!mounted) return;
      setState(() {
        _revealed = key;
        _resetting = false;
        _error = null;
      });
      _snack('密钥已重置，旧 Key 已立即失效');
      await _load(showLoading: false);
    } on PlatformApiException catch (error) {
      if (!mounted) return;
      setState(() => _resetting = false);
      _snack(error.message);
    } catch (_) {
      if (!mounted) return;
      setState(() => _resetting = false);
      _snack('重置失败，请稍后重试');
    }
  }

  void _snack(String text) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(text), duration: const Duration(seconds: 2)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final info = _info;
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: AppBackground(
        child: SafeArea(
          bottom: false,
          child: WideContent(
            maxWidth: 760,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
              children: [
                _header(),
                const SizedBox(height: 14),
                if (_loading)
                  Padding(
                    padding: const EdgeInsets.only(top: 60),
                    child: Center(
                      child: CircularProgressIndicator(
                        strokeWidth: 2.4,
                        color: AppColors.brand,
                      ),
                    ),
                  )
                else if (_error != null)
                  _errorCard(_error!)
                else if (info != null) ...[
                  _introCard(),
                  const SizedBox(height: 12),
                  _keyCard(info),
                  const SizedBox(height: 12),
                  _balanceCard(info),
                  if (kIsWeb) const LegacyWebOrders(diamonds: false),
                  const SizedBox(height: 16),
                  _resetButton(),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _header() {
    return Row(
      children: [
        InkWell(
          onTap: () {
            if (Navigator.of(context).canPop()) {
              Navigator.of(context).pop();
            } else {
              Navigator.of(context).pushReplacement(
                MaterialPageRoute(builder: (_) => const HomeShell()),
              );
            }
          },
          borderRadius: BorderRadius.circular(8),
          child: Padding(
            padding: const EdgeInsets.only(right: 8, top: 6, bottom: 6),
            child: Icon(
              Icons.arrow_back_ios_new,
              size: 17,
              color: AppColors.textSub,
              semanticLabel: '返回',
            ),
          ),
        ),
        Text(
          '我的 API Key',
          style: TextStyle(
            fontSize: 21,
            fontWeight: FontWeight.w700,
            color: AppColors.text,
          ),
        ),
      ],
    );
  }

  Widget _introCard() {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.strokeSoft),
        gradient: AppColors.brandGradientSoft,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.info_outline, size: 15, color: AppColors.brand),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              '这把 Key 已自动分配给当前账号，App 内 AI 对话使用它；也可以复制到自己的工具里调用 openelf 的 API。\n\n该余额同时用于 App 内 AI 对话与开放平台 API 调用。',
              style: TextStyle(
                fontSize: 11.5,
                color: AppColors.textSub,
                height: 1.6,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _keyCard(MyKeyInfo info) {
    final revoked = info.revoked;
    final display =
        revoked ? info.apiKeyMasked : (_revealed ?? info.apiKeyMasked);

    return _card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.vpn_key_outlined, size: 14, color: AppColors.brand),
              const SizedBox(width: 6),
              Text(
                '平台 API Key',
                style: TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w600,
                  color: AppColors.brand,
                ),
              ),
              const Spacer(),
              if (revoked)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 7,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(6),
                    color: AppColors.danger.withValues(alpha: 0.12),
                  ),
                  child: Text(
                    '已禁用',
                    style: TextStyle(
                      fontSize: 9.5,
                      fontWeight: FontWeight.w600,
                      color: AppColors.danger,
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 10),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.fromLTRB(12, 10, 8, 4),
            decoration: BoxDecoration(
              color: AppColors.surfaceAlt,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SelectableText(
                  display.isEmpty ? '——' : display,
                  style: TextStyle(
                    fontSize: 12.5,
                    fontFamily: 'monospace',
                    letterSpacing: 0.3,
                    height: 1.5,
                    color: revoked ? AppColors.danger : AppColors.textSub,
                  ),
                ),
                Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    TextButton(
                      onPressed: revoked || _revealing ? null : _toggleReveal,
                      style: _textButtonStyle,
                      child: Text(
                        _revealing ? '读取中…' : (_revealed == null ? '显示' : '隐藏'),
                      ),
                    ),
                    TextButton(
                      onPressed: revoked ? null : _copy,
                      style: _textButtonStyle,
                      child: const Text('复制'),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          Text(
            '创建于 ${_fmtTime(info.createdAt)}'
            '${revoked ? ' · 已禁用于 ${_fmtTime(info.revokedAt)}' : ''}',
            style: TextStyle(fontSize: 10, color: AppColors.textFaint),
          ),
        ],
      ),
    );
  }

  Widget _balanceCard(MyKeyInfo info) {
    final empty = info.balanceMicro <= 0;
    return _card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                Icons.account_balance_wallet_outlined,
                size: 14,
                color: AppColors.cyan,
              ),
              const SizedBox(width: 6),
              Text(
                '账户余额',
                style: TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w600,
                  color: AppColors.cyan,
                ),
              ),
              const Spacer(),
              Text(
                '¥${_yuan(info.balanceMicro)}',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                  color: empty ? AppColors.danger : AppColors.text,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Text(
                '冻结 ¥${_yuan(info.frozenMicro)}',
                style: TextStyle(fontSize: 10.5, color: AppColors.textMuted),
              ),
              const Spacer(),
              Text(
                '累计充值 ¥${_yuan(info.totalTopupMicro)}',
                style: TextStyle(fontSize: 10.5, color: AppColors.textMuted),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Expanded(
                child: Text(
                  !PaymentFeatures.apiTopupEnabled
                      ? '平台 API 账户余额，仅供查看。'
                      : empty
                          ? '余额不足时 AI 只会回复固定话术，外部工具调用会返回 402。点击充值，或联系管理员人工充值。'
                          : '充值到账后可用于 App 内 AI 对话与开放平台 API 调用。',
                  style: TextStyle(
                    fontSize: 10.5,
                    color: empty ? AppColors.danger : AppColors.textMuted,
                    height: 1.5,
                  ),
                ),
              ),
              if (PaymentFeatures.apiTopupEnabled) ...[
                const SizedBox(width: 10),
                _rechargeButton(),
              ],
            ],
          ),
        ],
      ),
    );
  }

  Widget _rechargeButton() {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: _openTopup,
        borderRadius: BorderRadius.circular(9),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          decoration: BoxDecoration(
            gradient: AppColors.brandGradient,
            borderRadius: BorderRadius.circular(9),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.add, size: 14, color: AppColors.onBrand),
              const SizedBox(width: 4),
              Text(
                '充值',
                style: TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w700,
                  color: AppColors.onBrand,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _openTopup({String? initialOrderId}) async {
    if (!PaymentFeatures.apiTopupEnabled) return;
    final paid = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _TopupSheet(initialOrderId: initialOrderId),
    );
    if (!mounted) return;
    if (paid == true) _snack('充值成功，余额已更新');
    await AppState.instance.refreshPlatformBalance();
    if (!mounted) return;
    await _load(showLoading: false);
  }

  Widget _resetButton() {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: _resetting ? null : _confirmReset,
        borderRadius: BorderRadius.circular(13),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 13),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(13),
            border: Border.all(
              color: AppColors.danger.withValues(
                alpha: _resetting ? 0.25 : 0.55,
              ),
            ),
          ),
          child: Center(
            child: Text(
              _resetting ? '重置中…' : '重置密钥',
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: _resetting
                    ? AppColors.danger.withValues(alpha: 0.45)
                    : AppColors.danger,
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _errorCard(String message) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.strokeSoft),
      ),
      child: Column(
        children: [
          Icon(Icons.error_outline, size: 36, color: AppColors.textMuted),
          const SizedBox(height: 10),
          Text(
            message,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 12.5,
              color: AppColors.textMuted,
              height: 1.6,
            ),
          ),
          const SizedBox(height: 8),
          TextButton(onPressed: _retry, child: const Text('重试')),
        ],
      ),
    );
  }

  Widget _card({required Widget child}) {
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 13, 14, 13),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.strokeSoft),
      ),
      child: child,
    );
  }

  ButtonStyle get _textButtonStyle => TextButton.styleFrom(
        foregroundColor: AppColors.brand,
        minimumSize: const Size(0, 30),
        padding: const EdgeInsets.symmetric(horizontal: 8),
        textStyle: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600),
      );

  /// 微元换算成元：正常余额显示两位小数，不足一分钱用「<0.01」表示。
  static String _yuan(int micro) {
    if (micro <= 0) return '0.00';
    if (micro < 10000) return '<0.01';
    return (micro / 1000000).toStringAsFixed(2);
  }

  static String _fmtTime(DateTime? time) {
    if (time == null) return '——';
    final local = time.toLocal();
    String two(int n) => n.toString().padLeft(2, '0');
    return '${local.year}-${two(local.month)}-${two(local.day)} '
        '${two(local.hour)}:${two(local.minute)}';
  }
}

/// 余额充值底部弹层：选档 → 下单 → 拉起支付宝 → 查询/轮询 → 关闭刷新。
class _TopupSheet extends StatefulWidget {
  const _TopupSheet({this.initialOrderId});
  final String? initialOrderId;

  @override
  State<_TopupSheet> createState() => _TopupSheetState();
}

class _TopupSheetState extends State<_TopupSheet> {
  TopupProducts? _catalog;
  String? _selectedId;
  bool _loading = true;
  String? _error;
  bool _busy = false;
  String? _status;
  String? _owner;
  String? _confirmingOrder;

  void _checkOwner() {
    if (!mounted ||
        _owner == null ||
        AppState.instance.currentUser?.id != _owner) {
      throw const PlatformApiException('ACCOUNT_CHANGED', '账号已切换，请重新打开充值页');
    }
  }

  @override
  void initState() {
    super.initState();
    _owner = AppState.instance.currentUser?.id;
    _initialize();
  }

  Future<void> _initialize() async {
    await _loadCatalog();
    if (kIsWeb &&
        mounted &&
        _owner == AppState.instance.currentUser?.id &&
        widget.initialOrderId != null) {
      setState(() {
        _busy = true;
        _status = '正在确认上次支付结果…';
      });
      try {
        await _confirm(widget.initialOrderId!);
      } catch (_) {
        if (mounted) {
          setState(() {
            _busy = false;
            _status = '结果未确认，请稍后查询，勿重复付款';
          });
        }
      }
    }
  }

  Future<void> _loadCatalog() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final catalog = await PlatformApi.instance.topupProducts();
      if (!mounted) return;
      _checkOwner();
      final stored = kIsWeb ? await WebTopupStore.read(_owner!) : null;
      final storedTier = stored?['tier'];
      if (!mounted) return;
      _checkOwner();
      setState(() {
        _catalog = catalog;
        _loading = false;
        if (_selectedId == null && storedTier is String) {
          _selectedId = storedTier;
        }
        if (_selectedId != null &&
            !catalog.products.any((product) => product.id == _selectedId)) {
          _selectedId = null;
        }
      });
    } on PlatformApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.message;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = '充值档位加载失败，请稍后重试';
      });
    }
  }

  TopupProduct? get _selected {
    final products = _catalog?.products ?? const <TopupProduct>[];
    for (final product in products) {
      if (product.id == _selectedId) return product;
    }
    return null;
  }

  bool get _enabled => _catalog?.enabled ?? false;

  bool get _canPay => !_busy && _enabled && _selected != null;

  static String _newRequestId() {
    const alphabet =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    final random = Random.secure();
    final suffix = List.generate(
      4,
      (_) => alphabet[random.nextInt(alphabet.length)],
    ).join();
    return 'topup-${DateTime.now().millisecondsSinceEpoch}-$suffix';
  }

  Future<void> _pay() async {
    final product = _selected;
    final catalog = _catalog;
    if (product == null || catalog == null || !catalog.enabled || _busy) {
      return;
    }

    setState(() {
      _busy = true;
      _status = '正在创建订单…';
    });

    try {
      _checkOwner();
      TopupOrder order;
      try {
        final pending = kIsWeb ? await WebTopupStore.read(_owner!) : null;
        _checkOwner();
        final previousId = pending?['orderId'];
        if (previousId is String) {
          final current = await _refreshOrder(previousId);
          if (current.status == 'paid') {
            _confirmingOrder = previousId;
            await _finishPaid();
            return;
          }
          if (current.status != 'pending') {
            throw PlatformApiException(
              'ORDER_NOT_PAYABLE',
              _statusMessage(current.status),
            );
          }
          order = await PlatformApi.instance.payTopupOrder(previousId);
        } else {
          final requestId = kIsWeb
              ? await WebTopupStore.requestId(_owner!, product.id)
              : _newRequestId();
          _checkOwner();
          order = await PlatformApi.instance.createTopupOrder(
            tierId: product.id,
            requestId: requestId,
          );
        }
      } on PendingTopupException catch (error) {
        final orderId = error.orderId;
        if (orderId == null || orderId.isEmpty) rethrow;
        _checkOwner();
        setState(() => _status = '你有一笔待支付订单，正在继续支付…');
        order = await PlatformApi.instance.payTopupOrder(orderId);
      }

      _checkOwner();
      if (kIsWeb) {
        await WebTopupStore.rememberOrder(_owner!, order.id);
        _checkOwner();
      }
      if (order.status == 'paid') {
        _confirmingOrder = order.id;
        await _finishPaid();
        return;
      }

      if (kIsWeb) {
        final url = WebCheckout.validateQrUrl(
          order.payUrl,
          catalog.mode,
          order.id,
          order.amountFen,
        );
        if (!mounted) return;
        final owner = _owner!;
        _confirmingOrder = order.id;
        final paid = await showWebQrPayment(
          context,
          url: url,
          orderId: order.id,
          amountFen: order.amountFen,
          isOwner: () => mounted && AppState.instance.currentUser?.id == owner,
          query: () async => (await _refreshOrder(order.id)).status,
        );
        if (!mounted) return;
        _checkOwner();
        if (paid) {
          await _finishPaid();
          return;
        }
        setState(() {
          _busy = false;
          _status = '订单已保留，可稍后继续扫码支付';
        });
        return;
      }

      final orderString = order.orderString;
      if (orderString == null) {
        throw const PlatformApiException('INVALID_RESPONSE', '支付订单异常，请稍后重试');
      }

      setState(() => _status = '正在拉起支付宝…');
      final launched = await AlipayService.instance.launchOrderString(
        orderString,
        sandbox: catalog.mode == 'sandbox',
      );
      if (!mounted) return;
      if (!launched) {
        setState(() {
          _busy = false;
          _status = null;
        });
        await _showMessage('已取消支付', '订单仍然保留，可稍后重新发起支付。');
        return;
      }

      setState(() => _status = '正在确认支付结果…');
      await _confirm(order.id);
    } on PlatformApiException catch (error) {
      if (kIsWeb &&
          _owner != null &&
          AppState.instance.currentUser?.id == _owner &&
          ['TOPUP_ORDER_NOT_PAYABLE', 'UNKNOWN_ORDER'].contains(error.code)) {
        final previous = (await WebTopupStore.read(_owner!))?['orderId'];
        if (previous is String) await WebTopupStore.clear(_owner!, previous);
      }
      if (!mounted) return;
      setState(() {
        _busy = false;
        _status = null;
      });
      await _showMessage('支付未完成', error.message);
    } on FormatException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _status = null;
      });
      await _showMessage('支付未完成', error.message.toString());
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _status = null;
      });
      await _showMessage('支付未完成', '请稍后刷新余额确认，勿重复支付。');
    }
  }

  /// 拉起收银台后确认一次；未确认则最多轮询 5 次、每次间隔 3 秒。
  Future<void> _confirm(String orderId) async {
    _checkOwner();
    _confirmingOrder = orderId;
    TopupOrder? order;
    try {
      order = await _refreshOrder(orderId);
    } on PlatformApiException catch (error) {
      if (!_transient(error)) rethrow;
    }
    if (!mounted) return;

    if (order != null) {
      if (order.status == 'paid') {
        await _finishPaid();
        return;
      }
      if (order.status != 'pending') {
        setState(() {
          _busy = false;
          _status = null;
        });
        await _showMessage('支付未完成', _statusMessage(order.status));
        return;
      }
    }

    setState(() => _status = '支付结果确认中，请稍候…');
    for (var attempt = 0; attempt < 5; attempt++) {
      await Future<void>.delayed(const Duration(seconds: 3));
      if (!mounted) return;
      try {
        final next = await _refreshOrder(orderId);
        if (!mounted) return;
        if (next.status == 'paid') {
          await _finishPaid();
          return;
        }
        if (next.status != 'pending') {
          setState(() {
            _busy = false;
            _status = null;
          });
          await _showMessage('支付未完成', _statusMessage(next.status));
          return;
        }
      } on PlatformApiException catch (error) {
        if (!_transient(error)) {
          if (!mounted) return;
          setState(() {
            _busy = false;
            _status = null;
          });
          await _showMessage('支付结果确认失败', error.message);
          return;
        }
        // 503 等临时失败留到下一轮继续查询。
      }
    }

    if (!mounted) return;
    setState(() {
      _busy = false;
      _status = null;
    });
    await _showMessage('支付结果确认中', '服务器暂未确认到账，请稍后下拉刷新余额。');
  }

  /// 付款后的状态查询失败（503 / 网络等）都可以稍后重试；
  /// 只有鉴权和响应格式错误不再轮询。
  static bool _transient(PlatformApiException error) {
    switch (error.code) {
      case 'UNAUTHORIZED':
      case 'ACCOUNT_CHANGED':
      case 'INVALID_RESPONSE':
        return false;
      default:
        return true;
    }
  }

  static String _statusMessage(String status) {
    switch (status) {
      case 'review':
        return '订单需要人工核对，请联系客服，请勿重复支付。';
      case 'closed':
        return '订单已关闭，未完成支付。';
      default:
        return '订单仍待支付，可稍后重新发起。';
    }
  }

  Future<void> _finishPaid() async {
    _checkOwner();
    if (kIsWeb && _confirmingOrder != null) {
      await WebTopupStore.clear(_owner!, _confirmingOrder!);
      _checkOwner();
    }
    unawaited(AppState.instance.refreshPlatformBalance());
    if (!mounted) return;
    Navigator.of(context).pop(true);
  }

  Future<TopupOrder> _refreshOrder(String id) async {
    _checkOwner();
    final order = await PlatformApi.instance.refreshTopupOrder(id);
    _checkOwner();
    if (kIsWeb && order.status == 'closed') {
      await WebTopupStore.clear(_owner!, id);
    }
    return order;
  }

  Future<void> _showMessage(String title, String message) async {
    if (!mounted) return;
    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        title: Text(
          title,
          style: TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w700,
            color: AppColors.text,
          ),
        ),
        content: Text(
          message,
          style: TextStyle(
            fontSize: 12.5,
            color: AppColors.textMuted,
            height: 1.6,
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: Text('知道了', style: TextStyle(color: AppColors.brand)),
          ),
        ],
      ),
    );
  }

  String _priceText(TopupProduct product) {
    final fen = product.priceFen;
    if (fen % 100 == 0) return '${fen ~/ 100}';
    return (fen / 100).toStringAsFixed(2);
  }

  @override
  Widget build(BuildContext context) {
    final selected = _selected;
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(22)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(18, 12, 18, 16),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Center(
                  child: Container(
                    width: 36,
                    height: 4,
                    decoration: BoxDecoration(
                      color: AppColors.stroke,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Text(
                      '充值余额',
                      style: TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w700,
                        color: AppColors.text,
                      ),
                    ),
                    const Spacer(),
                    InkWell(
                      onTap: _busy ? null : () => Navigator.of(context).pop(),
                      borderRadius: BorderRadius.circular(8),
                      child: Padding(
                        padding: const EdgeInsets.all(4),
                        child: Icon(
                          Icons.close,
                          size: 18,
                          color: AppColors.textMuted,
                          semanticLabel: '关闭',
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  '充值到账后可用于 App 内 AI 对话与开放平台 API 调用',
                  style: TextStyle(
                    fontSize: 11.5,
                    color: AppColors.textMuted,
                    height: 1.5,
                  ),
                ),
                const SizedBox(height: 14),
                _catalogBody(),
                if (_status != null) ...[
                  const SizedBox(height: 10),
                  Text(
                    _status!,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 11,
                      color: AppColors.brand,
                      height: 1.5,
                    ),
                  ),
                ],
                const SizedBox(height: 12),
                Opacity(
                  opacity: _canPay ? 1 : 0.45,
                  child: BrandButton(
                    label: _busy
                        ? '处理中…'
                        : selected == null
                            ? '支付宝支付'
                            : '支付宝支付 ¥${_priceText(selected)}',
                    icon: Icons.account_balance_wallet_outlined,
                    onTap: _canPay ? _pay : null,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  '支付结果以服务端确认为准；未支付订单不会扣款。',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 10,
                    color: AppColors.textFaint,
                    height: 1.5,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _catalogBody() {
    if (_loading) {
      return GridView.count(
        crossAxisCount: 2,
        crossAxisSpacing: 10,
        mainAxisSpacing: 10,
        childAspectRatio: 2.2,
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        children: List.generate(
          5,
          (_) => Container(
            decoration: BoxDecoration(
              color: AppColors.surfaceAlt,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppColors.strokeSoft),
            ),
          ),
        ),
      );
    }

    if (_error != null) {
      return Column(
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 18),
            child: Text(
              _error!,
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 12,
                color: AppColors.textMuted,
                height: 1.6,
              ),
            ),
          ),
          TextButton(
            onPressed: _loadCatalog,
            style: TextButton.styleFrom(foregroundColor: AppColors.brand),
            child: const Text('重试'),
          ),
        ],
      );
    }

    final catalog = _catalog;
    if (catalog == null || catalog.products.isEmpty) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 18),
        child: Text(
          '暂无可用充值档位',
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 12, color: AppColors.textMuted),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (!catalog.enabled)
          Container(
            margin: const EdgeInsets.only(bottom: 10),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            decoration: BoxDecoration(
              color: AppColors.warn.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Text(
              '充值通道暂未开启',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: AppColors.warn,
              ),
            ),
          ),
        if (catalog.mode == 'sandbox')
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(
              '沙箱环境 · 非真实收款',
              style: TextStyle(fontSize: 10.5, color: AppColors.textMuted),
            ),
          ),
        GridView.count(
          crossAxisCount: 2,
          crossAxisSpacing: 10,
          mainAxisSpacing: 10,
          childAspectRatio: 2.4,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          children: catalog.products
              .map((product) => _tierTile(product, catalog.enabled))
              .toList(),
        ),
      ],
    );
  }

  Widget _tierTile(TopupProduct product, bool enabled) {
    final selected = product.id == _selectedId;
    final active = enabled && !_busy;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: active ? () => setState(() => _selectedId = product.id) : null,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            color: selected
                ? AppColors.brand.withValues(alpha: 0.12)
                : AppColors.surfaceAlt,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: selected ? AppColors.brand : AppColors.strokeSoft,
              width: selected ? 1.4 : 1,
            ),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '¥${_priceText(product)}',
                style: TextStyle(
                  fontSize: 19,
                  fontWeight: FontWeight.w700,
                  color: active ? AppColors.text : AppColors.textFaint,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
              const SizedBox(height: 2),
              Text(
                '支付宝',
                style: TextStyle(
                  fontSize: 10,
                  color: active ? AppColors.textMuted : AppColors.textFaint,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
