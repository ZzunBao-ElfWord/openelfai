import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'auth/auth_factory.dart';
import 'pages/home_shell.dart';
import 'pages/login_page.dart';
import 'services/app_content_service.dart';
import 'state/app_state.dart';
import 'theme.dart';
import 'widgets/common.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await ThemeController.instance.load();
  // 运营配置：先带缓存启动，再后台拉最新快照（失败静默）
  await AppContentService.instance.loadCached();
  unawaited(AppContentService.instance.refresh());
  runApp(const OpenElfApp());
}

class OpenElfApp extends StatefulWidget {
  const OpenElfApp({super.key});

  @override
  State<OpenElfApp> createState() => _OpenElfAppState();
}

class _OpenElfAppState extends State<OpenElfApp> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangePlatformBrightness() {
    // 跟随系统时，系统切换明暗要同步刷新全局色板与所有已建页面。
    if (mounted && ThemeController.instance.mode == ThemeMode.system) {
      ThemeController.instance.applySystemBrightness();
      setState(() {});
    }
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: ThemeController.instance,
      builder: (context, _) {
        final mode = ThemeController.instance.mode;
        final palette = ThemeController.resolve(mode) == Brightness.dark
            ? darkPalette
            : lightPalette;
        // 先落色板再建树，保证本帧所有 AppColors 引用都取到新主题。
        AppColors.use(palette);
        SystemChrome.setSystemUIOverlayStyle(AppTheme.overlayFor(palette));
        return MaterialApp(
          title: 'OpenElf',
          debugShowCheckedModeBanner: false,
          theme: AppTheme.light,
          darkTheme: AppTheme.dark,
          themeMode: mode,
          home: const SplashScreen(),
        );
      },
    );
  }
}

class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  bool _show = false;
  bool _done = false;
  bool _navigated = false;

  @override
  void initState() {
    super.initState();
    // —— 同步注入种子数据（不 await，保证首帧即有内容）——
    AppState.instance.bootstrapSync();
    Future.delayed(const Duration(milliseconds: 120), () {
      if (mounted) setState(() => _show = true);
    });
    _boot();
  }

  /// 恢复本地数据与服务端会话，保证 splash 至少展示 1.4s 后只导航一次。
  Future<void> _boot() async {
    final startedAt = DateTime.now();
    Widget next = const LoginPage();

    try {
      await AppState.instance.restoreAsync();
      final user = await createAuth().restoreSession();
      if (user != null) {
        await AppState.instance.onLogin(user);
        next = const HomeShell();
      } else {
        // 令牌无效：清掉本地缓存的登录态
        AppState.instance.currentUser = null;
        // Web 端游客模式：免登录先进站体验，互动时再提醒登录
        if (kIsWeb) next = const HomeShell();
      }
    } catch (_) {
      // 初始化失败也别卡 splash，按未登录处理（Web 端同样进游客模式）
      next = kIsWeb ? const HomeShell() : const LoginPage();
    }

    final elapsed = DateTime.now().difference(startedAt);
    final remain = const Duration(milliseconds: 1400) - elapsed;
    if (remain > Duration.zero) {
      await Future.delayed(remain);
    }

    if (!mounted || _navigated) return;
    _navigated = true;
    setState(() => _done = true);
    Navigator.of(context).pushReplacement(
      PageRouteBuilder(
        transitionDuration: const Duration(milliseconds: 420),
        pageBuilder: (_, __, ___) => next,
        transitionsBuilder: (_, animation, __, child) =>
            FadeTransition(opacity: animation, child: child),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: AppBackground(
        child: Center(
          child: AnimatedOpacity(
            opacity: _show ? 1 : 0,
            duration: const Duration(milliseconds: 520),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 82,
                  height: 82,
                  clipBehavior: Clip.antiAlias,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(82 * 0.222),
                    boxShadow: [
                      BoxShadow(
                        color: AppColors.violet.withOpacity(0.34),
                        blurRadius: 38,
                        offset: const Offset(0, 12),
                      ),
                    ],
                  ),
                  child: Image.asset(
                    'assets/brand/app_icon.png',
                    fit: BoxFit.cover,
                  ),
                ),
                const SizedBox(height: 26),
                ShaderMask(
                  blendMode: BlendMode.srcIn,
                  shaderCallback: (rect) =>
                      AppColors.brandGradient.createShader(rect),
                  child: const Text(
                    'OpenElf',
                    style: TextStyle(
                      fontSize: 30,
                      fontWeight: FontWeight.w800,
                      color: Colors.white,
                      letterSpacing: 2.4,
                    ),
                  ),
                ),
                const SizedBox(height: 10),
                Text(
                  AppContentService.instance.content.value
                      .text('app.brand.slogan'),
                  style: TextStyle(
                    fontSize: 13,
                    color: AppColors.textSub,
                    letterSpacing: 3,
                  ),
                ),
                const SizedBox(height: 30),
                if (!_done)
                  SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(
                      strokeWidth: 1.8,
                      color: AppColors.cyan,
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
