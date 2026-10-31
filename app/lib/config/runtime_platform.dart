import 'package:flutter/foundation.dart';

/// 桌面端（Windows / macOS / Linux）判定。
///
/// 桌面端没有阿里云原生图形验证 SDK，登录与 Web 一样走 web 占位凭证，
/// 由服务端 IP / 手机号频率限制兜底；同时允许免登录游客浏览。
bool get isDesktopPlatform =>
    !kIsWeb &&
    (defaultTargetPlatform == TargetPlatform.windows ||
        defaultTargetPlatform == TargetPlatform.macOS ||
        defaultTargetPlatform == TargetPlatform.linux);

/// 无原生图形验证 SDK、需走 Web 式登录的端：Web 与桌面。
bool get usesBrowserAuthFlow => kIsWeb || isDesktopPlatform;

/// 允许免登录游客模式：Web 与桌面。
bool get supportsGuestMode => usesBrowserAuthFlow;
