import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:share_plus/share_plus.dart';

import '../models/elf.dart';
import '../theme.dart';

/// 分享卡片（v1.3）：离屏渲染成 PNG，调系统分享面板。
/// 固定 360×520 逻辑尺寸，内容：AI 信息 + 人格 + 数据 + 落地页链接 + 水印。
class ShareCard extends StatelessWidget {
  final Elf elf;

  /// 可选：分享某条帖子时附上的内容摘要。
  final String? excerpt;

  const ShareCard({super.key, required this.elf, this.excerpt});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 360,
      height: 520,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: AppColors.bgDeep,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.strokeSoft),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 品牌行
          Row(
            children: [
              ShaderMask(
                blendMode: BlendMode.srcIn,
                shaderCallback: (r) => AppColors.brandGradient.createShader(r),
                child: const Text(
                  'OpenElf',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: Colors.white, letterSpacing: 1.2),
                ),
              ),
              const Spacer(),
              const Text('我的 AI，我做主', style: TextStyle(fontSize: 10, color: AppColors.textMuted, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 26),

          // AI 信息
          Row(
            children: [
              Container(
                width: 64,
                height: 64,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(19),
                  gradient: AppColors.brandGradient,
                ),
                alignment: Alignment.center,
                child: Text(
                  elf.initial,
                  style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w700, color: Colors.white),
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(
                          child: Text(
                            elf.name,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: AppColors.text),
                          ),
                        ),
                        const SizedBox(width: 6),
                        Text(elf.serial, style: const TextStyle(fontSize: 11, color: AppColors.textMuted)),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(6),
                        color: AppColors.surfaceHigh,
                      ),
                      child: Text(
                        'Lv${elf.level} · ${elf.levelName}',
                        style: const TextStyle(fontSize: 10, color: AppColors.violetSoft, fontWeight: FontWeight.w600),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 20),

          // 人格
          Text(
            '「${elf.persona}」',
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 13, color: AppColors.textSub, height: 1.6),
          ),
          const SizedBox(height: 18),

          // 可选：帖子摘要
          if (excerpt != null) ...[
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(10),
                color: AppColors.surface,
              ),
              child: Text(
                excerpt!,
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 11.5, color: AppColors.textSub, height: 1.6),
              ),
            ),
            const SizedBox(height: 18),
          ],

          // 三行数据
          Row(
            children: [
              _stat('本周注视', _fmt(elf.attention)),
              _stat('粉丝', _fmt(elf.followers)),
              _stat('回声', _fmt(elf.echo)),
            ],
          ),
          const Spacer(),

          // 链接 + 标识
          Text(
            sharePathFor(elf),
            style: const TextStyle(fontSize: 11, color: AppColors.cyan, letterSpacing: 0.3),
          ),
          const SizedBox(height: 6),
          const Text(
            '内容由 AI 生成 · 来 OpenElf 世界注视它',
            style: TextStyle(fontSize: 9.5, color: AppColors.textFaint),
          ),
        ],
      ),
    );
  }

  Widget _stat(String label, String value) {
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(value, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: AppColors.text)),
          const SizedBox(height: 3),
          Text(label, style: const TextStyle(fontSize: 10, color: AppColors.textMuted)),
        ],
      ),
    );
  }

  static String _fmt(int n) {
    if (n >= 10000) return '${(n / 10000).toStringAsFixed(1)}w';
    if (n >= 1000) return '${(n / 1000).toStringAsFixed(1)}k';
    return '$n';
  }
}

/// 落地页完整链接（query 带展示参数，H5 零后端渲染）。
String shareLinkFor(Elf elf) {
  final q = Uri(queryParameters: {
    'id': elf.id,
    'name': elf.name,
    'serial': elf.serial,
    'level': elf.levelName,
    'attention': '${elf.attention}',
    'followers': '${elf.followers}',
    'echo': '${elf.echo}',
    'persona': elf.persona,
    'ref': 'share',
  }).query;
  return 'https://openelfai.com/e/?$q';
}

/// 卡片上展示的短链文本（query 太长不印全）。
String sharePathFor(Elf elf) => 'openelfai.com/e/?id=${elf.id}';

/// 分享工具：把 ShareCard 插到 Overlay 离屏渲染 → 截图 → 系统分享面板。
class ShareHelper {
  static Future<void> shareElf(BuildContext context, Elf elf, {String? excerpt}) async {
    final key = GlobalKey();
    final overlay = Overlay.of(context);
    final entry = OverlayEntry(
      builder: (_) => Positioned(
        left: -2000,
        top: 0,
        child: Material(
          color: Colors.transparent,
          child: RepaintBoundary(
            key: key,
            child: ShareCard(elf: elf, excerpt: excerpt),
          ),
        ),
      ),
    );
    overlay.insert(entry);
    try {
      // 等两帧，确保离屏内容完成布局与绘制
      await Future.delayed(const Duration(milliseconds: 80));
      final renderObject = key.currentContext?.findRenderObject();
      if (renderObject is! RenderRepaintBoundary) return;
      final image = await renderObject.toImage(pixelRatio: 3);
      final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
      if (bytes == null) return;
      final png = bytes.buffer.asUint8List();
      final link = shareLinkFor(elf);
      await Share.shareXFiles(
        [XFile.fromData(png, name: 'openelf_${elf.id}.png', mimeType: 'image/png')],
        text: '${elf.name} 正在 OpenElf 世界里生长，来注视它 → $link',
      );
    } finally {
      entry.remove();
    }
  }
}
