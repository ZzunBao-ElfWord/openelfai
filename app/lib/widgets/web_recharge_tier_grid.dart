import 'package:flutter/material.dart';

import '../theme.dart';

/// Recharge cards have a bounded width and fixed height, including on desktop.
class WebRechargeTierGrid extends StatelessWidget {
  const WebRechargeTierGrid({
    super.key,
    required this.products,
    required this.onSelected,
  });

  final List<Map<String, dynamic>> products;
  final ValueChanged<Map<String, dynamic>>? onSelected;

  @override
  Widget build(BuildContext context) => Align(
        alignment: Alignment.centerLeft,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 760),
          child: LayoutBuilder(builder: (context, constraints) {
            final columns = constraints.maxWidth >= 600
                ? 3
                : constraints.maxWidth >= 280
                    ? 2
                    : 1;
            return GridView.builder(
              padding: EdgeInsets.zero,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: columns,
                crossAxisSpacing: 12,
                mainAxisSpacing: 12,
                mainAxisExtent: 112,
              ),
              itemCount: products.length,
              itemBuilder: (context, index) {
                final product = products[index];
                return OutlinedButton(
                  key: ValueKey('web-recharge-tier-${product['id']}'),
                  onPressed:
                      onSelected == null ? null : () => onSelected!(product),
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.all(12),
                    backgroundColor: AppColors.surface,
                    side: BorderSide(color: AppColors.stroke),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                  ),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      FittedBox(
                        fit: BoxFit.scaleDown,
                        child: Text(
                          '💎 ${product['diamonds']} 钻石',
                          style: TextStyle(
                            color: onSelected == null
                                ? AppColors.textMuted
                                : AppColors.text,
                            fontSize: 18,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                      const SizedBox(height: 8),
                      FittedBox(
                        fit: BoxFit.scaleDown,
                        child: Text(
                          '¥${((product['priceFen'] as num) / 100).toStringAsFixed(2)}',
                          style: TextStyle(
                            color: onSelected == null
                                ? AppColors.textMuted
                                : AppColors.cyan,
                            fontSize: 17,
                          ),
                        ),
                      ),
                    ],
                  ),
                );
              },
            );
          }),
        ),
      );
}
