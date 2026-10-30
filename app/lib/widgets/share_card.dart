import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';

import '../models/elf.dart';
import '../theme.dart';
import '../sharing/social_share.dart';
import '../sharing/douyin_share_adapter.dart';
import '../sharing/poster_saver.dart';
import '../sharing/wechat_share_adapter.dart';
import '../sharing/kwai_share_adapter.dart';
import 'social_share_sheet.dart';

/// 分享卡片（v1.3）：离屏渲染成 PNG，调系统分享面板。
/// 固定 360×520 逻辑尺寸，内容：AI 信息 + 人格 + 数据 + 落地页链接 + 水印。
class ShareCard extends StatelessWidget {
  final Elf elf;

  /// 可选：分享某条帖子时附上的内容摘要。
  final String? excerpt;
  final bool promotional;

  const ShareCard(
      {super.key, required this.elf, this.excerpt, this.promotional = true});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 360,
      height: 520,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: AppColors.surface,
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
                child: Text(
                  promotional ? 'OpenElf' : 'AI 创作',
                  style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                      color: Colors.white,
                      letterSpacing: 1.2),
                ),
              ),
              const Spacer(),
              Text(promotional ? '我的 AI，我做主' : '内容分享',
                  style: TextStyle(
                      fontSize: 10,
                      color: AppColors.textMuted,
                      letterSpacing: 1.5)),
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
                  style: const TextStyle(
                      fontSize: 26,
                      fontWeight: FontWeight.w700,
                      color: Colors.white),
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
                            style: TextStyle(
                                fontSize: 20,
                                fontWeight: FontWeight.w700,
                                color: AppColors.text),
                          ),
                        ),
                        const SizedBox(width: 6),
                        Text(elf.serial,
                            style: TextStyle(
                                fontSize: 11, color: AppColors.textMuted)),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(6),
                        color: AppColors.surfaceHigh,
                      ),
                      child: Text(
                        'Lv${elf.level} · ${elf.levelName}',
                        style: TextStyle(
                            fontSize: 10,
                            color: AppColors.violetSoft,
                            fontWeight: FontWeight.w600),
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
            style:
                TextStyle(fontSize: 13, color: AppColors.textSub, height: 1.6),
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
                style: TextStyle(
                    fontSize: 11.5, color: AppColors.textSub, height: 1.6),
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
          if (promotional)
            Text(
              sharePathFor(elf),
              style: TextStyle(
                  fontSize: 11, color: AppColors.cyan, letterSpacing: 0.3),
            ),
          const SizedBox(height: 6),
          Text(
            promotional ? '内容由 AI 生成 · 来 OpenElf 世界注视它' : '内容由 AI 生成',
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
          Text(value,
              style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                  color: AppColors.text)),
          const SizedBox(height: 3),
          Text(label,
              style: TextStyle(fontSize: 10, color: AppColors.textMuted)),
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
  static final _service = SocialShareService(adapters: {
    SocialChannel.kuaishou: const KwaiShareAdapter(),
    SocialChannel.wechat: const WechatShareAdapter(),
    SocialChannel.douyin: DouyinShareAdapter(),
  });
  static Object? _activeSession;

  static Future<void> shareElf(BuildContext context, Elf elf,
      {String? excerpt}) async {
    if (_activeSession != null) return;
    final session = Object();
    _activeSession = session;
    void release() {
      // An old native callback must not unlock a newer Flutter share panel.
      if (identical(_activeSession, session)) _activeSession = null;
    }

    try {
      var action = await showModalBottomSheet<ShareAction>(
        context: context,
        isScrollControlled: true,
        builder: (_) => SocialShareSheet(service: _service),
      );
      if (!context.mounted || action == null) return;
      if (action.channel?.usesManualMaterials == true) {
        action = await showManualShareOptions(context, action.channel!);
      }
      if (!context.mounted || action == null) return;
      final channel = action.channel;
      if (channel != null &&
          await _service.availability(channel) != ShareAvailability.ready) {
        if (!context.mounted) return;
        action = await confirmShareFallback(context, channel);
      }
      if (!context.mounted || action == null) return;
      var douyinScene = DouyinShareScene.contacts;
      var wechatScene = WechatShareScene.session;
      if (action.channel == SocialChannel.kuaishou) {
        if (!await confirmKwaiShare(context) || !context.mounted) return;
      }
      if (action.channel == SocialChannel.wechat) {
        final selected = await confirmWechatShare(context);
        if (selected == null || !context.mounted) return;
        wechatScene = selected;
      }
      if (action.channel == SocialChannel.douyin) {
        final selected = await confirmDouyinShare(context);
        if (selected == null || !context.mounted) return;
        douyinScene = selected;
      }
      if (action == ShareAction.copyLink) {
        await Clipboard.setData(ClipboardData(text: shareLinkFor(elf)));
        if (context.mounted) {
          ScaffoldMessenger.of(context)
              .showSnackBar(const SnackBar(content: Text('链接已复制，请自行选择应用发送')));
        }
        return;
      }
      await _shareCard(context, elf,
          onHandOff: release,
          excerpt: excerpt,
          channel: action.channel,
          douyinScene: douyinScene,
          wechatScene: wechatScene,
          preview: action == ShareAction.image);
    } catch (_) {
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('分享未完成，请稍后重试')));
      }
    } finally {
      release();
    }
  }

  static Future<void> _shareCard(BuildContext context, Elf elf,
      {required VoidCallback onHandOff,
      String? excerpt,
      SocialChannel? channel,
      bool preview = false,
      DouyinShareScene douyinScene = DouyinShareScene.contacts,
      WechatShareScene wechatScene = WechatShareScene.session}) async {
    final renderBox = context.findRenderObject();
    final origin = renderBox is RenderBox &&
            renderBox.hasSize &&
            renderBox.size.width > 0 &&
            renderBox.size.height > 0
        ? renderBox.localToGlobal(Offset.zero) & renderBox.size
        : Rect.fromCenter(
            center: MediaQuery.sizeOf(context).center(Offset.zero),
            width: 1,
            height: 1);
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
            child: ShareCard(
                elf: elf,
                excerpt: excerpt,
                promotional: channel != SocialChannel.douyin &&
                    channel != SocialChannel.kuaishou),
          ),
        ),
      ),
    );
    overlay.insert(entry);
    var overlayRemoved = false;
    try {
      // Wait for the inserted overlay to actually paint, rather than guessing
      // device speed with a fixed delay (which can leave the key unmounted).
      await WidgetsBinding.instance.endOfFrame;
      final renderObject = key.currentContext?.findRenderObject();
      if (renderObject is! RenderRepaintBoundary) throw StateError('分享卡片未就绪');
      final image = await renderObject.toImage(pixelRatio: 3);
      final ByteData? bytes;
      try {
        bytes = await image.toByteData(format: ui.ImageByteFormat.png);
      } finally {
        image.dispose();
      }
      if (bytes == null) throw StateError('分享图片生成失败');
      final png = bytes.buffer.asUint8List();
      // The render surface is no longer needed. Do not retain it while an
      // external app/sheet waits for a callback that may never arrive.
      entry.remove();
      overlayRemoved = true;
      final link = shareLinkFor(elf);
      if (!context.mounted) return;
      final text = '${elf.name} 正在 OpenElf 世界里生长，来注视它 → $link';
      if (preview) {
        final share = await showDialog<bool>(
            context: context, builder: (context) => _PosterPreview(png: png));
        if (share != true || !context.mounted) return;
      }
      if (channel != null) {
        onHandOff();
        final result = await _service.share(
            channel,
            SocialShareContent(
              title: elf.name,
              text: text,
              link: Uri.parse(link),
              png: png,
              douyinScene: douyinScene,
              wechatScene: wechatScene,
            ));
        if (context.mounted && result != SocialShareOutcome.cancelled) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(
              content: Text(
            result == SocialShareOutcome.handedOff
                ? '已交给${channel.label}，请在该应用内确认发送或发布'
                : '${channel.label}分享未完成，请重试',
          )));
        }
        return;
      }
      // Single-flight protects our own panel/preparation, not the lifetime of
      // an external share UI. iOS swipe dismissal need not return promptly.
      onHandOff();
      await Share.shareXFiles(
        [
          XFile.fromData(png,
              name: 'openelf_${elf.id}.png', mimeType: 'image/png')
        ],
        text: text,
        sharePositionOrigin: origin,
      );
    } finally {
      if (!overlayRemoved) entry.remove();
    }
  }
}

