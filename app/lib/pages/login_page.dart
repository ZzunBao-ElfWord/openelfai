import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:openelf_ali_captcha/openelf_ali_captcha.dart';

import '../auth/auth_factory.dart';
import '../auth/auth_repository.dart';
import '../config/captcha_config.dart';
import '../services/app_content_service.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'home_shell.dart';

/// 登录页：手机号 + 短信验证码（服务端下发）。
class LoginPage extends StatefulWidget {
  const LoginPage({super.key});

  @override
  State<LoginPage> createState() => _LoginPageState();
}

/// 游客模式（Web 免登录体验）：互动操作前检查登录态。
/// 已登录返回 true；未登录弹登录提醒并返回 false。
/// 注意：用 showDialog 而非 SnackBar，避免被底部弹层遮挡。
bool checkLoginOrPrompt(BuildContext context) {
  if (AppState.instance.currentUser != null) return true;
  showDialog<void>(
    context: context,
    builder: (ctx) => AlertDialog(
      backgroundColor: AppColors.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      title: Text(
        '登录后继续',
        style: TextStyle(
            fontSize: 16, fontWeight: FontWeight.w700, color: AppColors.text),
      ),
      content: Text(
        '登录后即可点赞、评论、打赏、聊天，并创建属于你自己的 AI',
        style: TextStyle(fontSize: 13, height: 1.5, color: AppColors.textSub),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(ctx).pop(),
          child: Text('先逛逛', style: TextStyle(color: AppColors.textMuted)),
        ),
        TextButton(
          onPressed: () {
            Navigator.of(ctx).pop();
            Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const LoginPage()),
            );
          },
          child: Text('去登录',
              style:
                  TextStyle(color: AppColors.cyan, fontWeight: FontWeight.w700)),
        ),
      ],
    ),
  );
  return false;
}

class _LoginPageState extends State<LoginPage> {
  final _phoneCtrl = TextEditingController();
  final _codeCtrl = TextEditingController();
  bool _loading = false;
  bool _sending = false;
  int _countdown = 0;
  Timer? _timer;

  @override
  void dispose() {
    _timer?.cancel();
    _phoneCtrl.dispose();
    _codeCtrl.dispose();
    super.dispose();
  }

  bool get _phoneOk {
    final p = _phoneCtrl.text.trim();
    return p.length == 11 && RegExp(r'^1\d{10}$').hasMatch(p);
  }

  bool get _codeOk => _codeCtrl.text.trim().length == 6;

