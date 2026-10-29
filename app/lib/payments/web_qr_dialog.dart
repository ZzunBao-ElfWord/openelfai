import 'dart:async';

import 'package:flutter/material.dart';

import 'web_checkout.dart';
import 'order_status_text.dart';
import 'web_qr_frame_stub.dart'
    if (dart.library.js_interop) 'web_qr_frame_web.dart';

Future<bool> showWebQrPayment(
  BuildContext context, {
  required String url,
  required String orderId,
  required int amountFen,
  required bool Function() isOwner,
  required Future<String> Function() query,
}) async {
  final safe = WebCheckout.validateQrUrl(url, 'production', orderId, amountFen);
  return await showDialog<bool>(
        context: context,
        barrierDismissible: false,
        builder: (_) => _QrDialog(
          url: safe,
          orderId: orderId,
          amountFen: amountFen,
          isOwner: isOwner,
          query: query,
        ),
      ) ==
      true;
}

class _QrDialog extends StatefulWidget {
  const _QrDialog({
    required this.url,
    required this.orderId,
    required this.amountFen,
    required this.isOwner,
    required this.query,
  });
  final String url, orderId;
  final int amountFen;
  final bool Function() isOwner;
  final Future<String> Function() query;
  @override
  State<_QrDialog> createState() => _QrDialogState();
}

class _QrDialogState extends State<_QrDialog> {
  Timer? _timer;
  bool _busy = false, _terminal = false;
  String _message = '请用支付宝扫一扫，付款后自动确认到账';
  final _started = DateTime.now();
  late final Widget _frame = webQrFrame(widget.url);
  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 4), (_) => _check());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _check() async {
    if (_busy || _terminal || !mounted) return;
    if (!widget.isOwner()) {
      _timer?.cancel();
      Navigator.pop(context, false);
      return;
    }
    if (DateTime.now().difference(_started).inMinutes >= 15) {
      _timer?.cancel();
      setState(() {
        _terminal = true;
        _message = '本次扫码会话已结束，请关闭后刷新订单状态，不要重复付款';
      });
      return;
    }
    setState(() => _busy = true);
    try {
      final status = await widget.query();
      if (!mounted) return;
      if (!widget.isOwner()) {
        Navigator.pop(context, false);
        return;
      }
      if (status == 'paid') {
        Navigator.pop(context, true);
        return;
      }
      if ([
        'closed',
        'refunded',
        'review',
        'expired',
        'failed',
      ].contains(status)) {
        _timer?.cancel();
        _terminal = true;
        _message = OrderStatusText.message(status);
      } else {
        _message = '等待付款确认。扫码或关闭弹窗不代表已到账';
      }
    } catch (_) {
      if (!mounted) return;
      _message = '暂未确认支付结果，稍后自动重试；不要重复付款';
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: Text('支付宝扫码付款 ¥${(widget.amountFen / 100).toStringAsFixed(2)}'),
        content: SizedBox(
          width: 280,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (!_terminal)
                  SizedBox(
                    height: 280,
                    width: 280,
                    child: ColoredBox(color: Colors.white, child: _frame),
                  ),
                const SizedBox(height: 10),
                Text(_message),
                const SizedBox(height: 8),
                Text('订单：${widget.orderId}',
                    style: const TextStyle(fontSize: 10)),
                const Text(
                  '付款遇到问题，请稍后重试或联系客服；已付款请勿重复支付。',
                  style: TextStyle(fontSize: 11),
                ),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('关闭并保留订单'),
          ),
          TextButton(
            onPressed: _busy || _terminal ? null : _check,
            child: Text(_busy ? '查询中…' : '我已付款，查询到账'),
          ),
        ],
      );
}
