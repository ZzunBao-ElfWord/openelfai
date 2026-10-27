import 'package:flutter/material.dart';

import '../auth/remote_auth_repository.dart';
import '../state/app_state.dart';

/// Old-app receipts stay readable; never re-sign or pay them with the new app.
class LegacyWebOrders extends StatefulWidget {
  const LegacyWebOrders({super.key, required this.diamonds});
  final bool diamonds;
  @override
  State<LegacyWebOrders> createState() => _LegacyWebOrdersState();
}

class _LegacyWebOrdersState extends State<LegacyWebOrders> {
  List<Map<String, dynamic>> _orders = [];
  String? _message, _owner;
  bool _busy = false;
  String get _base =>
      widget.diamonds ? '/api/v1/web/alipay' : '/api/v1/platform/web-topup';
  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final user = AppState.instance.currentUser?.id;
    if (user == null) return;
    try {
      final data = await RemoteAuthRepository.instance.authenticatedRequest(
        '$_base/legacy-orders',
      );
      if (!mounted || AppState.instance.currentUser?.id != user) return;
      final rows = (data['orders'] as List)
          .map((r) => Map<String, dynamic>.from(r as Map))
          .toList();
      setState(() {
        _owner = user;
        _orders = rows;
        _message = null;
      });
    } catch (_) {
      if (mounted && AppState.instance.currentUser?.id == user)
        setState(() => _message = '旧应用订单暂不可读，点击重试；不影响新应用充值');
    }
  }

  Future<void> _query(Map<String, dynamic> row) async {
    final user = AppState.instance.currentUser?.id;
    if (_busy || user == null || user != _owner) return;
    final id = row['id'];
    if (id is! String ||
        !RegExp(widget.diamonds ? r'^OE[a-f0-9]{32}$' : r'^OT[a-f0-9]{32}$')
            .hasMatch(id))
      return;
    setState(() => _busy = true);
    try {
      final result = await RemoteAuthRepository.instance.authenticatedRequest(
        '$_base/orders/$id',
      );
      if (!mounted || AppState.instance.currentUser?.id != user) return;
      if (widget.diamonds)
        AppState.instance.applyPaymentResponse(user, result);
      else
        await AppState.instance.refreshPlatformBalance();
      await _load();
    } catch (_) {
      if (mounted && AppState.instance.currentUser?.id == user)
        setState(() => _message = '旧订单结果仍待确认，记录未删除，请勿重复付款');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_owner != null && _owner != AppState.instance.currentUser?.id)
      return const SizedBox.shrink();
    if (_orders.isEmpty && _message == null) return const SizedBox.shrink();
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '旧网页应用订单核对',
              style: TextStyle(fontWeight: FontWeight.bold),
            ),
            const Text(
              '旧订单仅查单，不重新付款；新订单使用新应用。',
              style: TextStyle(fontSize: 12),
            ),
            if (_message != null) Text(_message!),
            ..._orders.map(
              (r) => ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(
                  '¥${((r['amountFen'] as num) / 100).toStringAsFixed(2)} · ${r['status']}',
                ),
                subtitle: Text(
                  r['id'] as String,
                  style: const TextStyle(fontSize: 10),
                ),
                trailing: TextButton(
                  onPressed: _busy ? null : () => _query(r),
                  child: const Text('查单'),
                ),
              ),
            ),
            TextButton(
              onPressed: _busy ? null : _load,
              child: const Text('刷新旧订单'),
            ),
          ],
        ),
      ),
    );
  }
}