  Future<void> _sendCode() async {
    if (!_phoneOk) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('请输入 11 位手机号')),
      );
      return;
    }
    if (_sending || _countdown > 0) return;

    setState(() => _sending = true);
    try {
      final captcha = await _verifyCaptcha();
      if (captcha == null) return;
      await createAuth().sendCode(
        _phoneCtrl.text.trim(),
        captcha: captcha,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('验证码已发送，请查看短信'),
          backgroundColor: AppColors.violet,
          duration: const Duration(seconds: 3),
        ),
      );
      _startCountdown();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('发送失败：$e')),
      );
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<CaptchaProof?> _verifyCaptcha() async {
    // Web 端没有阿里云原生图形验证 SDK，发送依赖服务端 IP/手机号频率限制兜底。
    if (kIsWeb) {
      return const CaptchaProof(
        platform: 'web',
        lotNumber: 'web',
        passToken: 'web',
        genTime: 'web',
        captchaOutput: 'web',
      );
    }
    final String platform;
    final String captchaId;
    if (defaultTargetPlatform == TargetPlatform.android) {
      platform = 'android';
      captchaId = CaptchaConfig.androidId;
    } else if (defaultTargetPlatform == TargetPlatform.iOS) {
      platform = 'ios';
      captchaId = CaptchaConfig.iosId;
    } else {
      throw const AuthException('UNSUPPORTED_PLATFORM', '当前平台暂不支持短信登录');
    }

    if (captchaId.isEmpty) {
      throw const AuthException('CAPTCHA_NOT_CONFIGURED', '图形验证尚未配置，请联系管理员');
    }

    try {
      final raw = await OpenElfAliCaptcha.verify(captchaId: captchaId);
      if (raw == null) return null;
      final decoded = jsonDecode(raw);
      if (decoded is! Map) {
        throw const AuthException('INVALID_CAPTCHA_PROOF', '图形验证结果异常，请重试');
      }
      return CaptchaProof.fromJson(
          platform, Map<String, dynamic>.from(decoded));
    } on PlatformException catch (error) {
      throw AuthException(error.code, error.message ?? '图形验证失败，请重试');
    } on FormatException {
      throw const AuthException('INVALID_CAPTCHA_PROOF', '图形验证结果异常，请重试');
    }
  }

  void _startCountdown() {
    _timer?.cancel();
    setState(() => _countdown = 60);
    _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      if (_countdown <= 1) {
        timer.cancel();
        setState(() => _countdown = 0);
      } else {
        setState(() => _countdown -= 1);
      }
    });
  }

  Future<void> _login() async {
    if (!_phoneOk) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('请输入 11 位手机号')),
      );
      return;
    }
    if (!_codeOk) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('请输入验证码')),
      );
      return;
    }
    setState(() => _loading = true);
    try {
      final user = await createAuth().loginWithCode(
        phone: _phoneCtrl.text.trim(),
        code: _codeCtrl.text.trim(),
      );
      await AppState.instance.onLogin(user);
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        PageRouteBuilder(
          transitionDuration: const Duration(milliseconds: 360),
          pageBuilder: (_, __, ___) => const HomeShell(),
          transitionsBuilder: (_, a, __, c) =>
              FadeTransition(opacity: a, child: c),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('登录失败：$e')),
      );
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: AppBackground(
        child: Stack(
          children: [
            SafeArea(
              bottom: false,
              child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 40),
            // 桌面宽屏：登录表单收窄居中
            child: WideContent(
              maxWidth: 420,
              child: Column(
              children: [
                // Logo + 标题
                const SizedBox(height: 40),
                Container(
                  width: 88,
                  height: 88,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(44),
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
                const SizedBox(height: 22),
                ShaderMask(
                  blendMode: BlendMode.srcIn,
                  shaderCallback: (rect) =>
                      AppColors.brandGradient.createShader(rect),
                  child: const Text(
                    'OpenElf',
                    style: TextStyle(
                      fontSize: 28,
                      fontWeight: FontWeight.w800,
                      color: Colors.white,
                      letterSpacing: 2,
                    ),
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  AppContentService.instance.content.value
                      .text('app.brand.slogan'),
                  style: TextStyle(fontSize: 12, color: AppColors.textSub),
                ),
                const SizedBox(height: 40),

                // 手机号
                TextField(
                  controller: _phoneCtrl,
                  keyboardType: TextInputType.phone,
                  maxLength: 11,
                  style: TextStyle(color: AppColors.text),
                  decoration: InputDecoration(
                    counterText: '',
                    hintText: '输入手机号',
                    hintStyle: TextStyle(color: AppColors.textMuted),
                    filled: true,
                    fillColor: AppColors.surface,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                      borderSide: BorderSide.none,
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                      borderSide: BorderSide.none,
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                      borderSide: BorderSide(
                          color: AppColors.cyan.withOpacity(0.6), width: 1),
                    ),
                    contentPadding: const EdgeInsets.symmetric(
                        horizontal: 14, vertical: 14),
                  ),
                ),
                const SizedBox(height: 12),

                // 验证码
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _codeCtrl,
                        keyboardType: TextInputType.number,
                        maxLength: 6,
                        style: TextStyle(color: AppColors.text),
                        decoration: InputDecoration(
                          counterText: '',
                          hintText: '验证码',
                          hintStyle:
                              TextStyle(color: AppColors.textMuted),
                          filled: true,
                          fillColor: AppColors.surface,
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(10),
                            borderSide: BorderSide.none,
                          ),
                          enabledBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(10),
                            borderSide: BorderSide.none,
                          ),
                          focusedBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(10),
                            borderSide: BorderSide(
                                color: AppColors.cyan.withOpacity(0.6),
                                width: 1),
                          ),
                          contentPadding: const EdgeInsets.symmetric(
                              horizontal: 14, vertical: 14),
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    SizedBox(
                      width: 120,
                      height: 48,
                      child: ElevatedButton(
                        onPressed:
                            (_sending || _countdown > 0) ? null : _sendCode,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppColors.violet.withOpacity(0.25),
                          foregroundColor: AppColors.violetSoft,
                          elevation: 0,
                          padding: EdgeInsets.zero,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(10),
                          ),
                        ),
                        child: Text(
                          _sending
                              ? '发送中…'
                              : (_countdown > 0
                                  ? '${_countdown}s 后重发'
                                  : '发送验证码'),
                          style: const TextStyle(fontSize: 12),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 28),

                // 登录
                SizedBox(
                  width: double.infinity,
                  height: 48,
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: AppColors.brandGradient,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Material(
                      color: Colors.transparent,
                      child: InkWell(
                        borderRadius: BorderRadius.circular(12),
                        onTap: _loading ? null : _login,
                        child: Center(
                          child: _loading
                              ? const SizedBox(
                                  width: 18,
                                  height: 18,
                                  child: CircularProgressIndicator(
                                      strokeWidth: 2, color: Colors.white),
                                )
                              : Text(
                                  '登录',
                                  style: TextStyle(
                                    fontSize: 15,
                                    fontWeight: FontWeight.w700,
                                    color: AppColors.onBrand,
                                  ),
                                ),
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                Text(
                  '首次登录即视为同意《用户协议》与《隐私政策》',
                  style: TextStyle(fontSize: 10.5, color: AppColors.textFaint),
                ),
              ],
            ),
            ),
          ),
            ),
            // 游客从提醒弹层 push 进来时提供返回入口
            if (Navigator.canPop(context))
              Positioned(
                top: 4,
                left: 4,
                child: SafeArea(
                  bottom: false,
                  child: IconButton(
                    icon: Icon(Icons.arrow_back_ios_new,
                        size: 18, color: AppColors.textSub),
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
