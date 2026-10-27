import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:openelf/auth/auth_repository.dart';
import 'package:openelf/pages/account_deletion_page.dart';

class TestAuth implements AuthRepository {
  Future<void> Function() action;
  int calls = 0;
  TestAuth(this.action);
  @override
  Future<void> deleteAccount() { calls++; return action(); }
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

Future<void> openPage(WidgetTester tester, TestAuth auth, Future<void> Function() onDeleted) async {
  await tester.pumpWidget(MaterialApp(home: Builder(builder: (context) => Scaffold(
    body: TextButton(onPressed: () => Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => AccountDeletionPage(auth: auth, onDeleted: onDeleted))),
      child: const Text('设置')),
  ))));
  await tester.tap(find.text('设置'));
  await tester.pumpAndSettle();
  await tester.tap(find.byType(CheckboxListTile));
  await tester.pump();
}

void main() {
  testWidgets('等待服务端成功再清账号，处理中禁止重复提交', (tester) async {
    final done = Completer<void>();
    final auth = TestAuth(() => done.future);
    var cleared = false;
    await openPage(tester, auth, () async { cleared = true; });
    await tester.ensureVisible(find.byKey(const Key('confirm-account-deletion')));
    await tester.tap(find.byKey(const Key('confirm-account-deletion')));
    await tester.pump();
    expect(find.text('正在注销…'), findsOneWidget);
    expect(auth.calls, 1);
    expect(cleared, false);
    expect(tester.widget<FilledButton>(find.byType(FilledButton)).onPressed, isNull);
    done.complete();
    await tester.pumpAndSettle();
    expect(cleared, true);
    expect(find.byType(AccountDeletionPage), findsNothing);
  });

  testWidgets('接口占位错误不展示给用户，不退出账号，可重试', (tester) async {
    final auth = TestAuth(() async { throw const AuthException('HTTP_404', '客户端暂时未上线'); });
    var cleared = false;
    await openPage(tester, auth, () async { cleared = true; });
    await tester.ensureVisible(find.byKey(const Key('confirm-account-deletion')));
    await tester.tap(find.byKey(const Key('confirm-account-deletion')));
    await tester.pumpAndSettle();
    expect(find.textContaining('未上线'), findsNothing);
    expect(find.text('暂时无法完成注销，请稍后重试。'), findsOneWidget);
    expect(cleared, false);
    expect(tester.widget<FilledButton>(find.byType(FilledButton)).onPressed, isNotNull);
  });

  testWidgets('待结算时保留账号并解释原因', (tester) async {
    final auth = TestAuth(() async { throw const AuthException('ACCOUNT_UNSETTLED', 'internal details'); });
    var cleared = false;
    await openPage(tester, auth, () async { cleared = true; });
    await tester.ensureVisible(find.byKey(const Key('confirm-account-deletion')));
    await tester.tap(find.byKey(const Key('confirm-account-deletion')));
    await tester.pumpAndSettle();
    expect(find.textContaining('待确认订单'), findsWidgets);
    expect(find.textContaining('internal details'), findsNothing);
    expect(cleared, false);
  });
}
