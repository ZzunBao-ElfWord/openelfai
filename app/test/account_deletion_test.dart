import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:openelf/auth/auth_repository.dart';
import 'package:openelf/auth/remote_auth_repository.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() {
    SharedPreferences.setMockInitialValues({'openelf.user': '{}'});
    FlutterSecureStorage.setMockInitialValues({
      'openelf.accessToken': 'old-access', 'openelf.refreshToken': 'old-refresh',
    });
  });

  test('注销成功才清本地令牌，发送明确确认且不允许指定用户', () async {
    final auth = RemoteAuthRepository.forTesting(client: MockClient((request) async {
      expect(request.url.path, '/api/v1/auth/delete-account');
      expect(request.headers['authorization'], 'Bearer old-access');
      expect(jsonDecode(request.body), {'confirmation': 'DELETE_MY_ACCOUNT'});
      return http.Response('{"deleted":true}', 200);
    }));
    await auth.deleteAccount();
    expect(await auth.accessToken, isNull);
    expect((await SharedPreferences.getInstance()).getString('openelf.user'), isNull);
  });

  test('服务端拒绝、未部署或网络失败不能假装已注销', () async {
    for (final status in [409, 404, 500]) {
      final auth = RemoteAuthRepository.forTesting(client: MockClient((_) async =>
          http.Response('{"error":{"code":"ACCOUNT_UNSETTLED","message":"请先结算"}}', status)));
      await expectLater(auth.deleteAccount(), throwsA(isA<AuthException>()));
      expect(await auth.accessToken, 'old-access');
    }
  });

  test('空成功响应不能当作注销完成', () async {
    final auth = RemoteAuthRepository.forTesting(client: MockClient((_) async => http.Response('{}', 200)));
    await expectLater(auth.deleteAccount(), throwsA(isA<AuthException>()));
    expect(await auth.accessToken, 'old-access');
  });
}
