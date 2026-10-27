import 'package:flutter/material.dart';
import '../compliance/user_agreement.dart';
import '../theme.dart';

/// Website agreement snapshot, readable before login without fetching a webpage.
class UserAgreementPage extends StatelessWidget {
  const UserAgreementPage({super.key});

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: AppColors.bg,
        appBar: AppBar(
          title: const Text('用户协议'),
          backgroundColor: AppColors.bg,
          foregroundColor: AppColors.text,
        ),
        body: SafeArea(
          top: false,
          child: SelectionArea(
            child: SingleChildScrollView(
              key: const ValueKey('user-agreement-scroll'),
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 760),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('最后更新 · ${UserAgreement.updatedAt}',
                          style: TextStyle(
                              color: AppColors.textMuted, fontSize: 12)),
                      const SizedBox(height: 16),
                      _paragraph(UserAgreement.introduction),
                      for (final section in UserAgreement.sections) ...[
                        const SizedBox(height: 20),
                        Semantics(
                          header: true,
                          child: Text(section.title,
                              style: TextStyle(
                                  fontSize: 18,
                                  fontWeight: FontWeight.w700,
                                  color: AppColors.text)),
                        ),
                        const SizedBox(height: 10),
                        for (final text in section.paragraphs) _paragraph(text),
                      ],
                      const SizedBox(height: 20),
                      Text('官网原文：${UserAgreement.sourceUrl}',
                          style: TextStyle(
                              fontSize: 12, color: AppColors.textMuted)),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      );

  Widget _paragraph(String text) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Text(text,
            style:
                TextStyle(fontSize: 14, height: 1.7, color: AppColors.textSub)),
      );
}
