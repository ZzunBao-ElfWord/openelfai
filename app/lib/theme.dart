import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// 品牌蓝的完整色阶。所有页面统一从这里取色，不再硬编码深海军蓝。
/// 品牌色保持不变：蓝色系（暗色用亮蓝，亮色用标准蓝），青色只作为第二强调色。
@immutable
class AppPalette {
  const AppPalette({
    required this.brightness,
    required this.bg,
    required this.bgDeep,
    required this.navBg,
    required this.surface,
    required this.surfaceAlt,
    required this.surfaceHigh,
    required this.stroke,
    required this.strokeSoft,
    required this.brand,
    required this.brandSoft,
    required this.cyan,
    required this.cyanSoft,
    required this.onBrand,
    required this.text,
    required this.textSub,
    required this.textMuted,
    required this.textFaint,
    required this.ok,
    required this.warn,
    required this.danger,
    required this.scrim,
    required this.glowA,
    required this.glowB,
    required this.glowAOpacity,
    required this.glowBOpacity,
    required this.gradientStart,
    required this.gradientEnd,
    required this.softStart,
    required this.softEnd,
  });

  final Brightness brightness;

  /// 页面底色。
  final Color bg;

  /// 最深底色（系统导航栏、海报底）。
  final Color bgDeep;

  /// 底栏 / 系统栏底色。
  final Color navBg;

  final Color surface;
  final Color surfaceAlt;
  final Color surfaceHigh;
  final Color stroke;
  final Color strokeSoft;

  /// 品牌蓝（主色）。
  final Color brand;
  final Color brandSoft;

  /// 第二强调色（青）。
  final Color cyan;
  final Color cyanSoft;

  /// 品牌渐变上的文字 / 图标颜色。
  final Color onBrand;

  final Color text;
  final Color textSub;
  final Color textMuted;
  final Color textFaint;

  final Color ok;
  final Color warn;
  final Color danger;

  /// 弹窗遮罩。
  final Color scrim;

  /// 页面环境光（左上 / 右下）。
  final Color glowA;
  final Color glowB;
  final double glowAOpacity;
  final double glowBOpacity;

  final Color gradientStart;
  final Color gradientEnd;
  final Color softStart;
  final Color softEnd;

  bool get isDark => brightness == Brightness.dark;

  LinearGradient get brandGradient => LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [gradientStart, gradientEnd],
      );

  LinearGradient get brandGradientSoft => LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [softStart, softEnd],
      );
}

/// 黑夜：真黑底 + 亮蓝品牌色。取消深海军蓝与紫色，整体收进中性黑阶。
const AppPalette darkPalette = AppPalette(
  brightness: Brightness.dark,
  bg: Color(0xFF08090D),
  bgDeep: Color(0xFF000000),
  navBg: Color(0xFF0B0D12),
  surface: Color(0xFF111318),
  surfaceAlt: Color(0xFF171A21),
  surfaceHigh: Color(0xFF1F242D),
  stroke: Color(0xFF262B35),
  strokeSoft: Color(0xFF1A1E26),
  brand: Color(0xFF3B82F6),
  brandSoft: Color(0xFF93C5FD),
  cyan: Color(0xFF64BAF7),
  cyanSoft: Color(0xFF9AD4FA),
  onBrand: Color(0xFF05101C),
  text: Color(0xFFF4F7FC),
  textSub: Color(0xFFA9B4C6),
  textMuted: Color(0xFF6B7688),
  textFaint: Color(0xFF47505F),
  ok: Color(0xFF3DDC97),
  warn: Color(0xFFFFB454),
  danger: Color(0xFFFF6B6B),
  scrim: Color(0xB3000000),
  glowA: Color(0xFF3B82F6),
  glowB: Color(0xFF64BAF7),
  glowAOpacity: 0.20,
  glowBOpacity: 0.14,
  gradientStart: Color(0xFF3B6FF5),
  gradientEnd: Color(0xFF64BAF7),
  softStart: Color(0xFF141C2E),
  softEnd: Color(0xFF10222C),
);

