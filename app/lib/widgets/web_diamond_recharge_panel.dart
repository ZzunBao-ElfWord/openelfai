import 'package:flutter/material.dart';

import '../payments/web_diamond_service.dart';
import '../theme.dart';
import '../payments/web_qr_dialog.dart';
import '../state/app_state.dart';
import 'legacy_web_orders.dart';

class WebDiamondRechargePanel extends StatefulWidget {
  const WebDiamondRechargePanel({super.key});
  @override
  State<WebDiamondRechargePanel> createState() =>
      _WebDiamondRechargePanelState();
}

class _WebDiamondRechargePanelState extends State<WebDiamondRechargePanel> {
  final service = WebDiamondService.instance;
  Future<void> _showQr() async {
    final url = service.checkoutUrl,
        id = service.pendingId,
        amount = service.checkoutAmountFen;
    final owner = AppState.instance.currentUser?.id;
    if (!mounted ||
        url == null ||
        id == null ||
        amount == null ||
        owner == null)
      return;
    await showWebQrPayment(
      context,
      url: url,
      orderId: id,
      amountFen: amount,
      isOwner: () => AppState.instance.currentUser?.id == owner,
      query: () => service.queryOrderStatus(id),
    );
  }

  @override
  void initState() {
    super.initState();
    service.initialize();
  }

  Future<bool> _confirm(String text) async =>
      await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('支付宝扫码付款'),
          content: Text(text),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('取消'),
            ),
            TextButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('显示付款二维码'),
            ),
          ],
        ),
      ) ==
      true;
  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: service,
    builder: (_, __) => Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          '网页钻石充值 · 支付宝',
          style: TextStyle(color: AppColors.textSub, fontSize: 12),
        ),
        const SizedBox(height: 8),
        const LegacyWebOrders(diamonds: true),
        if (service.busy) const LinearProgressIndicator(),
        if (service.message != null)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Text(
              service.message!,
              style: TextStyle(color: AppColors.textMuted, fontSize: 12),
            ),
          ),
        if (!service.busy && service.products.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 12),
            child: Text('充值通道未开启或暂不可用，请稍后刷新'),
          ),
        GridView.count(
          crossAxisCount: 2,
          crossAxisSpacing: 10,
          mainAxisSpacing: 10,
          childAspectRatio: 2.2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          children: service.products
              .map(
                (p) => OutlinedButton(
                  onPressed: service.busy || service.hasPending
                      ? null
                      : () async {
                          if (await _confirm(
                                '充值 ${p['diamonds']} 钻石，金额 ¥${(p['priceFen'] / 100).toStringAsFixed(2)}。\n'
                                '钻石与平台API余额不同，付款结果以服务器确认为准。',
                              ) &&
                              mounted) {
                            await service.pay(p['id'] as String);
                            await _showQr();
                          }
                        },
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        '💎 ${p['diamonds']}',
                        style: TextStyle(color: AppColors.text, fontSize: 18),
                      ),
                      Text(
                        '¥${(p['priceFen'] / 100).toStringAsFixed(2)} · 支付宝',
                      ),
                    ],
                  ),
                ),
              )
              .toList(),
        ),
        if (service.hasPending)
          OutlinedButton(
            onPressed: service.busy
                ? null
                : () async {
                    if (await _confirm('显示已有订单的付款二维码，不会重复创建订单。请核对金额，勿重复付款。') &&
                        mounted) {
                      await service.resume();
                      await _showQr();
                    }
                  },
            child: const Text('继续已有订单'),
          ),
        TextButton(
          onPressed: service.busy ? null : service.initialize,
          child: const Text('刷新钻石余额与订单'),
        ),
      ],
    ),
  );
}
