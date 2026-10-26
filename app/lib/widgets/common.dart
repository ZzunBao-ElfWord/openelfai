import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../models/elf.dart';
import '../theme.dart';

/// 桌面宽屏内容限宽：视口超过 [breakpoint] 时内容居中并限制为 [maxWidth]，
/// 窄视口（手机/平板）原样返回。用于 Web 桌面端的响应式适配。
class WideContent extends StatelessWidget {
  final Widget child;
  final double maxWidth;
  const WideContent({super.key, required this.child, this.maxWidth = 760});

  static const double breakpoint = 900;

  static bool isWide(BuildContext context) =>
      MediaQuery.sizeOf(context).width > breakpoint;

  @override
  Widget build(BuildContext context) {
    if (!isWide(context)) return child;
    return Align(
      alignment: Alignment.topCenter,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxWidth),
        child: SizedBox(width: double.infinity, child: child),
      ),
    );
  }
}

/// 全屏底色：深海军蓝 + 左上紫光、右下青光，与品牌图标同一个方向。
class AppBackground extends StatelessWidget {
  final Widget child;
  const AppBackground({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    final p = AppColors.palette;
    return Container(
      color: p.bg,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Positioned(
            top: -180,
            left: -140,
            child: IgnorePointer(
              ignoring: true,
              child: _Glow(
                color: p.glowA.withValues(alpha: p.glowAOpacity),
                size: 420,
              ),
            ),
          ),
          Positioned(
            bottom: -200,
            right: -160,
            child: IgnorePointer(
              ignoring: true,
              child: _Glow(
                color: p.glowB.withValues(alpha: p.glowBOpacity),
                size: 460,
              ),
            ),
          ),
          child,
        ],
      ),
    );
  }
}

class _Glow extends StatelessWidget {
  final Color color;
  final double size;
  const _Glow({required this.color, required this.size});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: RadialGradient(
          colors: [color, color.withOpacity(0)],
        ),
      ),
    );
  }
}

class GradientBorderBox extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;
  final double radius;
  final Gradient? gradient;
  final Color? fill;

  const GradientBorderBox({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(1),
    this.radius = 16,
    this.gradient,
    this.fill,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: padding,
      decoration: BoxDecoration(
        gradient: gradient ?? AppColors.brandGradient,
        borderRadius: BorderRadius.circular(radius),
      ),
      child: Container(
        decoration: BoxDecoration(
          color: fill ?? AppColors.surface,
          borderRadius: BorderRadius.circular(radius - padding.horizontal > 0 ? radius - padding.horizontal * 2 : 0),
        ),
        child: child,
      ),
    );
  }
}

class BrandButton extends StatelessWidget {
  final String label;
  final VoidCallback? onTap;
  final bool expand;
  final IconData? icon;

  const BrandButton({
    super.key,
    required this.label,
    this.onTap,
    this.expand = true,
    this.icon,
  });

  @override
  Widget build(BuildContext context) {
    final child = Row(
      mainAxisSize: expand ? MainAxisSize.max : MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        if (icon != null) ...[
          Icon(icon, size: 16, color: AppColors.onBrand),
          const SizedBox(width: 7),
        ],
        Text(
          label,
          style: TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w700,
            color: AppColors.onBrand,
            letterSpacing: 0.2,
          ),
        ),
      ],
    );

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(13),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 13, horizontal: 18),
          decoration: BoxDecoration(
            gradient: AppColors.brandGradient,
            borderRadius: BorderRadius.circular(13),
          ),
          child: child,
        ),
      ),
    );
  }
}

class GhostButton extends StatelessWidget {
  final String label;
  final VoidCallback? onTap;
  final IconData? icon;

  const GhostButton({super.key, required this.label, this.onTap, this.icon});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(13),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 13, horizontal: 16),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(13),
            border: Border.all(color: AppColors.stroke),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[
                Icon(icon, size: 15, color: AppColors.textSub),
                const SizedBox(width: 6),
              ],
              Text(
                label,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textSub,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class ElfAvatar extends StatelessWidget {
  final Elf elf;
  final double size;
  const ElfAvatar({super.key, required this.elf, this.size = 40});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(size * 0.3),
        gradient: AppColors.brandGradient,
      ),
      alignment: Alignment.center,
      clipBehavior: Clip.antiAlias,
      child: elf.avatarUrl == null
          ? Text(
              elf.initial,
              style: TextStyle(
                fontSize: size * 0.45,
                fontWeight: FontWeight.w700,
                color: AppColors.onBrand,
              ),
            )
          : Image.network(
              elf.avatarUrl!,
              width: size,
              height: size,
              fit: BoxFit.cover,
              // 形象图加载失败仍回落到首字头像，避免出现空框。
              errorBuilder: (_, __, ___) => Text(
                elf.initial,
                style: TextStyle(
                  fontSize: size * 0.45,
                  fontWeight: FontWeight.w700,
                  color: AppColors.onBrand,
                ),
              ),
            ),
    );
  }
}

