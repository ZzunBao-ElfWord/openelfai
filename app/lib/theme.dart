import 'package:flutter/material.dart';

/// v0.3 品牌色直接从应用图标取样：紫 (#7949DD) → 蓝 (#64BAF7)，底色为图标剪影的深海军蓝 (#0C1226)。
/// 旧字段（paper / ink / primary 等）保留，供尚未移除的工具图鉴页面继续编译。
class AppColors {
  // —— v0.3 brand ——
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
}

class AppTheme {
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

    return base.copyWith(
      appBarTheme: const AppBarTheme(
        backgroundColor: Colors.transparent,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        foregroundColor: AppColors.text,
        centerTitle: false,
      ),
      textTheme: const TextTheme(
        headlineLarge: TextStyle(fontSize: 28, fontWeight: FontWeight.w700, color: AppColors.text, height: 1.25),
        headlineMedium: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: AppColors.text, height: 1.3),
        headlineSmall: TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: AppColors.text, height: 1.35),
        titleLarge: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: AppColors.text),
        titleMedium: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: AppColors.text),
        bodyLarge: TextStyle(fontSize: 15, color: AppColors.textSub, height: 1.6),
        bodyMedium: TextStyle(fontSize: 13.5, color: AppColors.textSub, height: 1.6),
        bodySmall: TextStyle(fontSize: 12, color: AppColors.textMuted, height: 1.55),
        labelSmall: TextStyle(fontSize: 10.5, letterSpacing: 0.6, color: AppColors.textMuted),
      ),
      dividerTheme: const DividerThemeData(color: AppColors.strokeSoft, thickness: 1, space: 1),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: AppColors.surfaceHigh,
        contentTextStyle: const TextStyle(color: AppColors.text, fontSize: 13),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: AppColors.surface,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
      ),
    );
  }
}
