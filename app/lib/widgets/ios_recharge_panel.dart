import 'dart:async';

import 'package:flutter/material.dart';

import '../payments/ios_iap_service.dart';
import '../theme.dart';

class IosRechargePanel extends StatefulWidget {
  const IosRechargePanel({super.key});

  @override
  State<IosRechargePanel> createState() => _IosRechargePanelState();
}

class _IosRechargePanelState extends State<IosRechargePanel>
    with WidgetsBindingObserver {
  final _iap = IosIapService.instance;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(_iap.initialize());
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) unawaited(_iap.initialize());
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
        animation: _iap,
        builder: (context, _) => Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(_iap.isSandbox ? '沙盒测试 · 不产生真实扣费' : '通过 App Store 付款',
                style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
            if (_iap.loading) const LinearProgressIndicator(),
            if (_iap.products.isNotEmpty)
              GridView.count(
                crossAxisCount: 2,
                crossAxisSpacing: 10,
                mainAxisSpacing: 10,
                childAspectRatio: 1.6,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                padding: const EdgeInsets.only(top: 12),
                children: _iap.products
                    .map((product) => OutlinedButton(
                          key: ValueKey(product.id),
                          onPressed: _iap.busy || _iap.loading
                              ? null
                              : () async {
                                  try {
                                    await _iap.buy(product.id);
                                  } catch (_) {
                                    if (context.mounted) {
                                      ScaffoldMessenger.of(context)
                                          .showSnackBar(
                                        const SnackBar(
                                            content: Text('暂时无法购买，请刷新后重试')),
                                      );
                                    }
                                  }
                                },
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Text('💎 ${_iap.diamondsFor(product.id)}',
                                  style: TextStyle(
                                      fontSize: 20, color: AppColors.text)),
                              const SizedBox(height: 6),
                              Text(product.price,
                                  style: TextStyle(
                                      color: AppColors.textMuted)),
                            ],
                          ),
                        ))
                    .toList(),
              ),
            if (!_iap.loading && _iap.products.isEmpty)
              Padding(
                padding: EdgeInsets.symmetric(vertical: 12),
                child: Text('充值暂未开放',
                    style: TextStyle(color: AppColors.textMuted)),
              ),
            if (_iap.error != null)
              Text(_iap.error!,
                  style: TextStyle(color: AppColors.textMuted)),
            if (_iap.busy && !_iap.hasUnconfirmed)
              Text('订单处理中，请等待 App Store 确认',
                  style: TextStyle(color: AppColors.textMuted)),
            Wrap(
              spacing: 10,
              children: [
                TextButton(
                  onPressed: _iap.loading ? null : _iap.initialize,
                  child: const Text('刷新商品与余额'),
                ),
                if (_iap.hasUnconfirmed)
                  TextButton(
                    onPressed: _iap.retryUnconfirmed,
                    child: const Text('确认订单'),
                  ),
              ],
            ),
          ],
        ),
      );
}
