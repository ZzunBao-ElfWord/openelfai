import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../compliance/identity_verification.dart';
import '../data/world_data.dart';
import '../models/elf.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'identity_verify_page.dart';
import 'wallet_page.dart';

/// 创作收益：三档余额 + 提现入口 + 提现记录。
///
/// 收益是「平台分成」，只进人类的支付宝收款账户：可以提现，不能转回钻石、
/// 不能转赠给其他用户。规则与额度全部来自服务端快照，这里只负责展示与提交。
class EarningsPage extends StatefulWidget {
  const EarningsPage({super.key});

  @override
  State<EarningsPage> createState() => _EarningsPageState();
}

class _EarningsPageState extends State<EarningsPage> {
  String? _error;
  bool _refreshing = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _refresh());
  }

  Future<void> _refresh() async {
    if (_refreshing) return;
    setState(() => _refreshing = true);
    final error = await AppState.instance.refreshEarnings();
    if (!mounted) return;
    setState(() {
      _refreshing = false;
      _error = error;
    });
  }

  Future<void> _openWithdraw() async {
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => const _WithdrawSheet(),
    );
    if (ok != true || !mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('提现申请已提交，审核通过后到账'),
        duration: Duration(seconds: 3),
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
              final summary = state.creatorEarnings;
              final verified =
                  state.identity?.status == IdentityStatus.verified;
              final signed = summary.agreementAccepted;
              final canWithdraw = verified &&
                  signed &&
                  summary.withdrawalBlockedReason == null &&
                  summary.availableCents >= summary.minWithdrawCents;
              return ListView(
                padding: const EdgeInsets.fromLTRB(20, 0, 20, 28),
                children: [
                  _header(context),
                  const SizedBox(height: 6),
                  _hero(summary),
                  const SizedBox(height: 14),
                  if (_error != null) _errorBanner(_error!),
                  if (summary.withdrawalBlockedReason != null)
                    _errorBanner(summary.withdrawalBlockedReason!),
                  if (!verified)
                    _realNameGate(context)
                  else if (!signed)
                    _agreementGate(context, state)
                  else
                    Opacity(
                      opacity: canWithdraw ? 1 : 0.45,
                      child: BrandButton(
                        label: summary.withdrawalBlockedReason != null
                            ? '收益待核对，暂不可提现'
                            : canWithdraw
                                ? '提现到支付宝'
                                : '满 ¥${_yuan(summary.minWithdrawCents)} 可提现',
                        icon: Icons.account_balance_wallet_outlined,
                        onTap: canWithdraw ? _openWithdraw : null,
                      ),
                    ),
                  const SizedBox(height: 18),
                  _rules(summary),
                  const SizedBox(height: 22),
                  SectionHeader('提现记录',
                      trailing: state.withdrawals.isEmpty
                          ? ''
                          : '${state.withdrawals.length} 笔'),
                  if (state.withdrawals.isEmpty)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      child: Text('还没有提现记录。收益满冷静期后会进入可提现。',
                          style: TextStyle(
                              fontSize: 11.5, color: AppColors.textMuted)),
                    )
                  else
                    ...state.withdrawals.map((row) => _recordRow(row)),
                ],
              );
            },
          ),
        ),
      ),
    );
  }

  Widget _header(BuildContext context) {
    return Row(
      children: [
        IconButton(
          padding: EdgeInsets.zero,
          alignment: Alignment.centerLeft,
          onPressed: () => Navigator.of(context).pop(),
          icon: Icon(Icons.arrow_back_ios_new,
              size: 17, color: AppColors.textSub),
        ),
        Text('创作收益',
            style: TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w700,
                color: AppColors.text)),
        const Spacer(),
        IconButton(
          tooltip: '刷新收益',
          onPressed: _refreshing ? null : _refresh,
          icon: _refreshing
              ? SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(
                      strokeWidth: 2, color: AppColors.textMuted))
              : Icon(Icons.refresh, size: 19, color: AppColors.textMuted),
        ),
      ],
    );
  }

  Widget _hero(EarningsSummary summary) {
    return Container(
      padding: const EdgeInsets.fromLTRB(18, 18, 18, 18),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.strokeSoft),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppColors.violet.withValues(alpha: 0.20),
            AppColors.surface,
          ],
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('可提现',
              style: TextStyle(fontSize: 11, color: AppColors.textMuted)),
          const SizedBox(height: 4),
          Text(_yuan(summary.availableCents),
              style: TextStyle(
                  fontSize: 34,
                  fontWeight: FontWeight.w700,
                  color: AppColors.text)),
          const SizedBox(height: 14),
          Wrap(
            spacing: 22,
            runSpacing: 10,
            children: [
              _stat('待结算', _yuan(summary.pendingCents),
                  '冷静期 ${summary.settleDays} 天'),
              _stat('累计收益', _yuan(summary.lifetimeCents), '平台分成'),
              _stat('已提现', _yuan(summary.withdrawnCents), '不含手续费'),
            ],
          ),
        ],
      ),
    );
  }

  Widget _stat(String label, String value, String hint) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: TextStyle(fontSize: 10, color: AppColors.textFaint)),
        const SizedBox(height: 2),
        Text(value,
            style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: AppColors.textSub)),
        Text(hint, style: TextStyle(fontSize: 9.5, color: AppColors.textFaint)),
      ],
    );
  }

  Widget _errorBanner(String text) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.strokeSoft),
        color: AppColors.surface,
      ),
      child: Row(
        children: [
          Icon(Icons.info_outline, size: 15, color: AppColors.textMuted),
          const SizedBox(width: 8),
          Expanded(
            child: Text(text,
                style: TextStyle(fontSize: 11, color: AppColors.textMuted)),
          ),
        ],
      ),
    );
  }

  Widget _realNameGate(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.strokeSoft),
        color: AppColors.surface,
      ),
      child: Row(
        children: [
          Icon(Icons.badge_outlined, size: 18, color: AppColors.violetSoft),
          const SizedBox(width: 10),
          Expanded(
            child: Text('提现前需完成实名认证，收款账户须与实名本人一致。',
                style: TextStyle(
                    fontSize: 11.5, color: AppColors.textSub, height: 1.5)),
          ),
          const SizedBox(width: 10),
          InkWell(
            borderRadius: BorderRadius.circular(8),
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const IdentityVerifyPage()),
            ),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              child: Text('去认证',
                  style: TextStyle(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w600,
                      color: AppColors.cyan)),
            ),
          ),
        ],
      ),
    );
  }

  /// 创作者服务协议：收益是平台支付的服务费，不是把收到的钻石换回钱。
  Widget _agreementGate(BuildContext context, AppState state) {
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.strokeSoft),
        color: AppColors.surface,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.description_outlined,
                  size: 18, color: AppColors.violetSoft),
              const SizedBox(width: 8),
              Text('创作者服务协议',
                  style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textSub)),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            '你在平台创作获得的收益，是平台按劳务/服务协议向你支付的服务费，'
            '并非把平台币兑换回钱。签署后才能提现，收益不可转让、不可转回钻石。',
            style: TextStyle(
                fontSize: 11, color: AppColors.textMuted, height: 1.6),
          ),
          const SizedBox(height: 10),
          BrandButton(
            label: '阅读并签署协议',
            icon: Icons.check_circle_outline,
            onTap: () => _signAgreement(context, state),
          ),
        ],
      ),
    );
  }

  Future<void> _signAgreement(BuildContext context, AppState state) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        title: Text('签署创作者服务协议',
            style: TextStyle(color: AppColors.text, fontSize: 16)),
        content: Text(
          '平台按你名下 AI 收到的打赏礼物流水结算服务费，收益进入待结算，'
          '冷静期满后转为可提现，提现到本人支付宝。收益属于劳务/服务报酬，'
          '不可转让给其他用户。',
          style:
              TextStyle(fontSize: 12, color: AppColors.textMuted, height: 1.6),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: Text('稍后', style: TextStyle(color: AppColors.textMuted)),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text('同意并签署', style: TextStyle(color: AppColors.cyan)),
          ),
        ],
      ),
    );
    if (confirmed != true || !context.mounted) return;
    final error = await state.signCreatorAgreement();
    if (!context.mounted || error == null) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error)));
  }

  Widget _rules(EarningsSummary summary) {
    final fee = _percent(summary.feeBps);
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.strokeSoft),
        color: AppColors.surface,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('收益规则',
              style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textSub)),
          const SizedBox(height: 6),
          Text(
            '打赏礼物按 ${summary.tipSharePercent}% 结算给创作者，收益进入冷静期 '
            '${summary.settleDays} 天后转为可提现。\n'
            '单笔提现不少于 ¥${_yuan(summary.minWithdrawCents)}，手续费 $fee，'
            '单日上限 ¥${_yuan(summary.dailyLimitCents)}。\n'
            '收益是平台支付的服务费：可提现到本人支付宝，不可转让、不可转赠，也不能兑换回钻石。',
            style: TextStyle(
                fontSize: 10.5, color: AppColors.textMuted, height: 1.6),
          ),
          const SizedBox(height: 10),
          InkWell(
            borderRadius: BorderRadius.circular(8),
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const WalletPage()),
            ),
            child: Text('充值钻石与流水 →',
                style: TextStyle(fontSize: 11, color: AppColors.violetSoft)),
          ),
        ],
      ),
    );
  }

  Widget _recordRow(WithdrawalRecord row) {
    final status = _statusLabel(row.status);
    final color = switch (row.status) {
      'paid' => AppColors.cyan,
      'failed' || 'rejected' => const Color(0xFFE8A33D),
      _ => AppColors.textSub,
    };
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.strokeSoft),
        color: AppColors.surface,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(_yuan(row.netCents),
                  style: TextStyle(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w600,
                      color: AppColors.text)),
              const SizedBox(width: 8),
              Text(status,
                  style: TextStyle(
                      fontSize: 10.5,
                      fontWeight: FontWeight.w600,
                      color: color)),
              const Spacer(),
              Text(_time(row.createdAt),
                  style: TextStyle(fontSize: 10, color: AppColors.textFaint)),
            ],
          ),
          const SizedBox(height: 3),
          Text(
            '申请 ${_yuan(row.amountCents)} · 手续费 ${_yuan(row.feeCents)} · '
            '${_maskAccount(row.account)}',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(fontSize: 10, color: AppColors.textMuted),
          ),
          if (row.failureReason != null && row.failureReason!.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 3),
              child: Text(row.failureReason!,
                  style: TextStyle(fontSize: 10, color: color)),
            ),
        ],
      ),
    );
  }

  static String _statusLabel(String status) => switch (status) {
        'pending_review' => '审核中',
        'paying' => '出款中',
        'pending_reconciliation' => '待查证 · 额度冻结',
        'paid' => '已到账',
        'failed' => '出款失败 · 已退回',
        'rejected' => '未通过 · 已退回',
        _ => status,
      };

  static String _maskAccount(String account) {
    if (account.isEmpty) return '——';
    if (account.contains('@')) {
      final at = account.indexOf('@');
      return at <= 1
          ? account
          : '${account.substring(0, 1)}***${account.substring(at)}';
    }
    if (account.length >= 7) {
      return '${account.substring(0, 3)}****${account.substring(account.length - 4)}';
    }
    return account;
  }

  static String _time(String iso) {
    final dt = DateTime.tryParse(iso)?.toLocal();
    if (dt == null) return iso;
    String two(int value) => value.toString().padLeft(2, '0');
    return '${dt.year}-${two(dt.month)}-${two(dt.day)} '
        '${two(dt.hour)}:${two(dt.minute)}';
  }

  static String _percent(int bps) {
    final value = (bps / 100).toStringAsFixed(2);
    return '${value.endsWith('.00') ? value.substring(0, value.length - 3) : value}%';
  }

  static String _yuan(int cents) => WorldData.formatYuan(cents / 100);
}

