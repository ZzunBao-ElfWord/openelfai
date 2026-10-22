import 'package:flutter/material.dart';
import '../models/elf.dart';
import '../theme.dart';

/// 全屏底色：深海军蓝 + 左上紫光、右下青光，与品牌图标同一个方向。
class AppBackground extends StatelessWidget {
  final Widget child;
  const AppBackground({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    return Container(
      color: AppColors.bg,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Positioned(
            top: -180,
            left: -140,
            child: IgnorePointer(
              ignoring: true,
              child: _Glow(color: AppColors.violet.withOpacity(0.20), size: 420),
            ),
          ),
          Positioned(
            bottom: -200,
            right: -160,
            child: IgnorePointer(
              ignoring: true,
              child: _Glow(color: AppColors.cyan.withOpacity(0.16), size: 460),
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
  final Gradient gradient;
  final Color fill;

  const GradientBorderBox({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(1),
    this.radius = 16,
    this.gradient = AppColors.brandGradient,
    this.fill = AppColors.surface,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: padding,
      decoration: BoxDecoration(
        gradient: gradient,
        borderRadius: BorderRadius.circular(radius),
      ),
      child: Container(
        decoration: BoxDecoration(
          color: fill,
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
          Icon(icon, size: 16, color: AppColors.bgDeep),
          const SizedBox(width: 7),
        ],
        Text(
          label,
          style: const TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w700,
            color: AppColors.bgDeep,
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
                style: const TextStyle(
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
      child: Text(
        elf.initial,
        style: TextStyle(
          fontSize: size * 0.45,
          fontWeight: FontWeight.w700,
          color: AppColors.bgDeep,
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
          Text(title, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.text)),
          const Spacer(),
          if (trailing != null)
            GestureDetector(
              onTap: onTrailingTap,
              child: Text(
                trailing!,
                style: const TextStyle(fontSize: 11, color: AppColors.textMuted),
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
          style: const TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w700,
            color: AppColors.text,
            fontFeatures: [FontFeature.tabularFigures()],
          ),
        ),
        const SizedBox(height: 2),
        Text(label, style: const TextStyle(fontSize: 10, color: AppColors.textMuted)),
      ],
    );
  }
}
