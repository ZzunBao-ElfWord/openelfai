import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'auth/auth_factory.dart';
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
  Widget? _next;

  @override
  void initState() {
    super.initState();
    // —— 同步注入种子数据（不 await，保证首帧即有内容）——
    AppState.instance.bootstrapSync();
    Future.delayed(const Duration(milliseconds: 120), () {
      if (mounted) setState(() => _show = true);
    });
    // —— 异步：恢复本地 session + 持久化数据 ——
    _asyncRestore();
    Future.delayed(const Duration(milliseconds: 1400), _enter);
  }

  Future<void> _asyncRestore() async {
    try {
      await AppState.instance.restoreAsync();
      final auth = createAuth(useRemote: true);
      final user = await auth.currentUser;
      if (user != null && AppState.instance.currentUser == null) {
        AppState.instance.currentUser = user;
      }
      _next = user != null ? const HomeShell() : const LoginPage();
    } catch (_) {
      // 初始化失败也别卡 splash，按未登录处理
      _next = const LoginPage();
    }
  }

  void _enter() {
    if (!mounted) return;
    // 如果 _asyncRestore 还没跑完（比如 slow device），默认进 LoginPage
    _next ??= const LoginPage();
    setState(() => _done = true);
    Future.delayed(const Duration(milliseconds: 420), () {
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        PageRouteBuilder(
          transitionDuration: const Duration(milliseconds: 420),
          pageBuilder: (_, __, ___) => _next!,
          transitionsBuilder: (_, animation, __, child) =>
              FadeTransition(opacity: animation, child: child),
        ),
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: AppBackground(
        child: GestureDetector(
          onTap: _done ? () {
            if (_next != null) _enter();
          } : null,
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
      ),
    );
  }
}