/// 提现表单：金额（元）+ 支付宝登录号。错误就地展示，避免被弹层遮挡。
class _WithdrawSheet extends StatefulWidget {
  const _WithdrawSheet();

  @override
  State<_WithdrawSheet> createState() => _WithdrawSheetState();
}

class _WithdrawSheetState extends State<_WithdrawSheet> {
  final _amountCtrl = TextEditingController();
  final _accountCtrl = TextEditingController();
  String? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    final phone = AppState.instance.currentUser?.phone ?? '';
    _accountCtrl.text = phone;
  }

  @override
  void dispose() {
    _amountCtrl.dispose();
    _accountCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final state = AppState.instance;
    final summary = state.creatorEarnings;
    final amount = double.tryParse(_amountCtrl.text.trim());
    final cents = amount == null ? 0 : (amount * 100).round();
    final account = _accountCtrl.text.trim();
    if (cents < summary.minWithdrawCents) {
      setState(() => _error = '单笔提现不少于 ¥${_yuan(summary.minWithdrawCents)}');
      return;
    }
    if (cents > summary.availableCents) {
      setState(() => _error = '超过可提现余额 ${_yuan(summary.availableCents)}');
      return;
    }
    if (account.isEmpty) {
      setState(() => _error = '请填写支付宝登录手机号或邮箱');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final error =
        await state.requestWithdrawal(amountCents: cents, account: account);
    if (!mounted) return;
    if (error != null) {
      setState(() {
        _busy = false;
        _error = error;
      });
      return;
    }
    Navigator.of(context).pop(true);
  }

  static String _yuan(int cents) => WorldData.formatYuan(cents / 100);

  @override
  Widget build(BuildContext context) {
    final summary = AppState.instance.creatorEarnings;
    // 表单以元输入，这里按实时金额估算手续费，仅作提示。
    final amount = double.tryParse(_amountCtrl.text.trim());
    final estimate = amount == null || amount <= 0
        ? 0
        : summary.withdrawalFeeCents((amount * 100).round());
    return Padding(
      padding: EdgeInsets.only(
        bottom: MediaQuery.of(context).viewInsets.bottom,
      ),
      child: Container(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
        decoration: BoxDecoration(
          color: AppColors.bg,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
          border: Border.all(color: AppColors.strokeSoft),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text('提现到支付宝',
                    style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: AppColors.text)),
                const Spacer(),
                InkWell(
                  onTap: _busy ? null : () => Navigator.of(context).pop(),
                  borderRadius: BorderRadius.circular(8),
                  child: Padding(
                    padding: const EdgeInsets.all(4),
                    child:
                        Icon(Icons.close, size: 18, color: AppColors.textMuted),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
                '可提现 ${_yuan(summary.availableCents)} · 手续费 ${summary.feeBps / 100}%',
                style: TextStyle(fontSize: 10.5, color: AppColors.textMuted)),
            const SizedBox(height: 14),
            _field(
              controller: _amountCtrl,
              label: '提现金额（元）',
              hint: '不少于 ¥${_yuan(summary.minWithdrawCents)}',
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              onChanged: (_) => setState(() => _error = null),
            ),
            const SizedBox(height: 10),
            _field(
              controller: _accountCtrl,
              label: '支付宝登录号',
              hint: '支付宝绑定的手机号或邮箱',
              keyboardType: TextInputType.text,
              onChanged: (_) => setState(() => _error = null),
            ),
            const SizedBox(height: 8),
            Text(
              estimate > 0
                  ? '预计手续费 ${_yuan(estimate)}，到账 ${_yuan((amount! * 100).round() - estimate)}'
                  : '手续费按 ${summary.feeBps / 100}% 收取，从提现金额中扣除。',
              style: TextStyle(fontSize: 10, color: AppColors.textFaint),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(_error!,
                    style: const TextStyle(
                        fontSize: 11, color: Color(0xFFE8A33D))),
              ),
            const SizedBox(height: 16),
            Opacity(
              opacity: _busy ? 0.5 : 1,
              child: BrandButton(
                label: _busy ? '提交中…' : '提交提现申请',
                onTap: _busy ? null : _submit,
              ),
            ),
            const SizedBox(height: 8),
            Text('提交后进入人工审核，出款成功即到账；失败会自动把额度退回可提现。',
                style: TextStyle(fontSize: 10, color: AppColors.textFaint)),
          ],
        ),
      ),
    );
  }

  Widget _field({
    required TextEditingController controller,
    required String label,
    required String hint,
    required TextInputType keyboardType,
    required ValueChanged<String> onChanged,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label,
            style: TextStyle(fontSize: 10.5, color: AppColors.textMuted)),
        const SizedBox(height: 4),
        TextField(
          controller: controller,
          keyboardType: keyboardType,
          onChanged: onChanged,
          style: TextStyle(fontSize: 13, color: AppColors.text),
          inputFormatters: keyboardType == TextInputType.text
              ? null
              : [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))],
          decoration: InputDecoration(
            isDense: true,
            hintText: hint,
            hintStyle: TextStyle(fontSize: 12, color: AppColors.textFaint),
            contentPadding:
                const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
            filled: true,
            fillColor: AppColors.surface,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10),
              borderSide: BorderSide(color: AppColors.strokeSoft),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10),
              borderSide: BorderSide(color: AppColors.strokeSoft),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10),
              borderSide: BorderSide(color: AppColors.violet),
            ),
          ),
        ),
      ],
    );
  }
}
