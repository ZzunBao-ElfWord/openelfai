import 'dart:async';
import 'dart:io';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_windows/webview_windows.dart';
import 'auth_repository.dart';
import 'desktop_captcha_message.dart';

Future<CaptchaProof?> verifyDesktopCaptcha(BuildContext context) async {
  if (!Platform.isWindows) {
    throw const AuthException('UNSUPPORTED_PLATFORM', '当前平台暂不支持桌面图形验证');
  }
  final nonce = List.generate(32, (_) => Random.secure().nextInt(256))
      .map((v) => v.toRadixString(16).padLeft(2, '0'))
      .join();
  final result = await showDialog<_Result>(
      context: context,
      barrierDismissible: false,
      builder: (_) => _CaptchaDialog(nonce: nonce));
  if (result?.error != null) throw result!.error!;
  return result?.proof;
}

class _Result {
  final CaptchaProof? proof;
  final AuthException? error;
  const _Result({this.proof, this.error});
}

class _CaptchaDialog extends StatefulWidget {
  final String nonce;
  const _CaptchaDialog({required this.nonce});
  @override
  State<_CaptchaDialog> createState() => _CaptchaDialogState();
}

class _CaptchaDialogState extends State<_CaptchaDialog> {
  final _controller = WebviewController();
  final List<StreamSubscription<dynamic>> _subscriptions = [];
  Directory? _assetDirectory;
  Timer? _timer;
  bool _initialized = false;
  bool _ready = false;
  bool _done = false;
  String _currentUrl = '';
  String? _error;

  @override
  void initState() {
    super.initState();
    _timer = Timer(const Duration(minutes: 3), () => _fail('图形验证已超时，请关闭后重试'));
    _initialize();
  }

  void _fail(String message) {
    if (!mounted || _done) return;
    _done = true;
    _timer?.cancel();
    setState(() => _error = message);
  }

  Future<void> _initialize() async {
    try {
      if (await WebviewController.getWebViewVersion() == null) {
        _fail('缺少 Microsoft Edge WebView2 Runtime，请安装微软官方运行时后重试');
        return;
      }
      if (!mounted) return;
      final directory =
          await Directory.systemTemp.createTemp('openelf-captcha-');
      _assetDirectory = directory;
      for (final name in [
        'desktop.html',
        'desktop.js',
        'ct4.js',
        'web-captcha.js'
      ]) {
        final bytes = await rootBundle.load('assets/captcha/$name');
        await File('${directory.path}/$name').writeAsBytes(
            bytes.buffer.asUint8List(bytes.offsetInBytes, bytes.lengthInBytes));
      }
      if (!mounted) {
        await _cleanup();
        return;
      }
      await _controller.initialize();
      _initialized = true;
      if (!mounted) {
        await _controller.dispose();
        await _cleanup();
        return;
      }
      await _controller.setPopupWindowPolicy(WebviewPopupWindowPolicy.deny);
      // Map ONLY this app-owned temporary asset folder inside this isolated WebView.
      // No DNS, OS hosts file, website files or existing browser profile are changed.
      await _controller.addVirtualHostNameMapping('web.openelfai.com',
          directory.path, WebviewHostResourceAccessKind.denyCors);
      if (!mounted) return;
      _subscriptions.add(_controller.url.listen((url) {
        _currentUrl = url;
        if (url == 'about:blank') return;
        final uri = Uri.tryParse(url);
        if (uri?.scheme != 'https' ||
            uri?.host != 'web.openelfai.com' ||
            uri?.path != '/desktop.html' ||
            uri?.fragment != widget.nonce) {
          _controller.stop();
          _fail('验证页面发生非预期跳转，已停止，请重试');
        }
      }));
      _subscriptions.add(
          _controller.onLoadError.listen((_) => _fail('验证页面加载失败，请检查网络后重试')));
      _subscriptions.add(_controller.webMessage.listen((message) {
        if (!mounted || _done) return;
        try {
          final proof =
              decodeDesktopCaptchaMessage(message, widget.nonce, _currentUrl);
          _done = true;
          _timer?.cancel();
          Navigator.of(context).pop(_Result(proof: proof));
        } catch (_) {
          _fail('图形验证返回结果无效，请关闭后重试');
        }
      }, onError: (_) => _fail('图形验证返回异常，请重试')));
      await _controller
          .loadUrl('https://web.openelfai.com/desktop.html#${widget.nonce}');
      if (mounted && !_done) setState(() => _ready = true);
    } catch (_) {
      _fail('无法启动 Windows 图形验证窗口，请检查 WebView2 Runtime 与网络');
    }
  }

  Future<void> _cleanup() async {
    final dir = _assetDirectory;
    if (dir == null) return;
    _assetDirectory = null;
    try {
      final temp = await Directory.systemTemp.resolveSymbolicLinks();
      final resolved = await dir.resolveSymbolicLinks();
      if (Directory(resolved).parent.path == temp &&
          resolved
              .split(Platform.pathSeparator)
              .last
              .startsWith('openelf-captcha-')) {
        await dir.delete(recursive: true);
      }
    } catch (_) {
      /* Asset-only temporary folder may remain if WebView holds a file lock. */
    }
  }

  @override
  void dispose() {
    _done = true;
    _timer?.cancel();
    for (final subscription in _subscriptions) {
      subscription.cancel();
    }
    if (_initialized) {
      _controller.dispose().then((_) => _cleanup()).catchError((_) {});
    } else {
      _cleanup();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: const Text('登录安全验证'),
        content: SizedBox(
            width: 560,
            height: 450,
            child: _error != null
                ? Center(child: Text(_error!))
                : !_ready
                    ? const Center(child: CircularProgressIndicator())
                    : Webview(_controller,
                        permissionRequested: (_, __, ___) async =>
                            WebviewPermissionDecision.deny)),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(context).pop(_Result(
                  error: _error == null
                      ? null
                      : AuthException('CAPTCHA_UNAVAILABLE', _error!))),
              child: Text(_error == null ? '取消验证' : '关闭'))
        ],
      );
}
