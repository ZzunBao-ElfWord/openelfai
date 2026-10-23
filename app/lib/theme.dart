import 'package:flutter/material.dart';

/// v0.3 品牌色直接从应用图标取样：紫 (#7949DD) → 蓝 (#64BAF7)，底色为图标剪影的深海军蓝 (#0C1226)。
/// v1.6 起在不改现有静态值（避免影响 600+ 处引用）的前提下，新增 ThemeMode.system 驱动的明暗双模式骨架。
/// 未迁移的页面继续用 AppColors 静态值；对话页等新页面改用 Theme.of(context).colorScheme 取色。
class AppColors {
  // —— v0.3 brand（保留给未迁移页面）——
  static const Color bg = Color(0xFF0C1226);
  static const Color bgDeep = Color(0xFF070B16);
  static const Color surface = Color(0xFF121A30);
  static const Color surfaceAlt = Color(0xFF18223C);
  static const Color surfaceHigh = Color(0xFF202C4A);
  static const Color stroke = Color(0xFF243050);
  static const Color strokeSoft = Color(0xFF1B2440);

  static const Color violet = Color(0xFF7949DD);
  static const Color violetSoft = Color(0xFFA98DF2);
  static const Color cyan = Color(0xFF64BAF7);
  static const Color cyanSoft = Color(0xFF9AD4FA);

  static const Color text = Color(0xFFE9EFFA);
  static const Color textSub = Color(0xFFA8B5CD);
  static const Color textMuted = Color(0xFF6C7B98);
  static const Color textFaint = Color(0xFF4C5975);

  static const Color ok = Color(0xFF5FD3A6);
  static const Color warn = Color(0xFFE0A868);
  static const Color danger = Color(0xFFE07A6E);

  static const LinearGradient brandGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [violet, cyan],
  );

  static const LinearGradient brandGradientSoft = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFF2A2255), Color(0xFF17344A)],
  );

  // —— v1.6 中性调色板（明暗双模式共用色值，语义上由 brightness 区分）——
  // 参考图的整体感觉：偏灰/偏米白的中性调，不是深海军蓝。

  /// 中性主色（参考图里 AI 名字下划线的暖色）。
  static const Color accent = Color(0xFFC48B7C);

  /// 暗色模式语义色（对话页等新页面优先使用）。
  static const _Dark dark = _Dark();

  /// 亮色模式语义色（对话页等新页面优先使用）。
  static const _Light light = _Light();
}

class _Dark {
  const _Dark();
  final Color bg = const Color(0xFF16161A);
  final Color surface = const Color(0xFF1E1E23);
  final Color surfaceElevated = const Color(0xFF26262C);
  final Color stroke = const Color(0xFF2E2E34);
  final Color text = const Color(0xFFF2EFE9);
  final Color textSub = const Color(0xFFA8A6A0);
  final Color textMuted = const Color(0xFF6E6C68);
  final Color dialogScrim = const Color(0x99000000);
}

class _Light {
  const _Light();
  final Color bg = const Color(0xFFF5F3EF);
  final Color surface = const Color(0xFFFFFFFF);
  final Color surfaceElevated = const Color(0xFFFAF8F4);
  final Color stroke = const Color(0xFFE5E2DC);
  final Color text = const Color(0xFF1A1A1E);
  final Color textSub = const Color(0xFF5A5854);
  final Color textMuted = const Color(0xFF969490);
  final Color dialogScrim = const Color(0x33000000);
}

/// 按当前 ThemeData 的 brightness 取对应变体的便捷扩展。
extension AppThemeColors on BuildContext {
  _Dark get dark => AppColors.dark;
  _Light get light => AppColors.light;
  bool get isDark => Theme.of(this).brightness == Brightness.dark;

  Color get cBg => isDark ? dark.bg : light.bg;
  Color get cSurface => isDark ? dark.surface : light.surface;
  Color get cSurfaceElevated => isDark ? dark.surfaceElevated : light.surfaceElevated;
  Color get cStroke => isDark ? dark.stroke : light.stroke;
  Color get cText => isDark ? dark.text : light.text;
  Color get cTextSub => isDark ? dark.textSub : light.textSub;
  Color get cTextMuted => isDark ? dark.textMuted : light.textMuted;
  Color get cScrim => isDark ? dark.dialogScrim : light.dialogScrim;
}

class AppTheme {
  /// 当前暗色主题（保留现有深海军蓝方案供存量页面）。
  static ThemeData get dark {
    final base = ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      colorScheme: const ColorScheme.dark(
        primary: AppColors.violet,
        onPrimary: Colors.white,
        secondary: AppColors.cyan,
        onSecondary: AppColors.bgDeep,
        surface: AppColors.surface,
        onSurface: AppColors.text,
        outline: AppColors.stroke,
      ),
      scaffoldBackgroundColor: AppColors.bg,
      splashFactory: InkSparkle.splashFactory,
    );

    return _withOverrides(base);
  }

  /// 亮色主题（中性调色板，对话页等新页面可直接用 colorScheme）。
  static ThemeData get light {
    final base = ThemeData(
      useMaterial3: true,
      brightness: Brightness.light,
      colorScheme: ColorScheme.fromSeed(
        seedColor: AppColors.accent,
        brightness: Brightness.light,
        surface: AppColors.light.surface,
        onSurface: AppColors.light.text,
        onPrimary: Colors.white,
      ),
      scaffoldBackgroundColor: AppColors.light.bg,
      splashFactory: InkSparkle.splashFactory,
    );

    return _withOverrides(base);
  }

  static ThemeData _withOverrides(ThemeData base) {
    return base.copyWith(
      appBarTheme: const AppBarTheme(
        backgroundColor: Colors.transparent,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        centerTitle: false,
      ),
      textTheme: base.textTheme.copyWith(
        headlineLarge: base.textTheme.headlineLarge?.copyWith(fontSize: 28, fontWeight: FontWeight.w700, height: 1.25),
        headlineMedium: base.textTheme.headlineMedium?.copyWith(fontSize: 22, fontWeight: FontWeight.w700, height: 1.3),
        headlineSmall: base.textTheme.headlineSmall?.copyWith(fontSize: 18, fontWeight: FontWeight.w600, height: 1.35),
        titleLarge: base.textTheme.titleLarge?.copyWith(fontSize: 16, fontWeight: FontWeight.w600),
        titleMedium: base.textTheme.titleMedium?.copyWith(fontSize: 14, fontWeight: FontWeight.w600),
        bodyLarge: base.textTheme.bodyLarge?.copyWith(fontSize: 15, height: 1.6),
        bodyMedium: base.textTheme.bodyMedium?.copyWith(fontSize: 13.5, height: 1.6),
        bodySmall: base.textTheme.bodySmall?.copyWith(fontSize: 12, height: 1.55),
        labelSmall: base.textTheme.labelSmall?.copyWith(fontSize: 10.5, letterSpacing: 0.6),
      ),
      dividerTheme: const DividerThemeData(thickness: 1, space: 1),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
      bottomSheetTheme: const BottomSheetThemeData(
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
      ),
    );
  }
}
