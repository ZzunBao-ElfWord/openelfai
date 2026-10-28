import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:openelf/compliance/user_agreement.dart';
import 'package:openelf/pages/user_agreement_page.dart';

void main() {
  test('用户确认的站内资源协议保持十一节并明确无NFT和钻石转现', () {
    expect(UserAgreement.sourceUrl, 'https://openelfai.com/terms/');
    expect(UserAgreement.updatedAt, '2026 年 10 月 28 日');
    expect(UserAgreement.sections.length, 11);
    final text = UserAgreement.sections
        .map((s) => '${s.title}\n${s.paragraphs.join('\n')}')
        .join('\n');
    for (final required in [
      'Apple 内购页面实际显示',
      '不可兑换为人民币',
      'T+7',
      '分成比例为 50%',
      '不提供寄售或转卖',
      '不是链上 NFT',
      '免费转赠使用权限',
      '测试环境收益没有现金价值',
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
    expect(find.textContaining('官网协议参考：https://openelfai.com/terms/').hitTestable(),
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
