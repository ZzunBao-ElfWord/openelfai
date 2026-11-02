import 'package:flutter/material.dart';
import 'auth_repository.dart';

Future<CaptchaProof?> verifyDesktopCaptcha(BuildContext context) async =>
    throw const AuthException('UNSUPPORTED_PLATFORM', '当前平台暂不支持桌面图形验证');
