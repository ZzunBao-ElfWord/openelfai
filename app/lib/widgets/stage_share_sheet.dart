import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

import '../models/elf.dart';
import '../pages/stage_bind_page.dart';
import '../services/stage_bind_service.dart';
import '../theme.dart';
import 'share_card.dart';

/// 分享面板：系统分享（分享卡片）+ 已绑定的第三方平台一键分发。
/// 未绑定的平台点击后跳转绑定页，绑定完成再回来分享。
Future<void> showStageShare(
  BuildContext context, {
  required Elf elf,
  String? excerpt,
}) async {
  final selection = await showModalBottomSheet<_ShareSelection>(
    context: context,
    backgroundColor: Colors.transparent,
    isScrollControlled: true,
    builder: (_) => _StageShareSheet(elf: elf, excerpt: excerpt),
  );
  if (selection == null || !context.mounted) return;

  final platform = selection.platform;
  if (platform == null) {
    await ShareHelper.shareElf(context, elf, excerpt: excerpt);
    return;
  }

  if (!StageBindService.instance.isBound(platform)) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('绑定${platform.label}后即可一键分发')),
    );
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => const StageBindPage()),
    );
    return;
  }

  final text = stageCaption(elf, excerpt, platform);
  final png = await ShareHelper.renderCardPng(context, elf, excerpt: excerpt);
  if (!context.mounted) return;
  final status = await StageShareService.shareToApp(
    platform: platform,
    text: text,
    imageBytes: png,
    title: '${elf.name} · OpenElf',
  );
  if (!context.mounted || status == StageShareStatus.ok) return;

  // 目标 App 未安装、没有分享入口或当前平台不支持定向拉起时，统一回退系统分享。
  if (status != StageShareStatus.unsupported) {
    final message = status == StageShareStatus.notInstalled
        ? '未检测到${platform.label}，已改用系统分享'
        : '${platform.label}暂不支持直接发布，已改用系统分享';
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }
  if (png == null) {
    await Share.share(text, subject: '${elf.name} · OpenElf');
    return;
  }
  await Share.shareXFiles(
    [XFile.fromData(png, name: 'openelf_${elf.id}.png', mimeType: 'image/png')],
    text: text,
    subject: '${elf.name} · OpenElf',
  );
}

/// 站外分发文案：内容摘要 + AI 生成标识 + 落地页回流链接。
String stageCaption(Elf elf, String? excerpt, StagePlatform platform) {
  final body = (excerpt ?? '').trim();
  final head = body.isEmpty ? '「${elf.name}」的新作品' : body;
  final tags = platform == StagePlatform.bilibili || platform == StagePlatform.wechat
      ? ''
      : '\n\n#AI创作 #AI网红 #OpenElf';
  return '$head\n\n来自 OpenElf 的 AI「${elf.name}」（内容由 AI 生成）$tags\n${shareLinkFor(elf)}';
}

class _ShareSelection {
  final StagePlatform? platform;
  const _ShareSelection.system() : platform = null;
  const _ShareSelection.platform(this.platform);
}

class _StageShareSheet extends StatelessWidget {
  final Elf elf;
  final String? excerpt;

  const _StageShareSheet({required this.elf, this.excerpt});

  @override
  Widget build(BuildContext context) {
    final preview = (excerpt ?? '').trim();
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(20, 10, 20, 16),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
        ),
        child: AnimatedBuilder(
          animation: StageBindService.instance,
          builder: (context, _) => Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 36,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AppColors.textFaint.withValues(alpha: 0.6),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 14),
              Row(
                children: [
                  Text(
                    '分享到',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      color: AppColors.text,
                    ),
                  ),
                  const Spacer(),
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(),
                    icon: Icon(Icons.close, size: 18, color: AppColors.textMuted),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppColors.bg,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: AppColors.strokeSoft),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      preview.isEmpty ? '「${elf.name}」的新作品' : preview,
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 11.5,
                        color: AppColors.textSub,
                        height: 1.6,
                      ),
                    ),
                    const SizedBox(height: 5),
                    Text(
                      sharePathFor(elf),
                      style: TextStyle(fontSize: 10, color: AppColors.cyan),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 18),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: _target(
                      context,
                      label: '系统分享',
                      icon: Icons.ios_share,
                      background: null,
                      status: '分享卡片',
                      onTap: () =>
                          _pick(context, const _ShareSelection.system()),
                    ),
                  ),
                  for (final platform in StagePlatform.values)
                    Expanded(
                      child: _platformTarget(context, platform),
                    ),
                ],
              ),
              const SizedBox(height: 14),
              Text(
                '分享内容会自动带「内容由 AI 生成」标识与 OpenElf 落地页链接，站外回流可计入该 AI 的影响力。',
                style: TextStyle(
                  fontSize: 10,
                  color: AppColors.textFaint,
                  height: 1.6,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _platformTarget(BuildContext context, StagePlatform platform) {
    final bound = StageBindService.instance.isBound(platform);
    return _target(
      context,
      label: platform.label,
      icon: platform.icon,
      background: platform.color,
      status: bound ? '已绑定' : '去绑定',
      statusColor: bound ? AppColors.ok : AppColors.cyan,
      onTap: () => _pick(context, _ShareSelection.platform(platform)),
    );
  }

  /// 延迟到本次点击手势结束后再关闭面板，避免关闭瞬间点击穿透到下层的
  /// 信息流（表现为误进视频播放页、盖住随后的系统分享面板）。
  void _pick(BuildContext context, _ShareSelection selection) {
    Future.delayed(const Duration(milliseconds: 180), () {
      if (context.mounted) Navigator.of(context).pop(selection);
    });
  }

  Widget _target(
    BuildContext context, {
    required String label,
    required IconData icon,
    required Color? background,
    required String status,
    Color? statusColor,
    required VoidCallback onTap,
  }) {
    return Semantics(
      button: true,
      label: '分享到$label',
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: background,
                  gradient: background == null ? AppColors.brandGradient : null,
                ),
                alignment: Alignment.center,
                child: Icon(
                  icon,
                  size: 22,
                  color: background == null
                      ? AppColors.onBrand
                      : Colors.white,
                ),
              ),
              const SizedBox(height: 7),
              Text(
                label,
                style: TextStyle(fontSize: 11, color: AppColors.text),
              ),
              const SizedBox(height: 2),
              Text(
                status,
                style: TextStyle(
                  fontSize: 9,
                  color: statusColor ?? AppColors.textFaint,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
