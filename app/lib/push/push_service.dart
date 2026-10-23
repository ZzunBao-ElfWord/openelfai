import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:jpush_flutter/jpush_flutter.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Android / iOS 基础推送。仅在用户明确开启后初始化。
class PushService extends ChangeNotifier {
  PushService._();
  @visibleForTesting
  PushService.forTesting({required bool ios}) : _testIos = ios;
  bool? _testIos;
  static final instance = PushService._();
  static const androidAppKey = '3439c18b0c3021ae5e29ba92';
  static const iosAppKey = '26cb5da674a8da5e9aa0128d';
  bool get _ios => _testIos ?? Platform.isIOS;
  String get appKey => _ios ? iosAppKey : androidAppKey;
  static const _preference = 'openelf.push.consent';
  // 官方插件部分接口返回 void，会丢弃原生 Future；在此等待同一官方通道的
  // 实际返回值，保证授权、初始化、暂停/恢复顺序，并捕获平台错误。
  static const _channel = MethodChannel('jpush');
  bool get supported =>
      _testIos != null || (!kIsWeb && (Platform.isAndroid || Platform.isIOS));
  bool enabled = false;
  bool busy = false;
  bool notificationsAllowed = false;
  String registrationId = '';
  String? error;
  String? lastEvent;
  bool _initialized = false;
  bool _handlersAttached = false;
  Timer? _registrationTimer;
  int _attempts = 0;

  Future<void> restore() async {
    if (!supported) return;
    _attachHandlers();
    try {
      if ((await SharedPreferences.getInstance()).getBool(_preference) ==
          true) {
        await enable(requestPermission: false);
      }
    } catch (_) {
      error = '通知服务暂时不可用，请在设置中重试';
      notifyListeners();
    }
  }

  void _attachHandlers() {
    if (_handlersAttached) return;
    if (_testIos != null) {
      _handlersAttached = true;
      return;
    }
    JPush.newJPush().addEventHandler(
      onConnected: (_) async => refresh(),
      onReceiveNotification: (_) async => _event('收到一条通知'),
      onOpenNotification: (_) async => _event('已打开通知'),
      onReceiveMessage: (_) async => _event('收到一条应用内消息'),
      onReceiveNotificationAuthorization: (_) async => refresh(),
    );
    _handlersAttached = true;
  }

  Future<void> enable({bool requestPermission = true}) async {
    if (!supported || busy) return;
    busy = true;
    error = null;
    notifyListeners();
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(_preference, true);
      await _channel.invokeMethod('setAuth', {'enable': true});
      if (!_initialized) {
        _attachHandlers();
        await _channel.invokeMethod('setup', {
          'appKey': appKey,
          'channel': 'developer-default',
          'production': kReleaseMode,
          'debug': false,
        });
        _initialized = true;
      }
      await _channel.invokeMethod('resumePush');
      enabled = true;
      if (_ios) {
        // 每次冷启动都需注册 APNs 并安装通知代理；iOS 不会重复弹已决定的授权。
        await _channel.invokeMethod('applyPushAuthority', {
          'sound': true,
          'alert': true,
          'badge': true,
        });
      } else if (requestPermission) {
        await _channel.invokeMethod('requestRequiredPermission');
      }
      await refresh();
      _registrationTimer?.cancel();
      _attempts = 0;
      _registrationTimer = Timer.periodic(const Duration(seconds: 3), (timer) {
        if (!enabled || registrationId.isNotEmpty || ++_attempts > 10) {
          timer.cancel();
        } else {
          unawaited(refresh());
        }
      });
    } catch (_) {
      error = '通知服务启动失败，请重试';
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<void> disable() async {
    if (!supported || busy) return;
    busy = true;
    error = null;
    notifyListeners();
    try {
      if (_initialized) await _channel.invokeMethod('stopPush');
      await _channel.invokeMethod('setAuth', {'enable': false});
      await (await SharedPreferences.getInstance()).setBool(_preference, false);
      enabled = false;
      registrationId = '';
      _registrationTimer?.cancel();
    } catch (_) {
      error = '关闭通知失败，请重试';
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<void> refresh() async {
    if (!supported || !_initialized || !enabled) return;
    try {
      final allowed = await _channel.invokeMapMethod<String, dynamic>(
        'isNotificationEnabled',
      );
      final id = await _channel
          .invokeMethod<String>('getRegistrationID')
          .timeout(const Duration(seconds: 8), onTimeout: () => '');
      if (!enabled) return;
      registrationId = id ?? '';
      notificationsAllowed = allowed?['isEnabled'] == true;
      error = null;
    } catch (_) {
      error = '无法读取通知状态，请重试';
    }
    notifyListeners();
  }

  Future<void> openSystemSettings() async {
    if (!supported) return;
    try {
      // iOS 官方插件不返回此调用的结果，避免无限等待。
      await _channel
          .invokeMethod('openSettingsForNotification')
          .timeout(const Duration(seconds: 2), onTimeout: () => null);
    } catch (_) {
      error = '请前往系统设置中的 OpenElf 通知权限页面';
      notifyListeners();
    }
  }

  void _event(String message) {
    if (!enabled) return;
    lastEvent = message;
    notifyListeners();
  }
}
