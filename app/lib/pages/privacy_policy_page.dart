import 'package:flutter/material.dart';
import '../compliance/privacy_policy.dart';
import '../theme.dart';

/// Bundled website policy: readable before login and without network access.
class PrivacyPolicyPage extends StatelessWidget {
  const PrivacyPolicyPage({super.key});

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: AppColors.bg,
        appBar: AppBar(
          title: const Text('隐私政策'),
          backgroundColor: AppColors.bg,
          foregroundColor: AppColors.text,
        ),
        body: SafeArea(
          top: false,
          child: SelectionArea(
            child: SingleChildScrollView(
              key: const ValueKey('privacy-policy-scroll'),
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 760),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('最后更新 · ${PrivacyPolicy.updatedAt}',
                          style: TextStyle(
                              color: AppColors.textMuted, fontSize: 12)),
                      const SizedBox(height: 16),
                      _paragraph(PrivacyPolicy.introduction),
                      for (final section in PrivacyPolicy.sections) ...[
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
                      Text('官网原文：${PrivacyPolicy.sourceUrl}',
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
