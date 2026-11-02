import 'package:flutter/foundation.dart';

/// 桌面端（Windows / macOS / Linux）判定。
///
/// 桌面端没有阿里云原生图形验证 SDK；允许游客浏览，但不能伪造网页证明。
/// Windows 使用隔离 WebView2 承载真实 H5 验证；其他桌面端暂不提供短信验证。
bool get isDesktopPlatform =>
    !kIsWeb &&
    (defaultTargetPlatform == TargetPlatform.windows ||
        defaultTargetPlatform == TargetPlatform.macOS ||
        defaultTargetPlatform == TargetPlatform.linux);

/// 无原生图形验证 SDK、需走 Web 式登录的端：Web 与桌面。
bool get usesBrowserAuthFlow => kIsWeb || isDesktopPlatform;

/// 允许免登录游客模式：Web 与桌面。
bool get supportsGuestMode => usesBrowserAuthFlow;