class StatusChip extends StatelessWidget {
  final ElfStatus status;
  const StatusChip({super.key, required this.status});

  @override
  Widget build(BuildContext context) {
    final label = switch (status) {
      ElfStatus.active => '活跃',
      ElfStatus.lowEnergy => '低能',
      ElfStatus.sleeping => '休眠',
    };
    final color = switch (status) {
      ElfStatus.active => AppColors.cyan,
      ElfStatus.lowEnergy => AppColors.warn,
      ElfStatus.sleeping => AppColors.textFaint,
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: color.withOpacity(0.15),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Text(
        label,
        style: TextStyle(fontSize: 9.5, fontWeight: FontWeight.w600, color: color),
      ),
    );
  }
}

class SectionHeader extends StatelessWidget {
  final String title;
  final String? trailing;
  final VoidCallback? onTrailingTap;

  const SectionHeader(this.title, {super.key, this.trailing, this.onTrailingTap});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10, top: 22),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.baseline,
        textBaseline: TextBaseline.alphabetic,
        children: [
          Text(title, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.text)),
          const Spacer(),
          if (trailing != null)
            GestureDetector(
              onTap: onTrailingTap,
              child: Text(
                trailing!,
                style: TextStyle(fontSize: 11, color: AppColors.textMuted),
              ),
            ),
        ],
      ),
    );
  }
}

class StatTile extends StatelessWidget {
  final String value;
  final String label;
  const StatTile({super.key, required this.value, required this.label});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          value,
          style: TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w700,
            color: AppColors.text,
            fontFeatures: [FontFeature.tabularFigures()],
          ),
        ),
        const SizedBox(height: 2),
        Text(label, style: TextStyle(fontSize: 10, color: AppColors.textMuted)),
      ],
    );
  }
}

/// AI 专属地址卡。真实余额归人类账号统一支付，卡片只展示地址。
/// 用于我的 AI 卡和 AI 详情页。
class ElfWalletCard extends StatelessWidget {
  final String? chainAddress;

  const ElfWalletCard({
    super.key,
    this.chainAddress,
  });

  @override
  Widget build(BuildContext context) {
    final addr = chainAddress ?? '';
    final short = addr.length > 13
        ? '${addr.substring(0, 6)}…${addr.substring(addr.length - 4)}'
        : addr;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(10),
        color: AppColors.surfaceAlt,
        border: Border.all(color: AppColors.strokeSoft),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(4),
                  gradient: LinearGradient(
                    colors: [
                      AppColors.cyan.withValues(alpha: 0.7),
                      AppColors.violet.withValues(alpha: 0.7)
                    ],
                  ),
                ),
                child: Text(
                  'AI 专属地址 · 钱包',
                  style: TextStyle(
                      fontSize: 9,
                      fontWeight: FontWeight.w700,
                      color: AppColors.onBrand),
                ),
              ),
              const Spacer(),
              // 复制地址
              if (addr.isNotEmpty)
                InkWell(
                  onTap: () {
                    Clipboard.setData(ClipboardData(text: addr));
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                          content: Text('已复制 AI 专属地址'),
                          duration: Duration(seconds: 2)),
                    );
                  },
                  borderRadius: BorderRadius.circular(6),
                  child: Padding(
                    padding: EdgeInsets.all(4),
                    child: Icon(Icons.copy_outlined,
                        size: 13,
                        color: AppColors.textMuted,
                        semanticLabel: '复制 AI 专属地址'),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            short.isEmpty ? '——' : short,
            style: TextStyle(
                fontSize: 11,
                color: AppColors.textSub,
                fontFamily: 'monospace',
                letterSpacing: 0.5),
          ),
        ],
      ),
    );
  }
}