class _PosterPreview extends StatefulWidget {
  final Uint8List png;
  const _PosterPreview({required this.png});
  @override
  State<_PosterPreview> createState() => _PosterPreviewState();
}

class _PosterPreviewState extends State<_PosterPreview> {
  bool _saving = false;
  String? _message;

  Future<void> _save() async {
    if (_saving) return;
    setState(() {
      _saving = true;
      _message = null;
    });
    String? message;
    try {
      message = switch (await PosterSaver.save(widget.png)) {
        PosterSaveResult.gallery => '海报已保存到相册，请自行选择应用使用',
        PosterSaveResult.file => '海报已保存到所选位置，可自行选择发布',
        PosterSaveResult.cancelled => null,
      };
    } on PlatformException catch (error) {
      message = error.code == 'PHOTO_PERMISSION_DENIED'
          ? '未获得添加照片权限，可在系统设置中允许，或使用系统分享'
          : '海报保存失败，请重试或使用系统分享';
    } catch (_) {
      message = '海报保存失败，请重试或使用系统分享';
    }
    if (mounted) {
      setState(() {
        _saving = false;
        _message = message;
      });
    }
  }

  @override
  Widget build(BuildContext context) => Dialog(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Text('分享图预览'),
            const SizedBox(height: 12),
            Flexible(child: Image.memory(widget.png, fit: BoxFit.contain)),
            if (_message != null)
              Text(_message!, key: const ValueKey('poster-save-status')),
            if (PosterSaver.supported)
              TextButton(
                  onPressed: _saving ? null : _save,
                  child: Text(_saving ? '正在保存…' : '保存海报')),
            TextButton(
                onPressed: _saving ? null : () => Navigator.pop(context, true),
                child: const Text('系统分享')),
            TextButton(
                onPressed: () => Navigator.pop(context, false),
                child: const Text('关闭')),
          ]),
        ),
      );
}
