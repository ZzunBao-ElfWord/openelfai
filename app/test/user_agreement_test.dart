import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:openelf/compliance/user_agreement.dart';
import 'package:openelf/pages/user_agreement_page.dart';

void main() {
  test('官网用户协议十一节完整保留，不增改业务规则', () {
    expect(UserAgreement.sourceUrl, 'https://openelfai.com/terms/');
    expect(UserAgreement.updatedAt, '2026 年 10 月 27 日');
    expect(UserAgreement.sections.length, 11);
    final text = UserAgreement.sections
        .map((s) => '${s.title}\n${s.paragraphs.join('\n')}')
        .join('\n');
    for (final required in [
      '10 钻石 = 1 元',
      '不可兑换为人民币',
      'T+7',
      '分成比例为 50%',
      '不提供用户之间的寄售或转卖',
      'NFT 持有者',
      'support@openelfai.com',
      '在法律允许的范围内',
      '以更新日期较新的版本为准',
    ]) {
      expect(text, contains(required));
    }
    expect(text, isNot(contains('正在编写中')));
  });

  testWidgets('用户协议可离线阅读复制并滚动至底部', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: UserAgreementPage()));
    expect(find.text('用户协议'), findsOneWidget);
    expect(find.text(UserAgreement.introduction), findsOneWidget);
    expect(find.byType(SelectionArea), findsOneWidget);
    final scroll = tester.state<ScrollableState>(find.byType(Scrollable));
    scroll.position.jumpTo(scroll.position.maxScrollExtent);
    await tester.pumpAndSettle();
    expect(find.text('官网原文：https://openelfai.com/terms/').hitTestable(),
        findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  test('用户协议登录前及设置均有独立入口，不替换隐私政策', () {
    final login = File('lib/pages/login_page.dart').readAsStringSync();
    expect(login, contains("ValueKey('login-open-terms')"));
    expect(login, contains("ValueKey('login-open-privacy')"));
    final settings = File('lib/pages/settings_page.dart').readAsStringSync();
    expect(settings, contains('if (kind == PolicyKind.terms)'));
    expect(settings, contains('const UserAgreementPage()'));
    expect(settings, contains('const PrivacyPolicyPage()'));
  });
}
