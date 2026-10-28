import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:openelf/auth/auth_repository.dart';
import 'package:openelf/compliance/community_repository.dart';
import 'package:openelf/pages/community_safety_page.dart';
import 'package:openelf/state/app_state.dart';

void main() {
  test(
      'reports retain an explicit idempotency ID and never spoof reporter or status',
      () async {
    String? path;
    Map<String, dynamic>? sent;
    final repo = CommunityRepository(request: (p, {body}) async {
      path = p;
      sent = body;
      return {'id': 'cr_receipt', 'status': 'pending'};
    });
    final response = await repo.report(
        mode: 'production',
        requestId: 'same-retry-id',
        targetKind: 'post',
        targetId: 'p_real',
        reason: '其他');
    expect(path, '/api/v1/community/reports');
    expect(sent!['requestId'], 'same-retry-id');
    expect(sent!.containsKey('reporterId'), isFalse);
    expect(sent!.containsKey('status'), isFalse);
    expect(response['id'], 'cr_receipt');
  });
  test('failed server submissions are not silently treated as success',
      () async {
    final repo = CommunityRepository(
        request: (path, {body}) async =>
            throw const AuthException('NETWORK_ERROR', 'not connected'));
    await expectLater(
        repo.report(
            mode: 'production',
            requestId: 'same-retry-id',
            targetKind: 'post',
            targetId: 'p_real',
            reason: '其他'),
        throwsA(isA<AuthException>()));
  });
  test(
      'blocks and terms use authenticated safety endpoints and explicit consent',
      () async {
    final sent = <Map<String, dynamic>>[];
    final repo = CommunityRepository(request: (path, {body}) async {
      sent.add({'path': path, ...?body});
      return {'blocks': []};
    });
    await repo.setBlock(
        mode: 'sandbox',
        targetKind: 'user',
        targetId: 'u_other',
        blocked: true);
    await repo.acceptTerms('production');
    expect(sent[0]['blocked'], isTrue);
    expect(sent[0]['environment'], 'sandbox');
    expect(sent[1]['accepted'], isTrue);
    expect(sent[1]['version'], '2026-10-28');
  });
  testWidgets(
      'safety page offers real rules, contact and login error without a fake receipt',
      (tester) async {
    AppState.instance.bootstrapSync();
    AppState.instance.currentUser = null;
    await tester.pumpWidget(const MaterialApp(home: CommunitySafetyPage()));
    await tester.pumpAndSettle();
    expect(find.text('内容安全与反馈'), findsOneWidget);
    expect(find.text('请先登录'), findsOneWidget);
    expect(find.textContaining('社区规范（2026-10-28）'), findsOneWidget);
    expect(find.textContaining('已提交，回执'), findsNothing);
    final button = tester
        .widget<FilledButton>(find.widgetWithText(FilledButton, '保存同意记录'));
    expect(button.onPressed, isNull);
  });
}
