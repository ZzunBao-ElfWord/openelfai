import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:openelf/compliance/privacy_policy.dart';
import 'package:openelf/pages/privacy_policy_page.dart';

void main() {
  test('原政策条款保留，并增加可选推送SDK披露', () {
    expect(PrivacyPolicy.sourceUrl, 'https://openelfai.com/privacy/');
    expect(PrivacyPolicy.updatedAt, '2026 年 10 月 29 日');
    expect(PrivacyPolicy.sections.length, 10);
    final text = PrivacyPolicy.sections
        .map((s) => '${s.title}\n${s.paragraphs.join('\n')}')
        .join('\n');
    for (final required in [
      '阿里云',
      'support@openelfai.com',
      '15 个工作日',
      '不满 14 周岁',
      '部分服务商可能位于境外',
      '已完成的交易与依法需留存的记录除外',
      '极光推送 SDK',
      '消息通知不是使用登录、浏览等基础功能的必要条件',
    ]) {
      expect(text, contains(required));
    }
    expect(text, isNot(contains('正在编写中')));
  });

  testWidgets('无需登录和网络可读，能滚动到末尾', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: PrivacyPolicyPage()));
    expect(find.text('隐私政策'), findsOneWidget);
    expect(find.text(PrivacyPolicy.introduction), findsOneWidget);
    expect(find.byType(SelectionArea), findsOneWidget);
    final scroll = tester.state<ScrollableState>(find.byType(Scrollable));
    scroll.position.jumpTo(scroll.position.maxScrollExtent);
    await tester.pumpAndSettle();
    expect(find.text('官网原文：https://openelfai.com/privacy/').hitTestable(),
        findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  test('登录前及设置隐私入口均打开真实政策页', () {
    expect(File('lib/pages/login_page.dart').readAsStringSync(),
        contains("ValueKey('login-open-privacy')"));
    final settings = File('lib/pages/settings_page.dart').readAsStringSync();
    expect(settings, contains('if (kind == PolicyKind.privacy)'));
    expect(settings, contains('const PrivacyPolicyPage()'));
  });
}