/// 白天：纯白底 + 标准蓝品牌色。用冷灰阶拉开层次，不使用米白/暖灰。
const AppPalette lightPalette = AppPalette(
  brightness: Brightness.light,
  bg: Color(0xFFFFFFFF),
  bgDeep: Color(0xFF0B1220),
  navBg: Color(0xFFFFFFFF),
  surface: Color(0xFFF7F9FC),
  surfaceAlt: Color(0xFFF1F5FB),
  surfaceHigh: Color(0xFFE8EEF7),
  stroke: Color(0xFFE3E9F2),
  strokeSoft: Color(0xFFEEF2F8),
  brand: Color(0xFF2563EB),
  brandSoft: Color(0xFF1D4ED8),
  cyan: Color(0xFF0284C7),
  cyanSoft: Color(0xFF38BDF8),
  onBrand: Color(0xFFFFFFFF),
  text: Color(0xFF0B1220),
  textSub: Color(0xFF4B5563),
  textMuted: Color(0xFF6B7688),
  textFaint: Color(0xFF9AA5B5),
  ok: Color(0xFF0E9F6E),
  warn: Color(0xFFC2740C),
  danger: Color(0xFFDC2626),
  scrim: Color(0x33000000),
  glowA: Color(0xFF2563EB),
  glowB: Color(0xFF0EA5E9),
  glowAOpacity: 0.06,
  glowBOpacity: 0.05,
  gradientStart: Color(0xFF1E5AE0),
  gradientEnd: Color(0xFF2F80ED),
  softStart: Color(0xFFE8F0FF),
  softEnd: Color(0xFFE6F7FF),
);

/// 全局语义色门面。页面继续写 `AppColors.text` 即可，
/// 值由当前 [AppPalette] 决定，切换主题时整棵组件树一起换色。
class AppColors {
  AppColors._();

  static AppPalette _palette = darkPalette;

  static AppPalette get palette => _palette;

  static const AppPalette dark = darkPalette;
  static const AppPalette light = lightPalette;

  /// 由 App 根节点在每次重建前调用。
  static void use(AppPalette palette) => _palette = palette;

  static Color get bg => _palette.bg;
  static Color get bgDeep => _palette.bgDeep;
  static Color get navBg => _palette.navBg;
  static Color get surface => _palette.surface;
  static Color get surfaceAlt => _palette.surfaceAlt;
  static Color get surfaceHigh => _palette.surfaceHigh;
  static Color get stroke => _palette.stroke;
  static Color get strokeSoft => _palette.strokeSoft;

  /// 旧命名兼容：品牌已统一为蓝色，violet 系列直接映射到品牌蓝。
  static Color get violet => _palette.brand;
  static Color get violetSoft => _palette.brandSoft;
  static Color get brand => _palette.brand;
  static Color get brandSoft => _palette.brandSoft;
  static Color get cyan => _palette.cyan;
  static Color get cyanSoft => _palette.cyanSoft;
  static Color get onBrand => _palette.onBrand;

  static Color get text => _palette.text;
  static Color get textSub => _palette.textSub;
  static Color get textMuted => _palette.textMuted;
  static Color get textFaint => _palette.textFaint;

  static Color get ok => _palette.ok;
  static Color get warn => _palette.warn;
  static Color get danger => _palette.danger;
  static Color get scrim => _palette.scrim;

  static LinearGradient get brandGradient => _palette.brandGradient;
  static LinearGradient get brandGradientSoft => _palette.brandGradientSoft;
}

/// 按当前主题取语义色。新页面可继续用 context.cBg 这类短名。
extension AppThemeColors on BuildContext {
  AppPalette get palette => AppColors.palette;
  bool get isDark => palette.isDark;

  Color get cBg => palette.bg;
  Color get cSurface => palette.surface;
  Color get cSurfaceElevated => palette.surfaceAlt;
  Color get cStroke => palette.stroke;
  Color get cText => palette.text;
  Color get cTextSub => palette.textSub;
  Color get cTextMuted => palette.textMuted;
  Color get cScrim => palette.scrim;
}

/// 外观偏好：跟随系统 / 白天 / 黑夜。持久化到本地，重启后保持。
class ThemeController extends ChangeNotifier {
  ThemeController._();

  static final ThemeController instance = ThemeController._();

  static const _key = 'openelf.themeMode';

  ThemeMode _mode = ThemeMode.system;

  ThemeMode get mode => _mode;

  static Brightness resolve(ThemeMode mode) {
    switch (mode) {
      case ThemeMode.dark:
        return Brightness.dark;
      case ThemeMode.light:
        return Brightness.light;
      case ThemeMode.system:
        return PlatformDispatcher.instance.platformBrightness;
    }
  }

