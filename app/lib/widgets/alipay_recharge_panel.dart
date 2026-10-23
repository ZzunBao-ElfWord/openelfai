import 'dart:async';
import 'package:flutter/material.dart';
import '../payments/alipay_service.dart';
import '../theme.dart';

class AlipayRechargePanel extends StatefulWidget {
  const AlipayRechargePanel({super.key});
  @override
  State<AlipayRechargePanel> createState() => _AlipayRechargePanelState();
}

class _AlipayRechargePanelState extends State<AlipayRechargePanel>
    with WidgetsBindingObserver {
  final _service = AlipayService.instance;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(_service.initialize());
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) unawaited(_service.initialize());
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
      animation: _service,
      builder: (context, _) => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                  _service.mode == 'sandbox'
                      ? '支付宝沙箱测试 · 非真实收款'
                      : '安卓充值 · 仅支持支付宝',
                  style: const TextStyle(
                      color: AppColors.textMuted, fontSize: 12)),
              if (_service.loading) const LinearProgressIndicator(),
              if (!_service.loading && _service.products.isEmpty)
                const Padding(
                    padding: EdgeInsets.symmetric(vertical: 14),
                    child: Text('支付宝充值配置中，暂不能付款',
                        style: TextStyle(color: AppColors.textMuted))),
              if (_service.products.isNotEmpty)
                GridView.count(
                  crossAxisCount: 2,
                  crossAxisSpacing: 10,
                  mainAxisSpacing: 10,
                  childAspectRatio: 1.6,
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  children: _service.products
                      .map((p) => OutlinedButton(
                            onPressed: _service.busy ||
                                    _service.loading ||
                                    _service.hasPending
                                ? null
                                : () async {
                                    final accepted = await showDialog<bool>(
                                        context: context,
                                        builder: (dialog) => AlertDialog(
                                              title: const Text('使用支付宝付款'),
                                              content: Text(
                                                  '将通过支付宝 SDK 购买 ${p['diamonds']} 钻石，金额 ¥${(p['priceFen'] / 100).toStringAsFixed(2)}。付款结果以服务端确认为准。'),
                                              actions: [
                                                TextButton(
                                                    onPressed: () =>
                                                        Navigator.pop(
                                                            dialog, false),
                                                    child: const Text('取消')),
                                                TextButton(
                                                    onPressed: () =>
                                                        Navigator.pop(
                                                            dialog, true),
                                                    child:
                                                        const Text('继续支付宝支付'))
                                              ],
                                            ));
                                    if (accepted == true)
                                      await _service.pay(p['id'] as String);
                                  },
                            child: Column(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Text('💎 ${p['diamonds']}',
                                      style: const TextStyle(
                                          fontSize: 20, color: AppColors.text)),
                                  const SizedBox(height: 6),
                                  Text(
                                      '¥${(p['priceFen'] / 100).toStringAsFixed(2)} · 支付宝'),
                                ]),
                          ))
                      .toList(),
                ),
              if (_service.error != null)
                Text(_service.error!,
                    style: const TextStyle(
                        color: AppColors.textMuted, fontSize: 12)),
              if (_service.hasPending)
                const Text('有待确认订单。取消收银台不等于订单已关闭；未支付订单到期后请刷新。',
                    style: TextStyle(color: AppColors.textMuted, fontSize: 11)),
              TextButton(
                  onPressed: _service.busy || _service.loading
                      ? null
                      : _service.initialize,
                  child: const Text('刷新余额与订单')),
              if (_service.hasPending && _service.products.isNotEmpty)
                TextButton(
                    onPressed: _service.busy || _service.loading
                        ? null
                        : _service.continuePayment,
                    child: const Text('继续原订单的支付宝付款')),
            ],
          ));
}
