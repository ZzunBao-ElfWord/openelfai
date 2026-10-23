import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:openelf/push/push_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('jpush');
  late List<MethodCall> calls;

  setUp(() {
    calls = [];
    SharedPreferences.setMockInitialValues({});
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      calls.add(call);
      switch (call.method) {
        case 'getRegistrationID':
          return 'test-registration-id';
        case 'isNotificationEnabled':
          return {'isEnabled': true};
        default:
          return true;
      }
    });
  });
  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  test('未同意推送时冷启动不调用原生SDK', () async {
    final service = PushService.forTesting(ios: true);
    await service.restore();
    expect(calls, isEmpty);
    expect(service.enabled, isFalse);
  });

  test('iOS使用独立AppKey、申请APNs权限并正确解析设备注册状态', () async {
    final service = PushService.forTesting(ios: true);
    await service.enable();
    expect(service.error, isNull);
    final setup = calls.singleWhere((call) => call.method == 'setup');
    expect(setup.arguments['appKey'], PushService.iosAppKey);
    expect(calls.indexWhere((call) => call.method == 'setAuth'),
        lessThan(calls.indexOf(setup)));
    expect(calls.any((call) => call.method == 'applyPushAuthority'), isTrue);
    expect(calls.any((call) => call.method == 'requestRequiredPermission'),
        isFalse);
    expect(service.registrationId, 'test-registration-id');
    expect(service.notificationsAllowed, isTrue);
    await service.disable();
    expect(service.enabled, isFalse);
    expect(
        (await SharedPreferences.getInstance()).getBool('openelf.push.consent'),
        isFalse);
  });

  test('iOS冷启动仍注册APNs，Android继续使用原AppKey及权限方法', () async {
    SharedPreferences.setMockInitialValues({'openelf.push.consent': true});
    final ios = PushService.forTesting(ios: true);
    await ios.restore();
    expect(calls.any((call) => call.method == 'applyPushAuthority'), isTrue);
    await ios.disable();
    calls.clear();
    final android = PushService.forTesting(ios: false);
    await android.enable();
    expect(
        calls.singleWhere((call) => call.method == 'setup').arguments['appKey'],
        PushService.androidAppKey);
    expect(calls.any((call) => call.method == 'requestRequiredPermission'),
        isTrue);
    expect(calls.any((call) => call.method == 'applyPushAuthority'), isFalse);
    await android.disable();
  });
}
