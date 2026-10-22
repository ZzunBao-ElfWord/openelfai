import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'auth/auth_factory.dart';
import 'models/user.dart';
import 'pages/home_shell.dart';
import 'pages/login_page.dart';
import 'state/app_state.dart';
import 'theme.dart';
import 'widgets/common.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    statusBarIconBrightness: Brightness.light,
    systemNavigationBarColor: AppColors.bgDeep,
    systemNavigationBarIconBrightness: Brightness.light,
  ));
  runApp(const OpenelfApp());
}

class OpenelfApp extends StatelessWidget {
  const OpenelfApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'OpenElf',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.dark,
      home: const SplashScreen(),
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
        // 测试绕过：release/debug 都直接登录（上架前移除）
        await AppState.instance.onLogin(User(
          id: 'u_me', phone: '13800138000', nickname: '用户8000',
          avatarInitial: 'U', createdAt: DateTime.now(),
        ));
        next = const HomeShell();
      }
    } catch (_) {
      // 初始化失败也别卡 splash，按未登录处理
      next = const LoginPage();
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
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(41),
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
                const Text(
                  '我的 AI，我做主',
                  style: TextStyle(
                    fontSize: 13,
                    color: AppColors.textSub,
                    letterSpacing: 3,
                  ),
                ),
                const SizedBox(height: 30),
                if (!_done)
                  const SizedBox(
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