  Future<void> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      _mode = switch (prefs.getString(_key)) {
        'dark' => ThemeMode.dark,
        'light' => ThemeMode.light,
        _ => ThemeMode.system,
      };
    } catch (_) {
      // 读取失败保持跟随系统
    }
  }

  Future<void> setMode(ThemeMode mode) async {
    if (_mode == mode) return;
    _mode = mode;
    _apply();
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_key, mode.name);
    } catch (_) {
      // 持久化失败不影响本次切换
    }
  }

  /// 系统明暗变化（跟随系统时）由根节点调用。
  void applySystemBrightness() => _apply();

  /// 运营配置的默认外观：仅在用户从未手动选择过外观时生效。
  Future<void> applyRemoteDefault(String name) async {
    if (name != 'light' && name != 'dark') return;
    try {
      final prefs = await SharedPreferences.getInstance();
      if (prefs.getString(_key) != null) return;
    } catch (_) {
      return;
    }
    final mode = name == 'dark' ? ThemeMode.dark : ThemeMode.light;
    if (_mode == mode) return;
    _mode = mode;
    _apply();
  }

  /// 落色板并通知重建。
  ///
  /// 页面里的颜色都来自 [AppColors] 静态门面，不依赖 `Theme.of(context)`，
  /// 所以只更新 ThemeData 不会让已经建好的页面重新取色（表现为只换了局部）。
  /// 这里在换肤后把整棵元素树标记为 dirty，保证所有页面一次性取到新色板。
  void _apply() {
    notifyListeners();
    final phase = SchedulerBinding.instance.schedulerPhase;
    if (phase == SchedulerPhase.persistentCallbacks) {
      // 正在 build/layout，本帧不能标脏，安排到下一帧。
      WidgetsBinding.instance.addPostFrameCallback((_) => _markTreeDirty());
    } else {
      _markTreeDirty();
      SchedulerBinding.instance.scheduleFrame();
    }
  }

  static void _markTreeDirty() {
    final root = WidgetsBinding.instance.rootElement;
    if (root == null) return;
    void visit(Element element) {
      element.markNeedsBuild();
      element.visitChildElements(visit);
    }

    visit(root);
  }
}

class AppTheme {
  static ThemeData get dark => build(darkPalette);

  static ThemeData get light => build(lightPalette);

  static SystemUiOverlayStyle overlayFor(AppPalette p) => SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: p.isDark ? Brightness.light : Brightness.dark,
        statusBarBrightness: p.isDark ? Brightness.dark : Brightness.light,
        systemNavigationBarColor: p.navBg,
        systemNavigationBarIconBrightness:
            p.isDark ? Brightness.light : Brightness.dark,
        systemNavigationBarDividerColor: Colors.transparent,
      );

  static ThemeData build(AppPalette p) {
    final scheme = ColorScheme.fromSeed(
      seedColor: p.brand,
      brightness: p.brightness,
    ).copyWith(
      primary: p.brand,
      onPrimary: p.onBrand,
      secondary: p.cyan,
      onSecondary: p.onBrand,
      surface: p.surface,
      onSurface: p.text,
      surfaceContainerLowest: p.bg,
      surfaceContainerLow: p.surface,
      surfaceContainer: p.surfaceAlt,
      surfaceContainerHigh: p.surfaceHigh,
      surfaceContainerHighest: p.surfaceHigh,
      outline: p.stroke,
      outlineVariant: p.strokeSoft,
      error: p.danger,
    );

    final base = ThemeData(
      useMaterial3: true,
      brightness: p.brightness,
      colorScheme: scheme,
      scaffoldBackgroundColor: p.bg,
      canvasColor: p.bg,
      splashFactory: InkSparkle.splashFactory,
      dialogTheme: DialogThemeData(
        backgroundColor: p.isDark ? p.surface : p.bg,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),
    );

    return base.copyWith(
      appBarTheme: AppBarTheme(
        backgroundColor: Colors.transparent,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        centerTitle: false,
        foregroundColor: p.text,
      ),
      textTheme: base.textTheme.copyWith(
        headlineLarge: base.textTheme.headlineLarge
            ?.copyWith(fontSize: 28, fontWeight: FontWeight.w700, height: 1.25),
        headlineMedium: base.textTheme.headlineMedium
            ?.copyWith(fontSize: 22, fontWeight: FontWeight.w700, height: 1.3),
        headlineSmall: base.textTheme.headlineSmall
            ?.copyWith(fontSize: 18, fontWeight: FontWeight.w600, height: 1.35),
        titleLarge: base.textTheme.titleLarge
            ?.copyWith(fontSize: 16, fontWeight: FontWeight.w600),
        titleMedium: base.textTheme.titleMedium
            ?.copyWith(fontSize: 14, fontWeight: FontWeight.w600),
        bodyLarge:
            base.textTheme.bodyLarge?.copyWith(fontSize: 15, height: 1.6),
        bodyMedium:
            base.textTheme.bodyMedium?.copyWith(fontSize: 13.5, height: 1.6),
        bodySmall:
            base.textTheme.bodySmall?.copyWith(fontSize: 12, height: 1.55),
        labelSmall: base.textTheme.labelSmall
            ?.copyWith(fontSize: 10.5, letterSpacing: 0.6),
      ),
      dividerTheme:
          DividerThemeData(thickness: 1, space: 1, color: p.strokeSoft),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: p.isDark ? p.surface : p.bg,
        surfaceTintColor: Colors.transparent,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
      ),
    );
  }
}
