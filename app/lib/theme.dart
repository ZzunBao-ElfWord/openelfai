import 'package:flutter/material.dart';

class AppColors {
  static const Color primary = Color(0xFF2E7A58);
  static const Color primaryDark = Color(0xFF1F5740);
  static const Color primaryLight = Color(0xFFE8F3ED);
  static const Color accent = Color(0xFFF5B841);
  static const Color accentDark = Color(0xFFD99A1F);

  static const Color paper = Color(0xFFF5F2E9);
  static const Color card = Colors.white;
  static const Color ink = Color(0xFF232E28);
  static const Color inkSoft = Color(0xFF667061);
  static const Color inkFaint = Color(0xFF979F90);
  static const Color line = Color(0xFFE3DECE);
  static const Color lineStrong = Color(0xFFD3CDBA);

  static const Color cn = Color(0xFFB4432E);
  static const Color cnDeep = Color(0xFF9A3623);
  static const Color cnSoft = Color(0xFFF9EDE6);

  static const Color os = Color(0xFF33598C);
  static const Color osDeep = Color(0xFF28466F);
  static const Color osSoft = Color(0xFFEBF1F8);
}

class AppTheme {
  static ThemeData get light {
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.light,
      colorScheme: const ColorScheme.light(
        primary: AppColors.primary,
        onPrimary: Colors.white,
        secondary: AppColors.accent,
        onSecondary: AppColors.ink,
        surface: AppColors.paper,
        onSurface: AppColors.ink,
        outline: AppColors.line,
      ),
      scaffoldBackgroundColor: AppColors.paper,
      appBarTheme: const AppBarTheme(
        backgroundColor: AppColors.paper,
        foregroundColor: AppColors.ink,
        elevation: 0,
        centerTitle: true,
        surfaceTintColor: Colors.transparent,
      ),
      cardTheme: CardTheme(
        color: AppColors.card,
        elevation: 0,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.card,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide.none,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide.none,
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppColors.primary, width: 1.5),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.primary,
          foregroundColor: Colors.white,
          elevation: 0,
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
        ),
      ),
      textTheme: const TextTheme(
        headlineLarge: TextStyle(fontSize: 28, fontWeight: FontWeight.bold, color: AppColors.ink, height: 1.2),
        headlineMedium: TextStyle(fontSize: 22, fontWeight: FontWeight.bold, color: AppColors.ink, height: 1.3),
        headlineSmall: TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: AppColors.ink, height: 1.3),
        titleLarge: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: AppColors.ink),
        titleMedium: TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: AppColors.ink),
        bodyLarge: TextStyle(fontSize: 15, color: AppColors.ink, height: 1.6),
        bodyMedium: TextStyle(fontSize: 14, color: AppColors.inkSoft, height: 1.6),
        bodySmall: TextStyle(fontSize: 12, color: AppColors.inkFaint, height: 1.5),
      ),
    );
  }
}
