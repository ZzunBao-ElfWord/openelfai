import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:openelf/push/push_service.dart';
import 'package:openelf/push/push_destination.dart';

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

  test('通知内容仅允许站内页面，拒绝外部URL与不完整目标', () {
    expect(
        PushDestination.parse(
            {'route': 'https://evil.test', 'userId': 'u1', 'eventId': 'e1'}),
        isNull);
    expect(
        PushDestination.parse(
            {'route': 'elf', 'userId': 'u1', 'eventId': 'e1'}),
        isNull);
    expect(PushDestination.parse({'extras': '{bad json'}), isNull);
  });

  test('登录绑定、换号重绑；只消费当前账号通知且同一通知只跳转一次', () async {
    final requests = <Map<String, dynamic>>[];
    final service = PushService.forTesting(
        ios: false,
        request: (path, {body, timeout}) async {
          requests.add({'path': path, ...?body});
          return {'bound': true};
        });
    addTearDown(service.dispose);
    await service.setAccount('user-a');
    await service.enable();
    expect(requests.single['path'], '/api/v1/push/bind');
    expect(requests.single.containsKey('userId'), false);
    await service.setAccount('user-b');
    expect(requests.where((r) => r['path'] == '/api/v1/push/bind').length, 2);
    service.handleNotificationOpen(
        {'route': 'wallet', 'userId': 'user-a', 'eventId': 'event-a'});
    expect(service.takeDestination('user-b'), isNull);
    final event = {'route': 'wallet', 'userId': 'user-b', 'eventId': 'event-b'};
    service.handleNotificationOpen(event);
    expect(service.takeDestination('user-b')?.route, 'wallet');
    service.handleNotificationOpen(event);
    expect(service.takeDestination('user-b'), isNull);
    await service.signOut();
    expect(service.enabled, false);
    expect(requests.last['path'], '/api/v1/push/unbind');
    expect(service.takeDestination('user-b'), isNull);
  });

  test('绑定失败不能冒充已连接；无授权时不绑定', () async {
    final service = PushService.forTesting(
        ios: false,
        request: (path, {body, timeout}) async => throw StateError('offline'));
    addTearDown(service.dispose);
    await service.setAccount('user-a');
    await service.enable();
    expect(service.bindingError, isNotNull);
    await service.disable();
    expect(service.enabled, false);
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
    await ios.setAccount('user-test');
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
