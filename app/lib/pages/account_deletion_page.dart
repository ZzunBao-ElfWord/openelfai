import 'package:flutter/material.dart';
import '../auth/auth_repository.dart';
import '../theme.dart';

class AccountDeletionPage extends StatefulWidget {
  final AuthRepository auth;
  final Future<void> Function() onDeleted;

  const AccountDeletionPage({super.key, required this.auth, required this.onDeleted});

  @override
  State<AccountDeletionPage> createState() => _AccountDeletionPageState();
}

class _AccountDeletionPageState extends State<AccountDeletionPage> {
  bool _agreed = false;
  bool _busy = false;
  String? _error;

  Future<void> _submit() async {
    if (_busy || !_agreed) return;
    setState(() { _busy = true; _error = null; });
    try {
      await widget.auth.deleteAccount();
      await widget.onDeleted();
      if (!mounted) return;
      setState(() => _busy = false);
      await WidgetsBinding.instance.endOfFrame;
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = switch (error) {
          AuthException(code: 'ACCOUNT_UNSETTLED') =>
            '账号还有余额、待确认订单或未结算收益，请先处理后再注销。',
          AuthException(code: 'NETWORK_ERROR') =>
            '网络连接失败，注销未完成，请检查网络后重试。',
          AuthException(code: 'UNAUTHORIZED' || 'SESSION_EXPIRED' || 'SESSION_REVOKED') =>
            '登录已失效，请重新登录后注销账号。',
          _ => '暂时无法完成注销，请稍后重试。',
        };
      });
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !_busy,
    child: Scaffold(
      backgroundColor: AppColors.bg,
      appBar: AppBar(title: const Text('注销账号')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            Icon(Icons.person_off_outlined, size: 48, color: AppColors.warn),
            const SizedBox(height: 20),
            Text('注销后无法恢复', style: TextStyle(
              fontSize: 22, fontWeight: FontWeight.w700, color: AppColors.text)),
            const SizedBox(height: 16),
            Text('个人资料、实名认证信息、AI、聊天和发布内容将被清除；所有设备将退出登录，API Key 将失效。\n\n'
              '剩余钻石将不再可用。有余额、待确认订单或未结算收益时，需要先完成处理。交易与账务记录保留用于对账。\n\n'
              '同一手机号再次注册会创建新账号，无法恢复原账号的数据与资产。',
              style: TextStyle(color: AppColors.textSub, height: 1.7)),
            const SizedBox(height: 20),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              controlAffinity: ListTileControlAffinity.leading,
              title: const Text('我已了解后果，确认注销此账号'),
              value: _agreed,
              onChanged: _busy ? null : (value) => setState(() => _agreed = value ?? false),
            ),
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(_error!, style: TextStyle(color: AppColors.warn),
                semanticsLabel: _error, key: const Key('account-deletion-error')),
            ],
            const SizedBox(height: 20),
            FilledButton(
              key: const Key('confirm-account-deletion'),
              style: FilledButton.styleFrom(backgroundColor: AppColors.warn),
              onPressed: !_agreed || _busy ? null : _submit,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: _busy
                  ? const Row(mainAxisSize: MainAxisSize.min, children: [
                      SizedBox(width: 18, height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2)),
                      SizedBox(width: 10), Text('正在注销…'),
                    ])
                  : const Text('确认注销账号'),
              ),
            ),
          ],
        ),
      ),
    ),
  );
}
