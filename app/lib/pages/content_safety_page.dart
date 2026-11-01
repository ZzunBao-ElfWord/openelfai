import 'package:flutter/material.dart';

import '../models/app_content.dart';
import '../services/app_content_service.dart';
import '../services/platform_api.dart';
import '../theme.dart';
import '../widgets/common.dart';

/// 内容安全：阅读并同意《社区规范》。
/// 服务端在首次发布动态/评论时校验同意状态，未同意会被拦截。
class ContentSafetyPage extends StatefulWidget {
  const ContentSafetyPage({super.key});

  /// 与服务端 community.js acceptTerms 的校验版本保持一致。
  static const String termsVersion = '2026-10-28';

  @override
  State<ContentSafetyPage> createState() => _ContentSafetyPageState();
}

class _ContentSafetyPageState extends State<ContentSafetyPage> {
  bool _loading = true;
  bool _loggedIn = true;
  bool _accepted = false;
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final accepted = await PlatformApi.instance.fetchCommunityTermsAccepted();
      if (!mounted) return;
      setState(() {
        _accepted = accepted;
        _loading = false;
      });
    } on PlatformApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        // 未登录时仍可阅读规范，只是不能点同意。
        _loggedIn = error.code != 'UNAUTHORIZED';
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _loading = false);
    }
  }

  Future<void> _accept() async {
    if (_submitting) return;
    setState(() => _submitting = true);
    String? failure;
    try {
      await PlatformApi.instance
          .acceptCommunityTerms(ContentSafetyPage.termsVersion);
    } on PlatformApiException catch (error) {
      failure = error.message;
    } catch (_) {
      failure = '网络异常，请稍后重试';
    }
    if (!mounted) return;
    setState(() {
      _submitting = false;
      if (failure == null) _accepted = true;
    });
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(failure ?? '已同意《社区规范》，可以去发布了')),
    );
  }

  @override
  Widget build(BuildContext context) {
    final document =
        AppContentService.instance.content.value.document('community');
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: AppBackground(
        child: SafeArea(
          bottom: false,
          child: Column(
            children: [
              Row(
                children: [
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: Icon(Icons.arrow_back_ios_new,
                        size: 17, color: AppColors.textSub),
                  ),
                  Text(
                    '内容安全',
                    style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                        color: AppColors.text),
                  ),
                ],
              ),
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
                  children: [
                    _statusCard(),
                    const SizedBox(height: 14),
                    _documentCard(document),
                  ],
                ),
              ),
              if (!_loading && _loggedIn && !_accepted) _agreeBar(),
            ],
          ),
        ),
      ),
    );
  }

  Widget _statusCard() {
    final Color color;
    final IconData icon;
    final String text;
    if (_loading) {
      color = AppColors.textMuted;
      icon = Icons.hourglass_top_rounded;
      text = '正在查询同意状态…';
    } else if (!_loggedIn) {
      color = AppColors.textMuted;
      icon = Icons.lock_outline;
      text = '登录后才能同意并发布内容';
    } else if (_accepted) {
      color = AppColors.cyan;
      icon = Icons.verified_outlined;
      text = '已同意《社区规范》v${ContentSafetyPage.termsVersion}';
    } else {
      color = AppColors.warn;
      icon = Icons.error_outline;
      text = '发布动态或评论前，请先阅读并同意《社区规范》';
    }
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.strokeSoft),
        color: AppColors.surface,
      ),
      child: Row(
        children: [
          Icon(icon, size: 20, color: color),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              text,
              style: TextStyle(fontSize: 12.5, color: color, height: 1.5),
            ),
          ),
        ],
      ),
    );
  }

  /// 与设置页政策文档一致的纯文本分段渲染，不使用 HTML。
  Widget _documentCard(AppContentDocument? document) {
    final body = document?.content.trim() ?? '';
    final effective = document?.effectiveDate;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.strokeSoft),
        color: AppColors.surface,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '社区规范',
            style: TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w700,
                color: AppColors.text),
          ),
          if (effective != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                '生效日期 ${effective.year}-${effective.month.toString().padLeft(2, '0')}-${effective.day.toString().padLeft(2, '0')}'
                ' · v${document!.version}',
                style: TextStyle(fontSize: 11, color: AppColors.textMuted),
              ),
            ),
          const SizedBox(height: 12),
          if (body.isEmpty)
            Text(
              '社区规范正在编写中，正文由平台在后台发布后自动同步到这里',
              style: TextStyle(
                  fontSize: 12, color: AppColors.textMuted, height: 1.5),
            )
          else
            ...body.split(RegExp(r'\n\s*\n')).map(
                  (paragraph) => Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Text(
                      paragraph.trim(),
                      style: TextStyle(
                          fontSize: 13, color: AppColors.textSub, height: 1.8),
                    ),
                  ),
                ),
        ],
      ),
    );
  }

  Widget _agreeBar() {
    return Container(
      padding: EdgeInsets.fromLTRB(
          20, 12, 20, 12 + MediaQuery.of(context).padding.bottom),
      decoration: BoxDecoration(
        color: AppColors.surface,
        border: Border(top: BorderSide(color: AppColors.strokeSoft)),
      ),
      child: SizedBox(
        width: double.infinity,
        child: DecoratedBox(
          decoration: BoxDecoration(
            gradient: AppColors.brandGradient,
            borderRadius: BorderRadius.circular(12),
          ),
          child: TextButton(
            onPressed: _submitting ? null : _accept,
            style: TextButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 13),
              foregroundColor: AppColors.onBrand,
            ),
            child: Text(
              _submitting ? '正在提交…' : '我已阅读并同意《社区规范》',
              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
            ),
          ),
        ),
      ),
    );
  }
}
