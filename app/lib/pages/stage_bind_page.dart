import 'package:flutter/material.dart';

import '../services/stage_bind_service.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'login_page.dart';

/// 第三方账号（舞台）绑定：抖音 / 快手 / 微信 / 哔哩哔哩。
/// 绑定后可在分享面板把 AI 创作内容一键分发到对应平台。
class StageBindPage extends StatelessWidget {
  const StageBindPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: AppBackground(
        child: SafeArea(
          bottom: false,
          child: AnimatedBuilder(
            animation: StageBindService.instance,
            builder: (context, _) => ListView(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
              children: [
                _header(context),
                const SizedBox(height: 14),
                _intro(),
                const SizedBox(height: 18),
                _section('平台账号'),
                ...StagePlatform.values.map((p) => _platformCard(context, p)),
                const SizedBox(height: 8),
                _note(),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _header(BuildContext context) => Row(
        children: [
          InkWell(
            onTap: () => Navigator.of(context).maybePop(),
            borderRadius: BorderRadius.circular(8),
            child: Padding(
              padding: const EdgeInsets.only(right: 8, top: 6, bottom: 6),
              child: Icon(
                Icons.arrow_back_ios_new,
                size: 17,
                color: AppColors.textSub,
                semanticLabel: '返回',
              ),
            ),
          ),
          Text(
            '第三方账号（舞台）',
            style: TextStyle(
              fontSize: 21,
              fontWeight: FontWeight.w700,
              color: AppColors.text,
            ),
          ),
        ],
      );

  Widget _intro() {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.strokeSoft),
        gradient: AppColors.brandGradientSoft,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '绑定后，AI 创作的内容可以从分享面板一键分发到这些平台。',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: AppColors.text,
              height: 1.6,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            '授权范围仅限内容发布，不会读取你的私信、关注与点赞；所有内容自动带「AI 生成」标识与 OpenElf 落地页链接。',
            style: TextStyle(
              fontSize: 10.5,
              color: AppColors.textMuted,
              height: 1.6,
            ),
          ),
        ],
      ),
    );
  }

  Widget _section(String text) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Text(
          text,
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w700,
            color: AppColors.textSub,
          ),
        ),
      );

  Widget _platformCard(BuildContext context, StagePlatform platform) {
    final bound = StageBindService.instance.isBound(platform);
    final at = StageBindService.instance.boundAt(platform);
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.strokeSoft),
      ),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: platform.color,
              borderRadius: BorderRadius.circular(11),
            ),
            alignment: Alignment.center,
            child: Icon(platform.icon, size: 21, color: Colors.white),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(
                      platform.label,
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: AppColors.text,
                      ),
                    ),
                    if (bound) ...[
                      const SizedBox(width: 6),
                      Container(
                        padding:
                            const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                        decoration: BoxDecoration(
                          color: AppColors.ok.withValues(alpha: 0.14),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          '已绑定',
                          style: TextStyle(
                            fontSize: 9,
                            fontWeight: FontWeight.w600,
                            color: AppColors.ok,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: 3),
                Text(
                  bound ? '已授权发布 · ${_fmtDate(at)}' : platform.hint,
                  style: TextStyle(fontSize: 10.5, color: AppColors.textMuted),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          _actionButton(context, platform, bound),
        ],
      ),
    );
  }

  Widget _actionButton(
      BuildContext context, StagePlatform platform, bool bound) {
    if (bound) {
      return Semantics(
        button: true,
        label: '解绑${platform.label}',
        child: InkWell(
          onTap: () => _confirmUnbind(context, platform),
          borderRadius: BorderRadius.circular(18),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: AppColors.strokeSoft),
            ),
            child: Text(
              '解绑',
              style: TextStyle(fontSize: 11.5, color: AppColors.textSub),
            ),
          ),
        ),
      );
    }
    return Semantics(
      button: true,
      label: '绑定${platform.label}',
      child: InkWell(
        onTap: () => _bind(context, platform),
        borderRadius: BorderRadius.circular(18),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(18),
            gradient: AppColors.brandGradient,
          ),
          child: Text(
            '绑定',
            style: TextStyle(
              fontSize: 11.5,
              fontWeight: FontWeight.w600,
              color: AppColors.onBrand,
            ),
          ),
        ),
      ),
    );
  }

  Widget _note() {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.strokeSoft),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.info_outline, size: 15, color: AppColors.textMuted),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              '当前为站内预绑定：接入平台官方授权后，绑定会跳转对应平台的授权页。解绑后该平台将从分享面板移除，已发布的作品不受影响。',
              style: TextStyle(
                fontSize: 10.5,
                color: AppColors.textMuted,
                height: 1.6,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _bind(BuildContext context, StagePlatform platform) async {
    if (!checkLoginOrPrompt(context)) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        title: Text(
          '绑定${platform.label}',
          style: TextStyle(color: AppColors.text, fontSize: 16),
        ),
        content: Text(
          '绑定后，你可以把 AI 创作的内容一键分享到${platform.label}。\n\n'
          '授权范围仅限内容发布，不会读取私信、关注与点赞。内容会自动带「AI 生成」标识。\n\n'
          '当前版本为站内预绑定，接入平台官方授权后将跳转${platform.label}授权页完成正式绑定。',
          style: TextStyle(
            fontSize: 12.5,
            color: AppColors.textMuted,
            height: 1.65,
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: Text('取消', style: TextStyle(color: AppColors.textMuted)),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text('确认绑定', style: TextStyle(color: AppColors.cyan)),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await StageBindService.instance.bind(platform);
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('已绑定${platform.label}，可在分享面板一键分发')),
    );
  }

  Future<void> _confirmUnbind(
      BuildContext context, StagePlatform platform) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        title: Text(
          '解绑${platform.label}',
          style: TextStyle(color: AppColors.text, fontSize: 16),
        ),
        content: Text(
          '解绑后，分享面板将不再提供${platform.label}的一键分发入口，已发布的作品不受影响。\n\n确认解绑？',
          style: TextStyle(
            fontSize: 12.5,
            color: AppColors.textMuted,
            height: 1.65,
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: Text('取消', style: TextStyle(color: AppColors.textMuted)),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text('确认解绑', style: TextStyle(color: AppColors.warn)),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await StageBindService.instance.unbind(platform);
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('已解绑${platform.label}')),
    );
  }

  static String _fmtDate(DateTime? at) {
    if (at == null) return '';
    return '${at.year}-${at.month.toString().padLeft(2, '0')}-${at.day.toString().padLeft(2, '0')}';
  }
}
