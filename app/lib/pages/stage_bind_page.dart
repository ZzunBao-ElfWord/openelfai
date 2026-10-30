import 'package:flutter/material.dart';

import '../services/stage_bind_service.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'login_page.dart';

/// 常用分享平台偏好；不代表第三方账号授权，不限制作品分享。
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
                _section('常用平台'),
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
            '作品分享平台',
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
            '在 AI 作品上点击“分享作品”，选择平台，将本次图片、视频或正文交给对应客户端。',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: AppColors.text,
              height: 1.6,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            '最终发送或发布由你在目标平台确认。设置常用平台不代表账号授权；不会自动发布或读取私信、关注与点赞。',
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
                        padding: const EdgeInsets.symmetric(
                            horizontal: 5, vertical: 1),
                        decoration: BoxDecoration(
                          color: AppColors.ok.withValues(alpha: 0.14),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          '常用',
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
                  bound ? '已设为常用 · ${_fmtDate(at)}' : platform.hint,
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
        label: '移除${platform.label}',
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
              '移除',
              style: TextStyle(fontSize: 11.5, color: AppColors.textSub),
            ),
          ),
        ),
      );
    }
    return Semantics(
      button: true,
      label: '设为常用：${platform.label}',
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
            '设为常用',
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
              '这里只保存本机常用平台偏好，不是平台账号授权。无需预绑定即可分享；平台未安装、权限不足或不支持时会明确提示，可自行选择系统分享。',
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
          '设为常用：${platform.label}',
          style: TextStyle(color: AppColors.text, fontSize: 16),
        ),
        content: Text(
          '设为常用后，分享时会优先展示${platform.label}。\n\n'
          '这只是本机偏好，不授予发布权限，不读取私信、关注与点赞。\n\n'
          '在作品分享面板交接素材后，需要你在目标平台确认发送或发布。',
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
            child: Text('设为常用', style: TextStyle(color: AppColors.cyan)),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await StageBindService.instance.bind(platform);
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('已将${platform.label}设为常用分享平台')),
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
          '移除${platform.label}',
          style: TextStyle(color: AppColors.text, fontSize: 16),
        ),
        content: Text(
          '移除后仅取消常用排序，仍可在分享面板选择该平台，不影响已发布作品。\n\n确认移除？',
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
            child: Text('确认移除', style: TextStyle(color: AppColors.warn)),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await StageBindService.instance.unbind(platform);
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('已移除${platform.label}')),
    );
  }

  static String _fmtDate(DateTime? at) {
    if (at == null) return '';
    return '${at.year}-${at.month.toString().padLeft(2, '0')}-${at.day.toString().padLeft(2, '0')}';
  }
}
