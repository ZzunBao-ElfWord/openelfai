import 'dart:async';
import 'dart:typed_data';
import 'dart:ui' as ui;
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:share_plus/share_plus.dart';
import 'package:openelf_douyin_share/openelf_douyin_share.dart';
import '../models/elf.dart';
import '../services/stage_bind_service.dart';
import '../sharing/work_material.dart';

enum WorkShareAction {
  douyin,
  kuaishou,
  wechat,
  bilibili,
  workbuddy,
  system,
  copy
}

class WorkShareHelper {
  static Object? _session;
  static Future<void> share(BuildContext context, ElfPost post) async {
    if (_session != null) return;
    final session = Object();
    _session = session;
    void release() {
      if (identical(_session, session)) _session = null;
    }

    final client = http.Client();
    try {
      final action = await showModalBottomSheet<WorkShareAction>(
          context: context,
          isScrollControlled: true,
          builder: (ctx) => const WorkShareSheet());
      if (action == null || !context.mounted) return;
      if (action == WorkShareAction.copy) {
        await Clipboard.setData(
            ClipboardData(text: WorkMaterialLoader.caption(post)));
        if (context.mounted) _message(context, '作品全文已复制');
        return;
      }
      final douyin = action == WorkShareAction.douyin;
      if (douyin) {
        final accepted = await showDialog<bool>(
            context: context,
            builder: (ctx) => AlertDialog(
                    title: const Text('交给抖音发布'),
                    content: const Text(
                        '同意后准备本次作品素材，并在支持的设备上调用抖音官方分享 SDK。请在抖音内确认发布和 AI 生成标识；不会绑定账号或自动发布。文案可在分享面板复制，是否预填由平台决定。'),
                    actions: [
                      TextButton(
                          onPressed: () => Navigator.pop(ctx),
                          child: const Text('取消')),
                      TextButton(
                          onPressed: () => Navigator.pop(ctx, true),
                          child: const Text('同意并继续'))
                    ]));
        if (accepted != true || !context.mounted) return;
      }
      final media = MediaQuery.sizeOf(context);
      final origin = Rect.fromCenter(
          center: media.center(Offset.zero), width: 1, height: 1);
      final material = await _loadWithProgress(context, client, post);
      if (material == null || !context.mounted) return;
      if (douyin &&
          !kIsWeb &&
          defaultTargetPlatform == TargetPlatform.android) {
        if (await OpenElfDouyinShare.availability() != 'ready') {
          _message(context, '请安装抖音主版后重试，未发布作品');
          return;
        }
        final video = material.mime == 'video/mp4';
        final bytes =
            video ? material.bytes! : await _publicationImage(material);
        if (!context.mounted) return;
        release();
        final outcome = await OpenElfDouyinShare.shareWork(bytes, video: video);
        if (context.mounted && outcome != 'cancelled')
          _message(
              context,
              outcome == 'handedOff'
                  ? '抖音已处理分享请求，请在抖音内核对发布状态'
                  : '抖音未确认交接，请重试；未标记为已发布');
        return;
      }
      final platform = switch (action) {
        WorkShareAction.kuaishou => StagePlatform.kuaishou,
        WorkShareAction.wechat => StagePlatform.wechat,
        WorkShareAction.bilibili => StagePlatform.bilibili,
        _ => null,
      };
      if (platform != null &&
          !kIsWeb &&
          defaultTargetPlatform == TargetPlatform.android) {
        release();
        final status = await StageShareService.shareToApp(
            platform: platform,
            text: material.text,
            mediaBytes: material.bytes,
            mimeType: material.mime,
            title: 'AI 创作作品');
        if (!context.mounted) return;
        if (status == StageShareStatus.ok) {
          _message(context, '已交给${platform.label}，请在该应用中确认；不代表已发布');
          return;
        }
        final fallback = await showDialog<bool>(
            context: context,
            builder: (ctx) => AlertDialog(
                    title: const Text('未能交给目标平台'),
                    content: const Text('目标平台未安装或不支持此次素材，是否自行选择系统分享？'),
                    actions: [
                      TextButton(
                          onPressed: () => Navigator.pop(ctx),
                          child: const Text('取消')),
                      TextButton(
                          onPressed: () => Navigator.pop(ctx, true),
                          child: const Text('系统分享'))
                    ]));
        if (fallback != true || !context.mounted) return;
      } else if (douyin) {
        // Existing iOS profile-card SDK remains unchanged. Work media uses the
        // system share extension until native work publishing is verified there.
        _message(context, '本设备通过系统面板交接作品，请自行选择目标应用');
      }
      release();
      if (material.bytes == null) {
        await Share.share(material.text, sharePositionOrigin: origin);
      } else {
        await Share.shareXFiles([
          XFile.fromData(material.bytes!,
              name: material.filename, mimeType: material.mime)
        ], text: material.text, sharePositionOrigin: origin);
      }
    } on FormatException catch (error) {
      if (context.mounted) _message(context, error.message);
    } catch (_) {
      if (context.mounted) _message(context, '作品分享未完成，未标记为已发布，请重试');
    } finally {
      client.close();
      release();
    }
  }

  static void _message(BuildContext context, String message) =>
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(message)));

  static Future<WorkMaterial?> _loadWithProgress(
      BuildContext context, http.Client client, ElfPost post) async {
    final navigator = Navigator.of(context, rootNavigator: true);
    var cancelled = false;
    late DialogRoute<void> route;
    route = DialogRoute<void>(
        context: context,
        barrierDismissible: false,
        builder: (_) => PopScope(
            canPop: false,
            child: AlertDialog(
              title: const Text('准备作品素材'),
              content: const Row(children: [
                SizedBox(
                    width: 24, height: 24, child: CircularProgressIndicator()),
                SizedBox(width: 16),
                Expanded(child: Text('正在下载本次作品，网络较慢时请稍候。不会自动发布。'))
              ]),
              actions: [
                TextButton(
                    onPressed: () {
                      cancelled = true;
                      client.close();
                      if (route.isActive) navigator.removeRoute(route);
                    },
                    child: const Text('取消'))
              ],
            )));
    unawaited(navigator.push(route));
    try {
      final material = await WorkMaterialLoader(client).load(post);
      return cancelled ? null : material;
    } catch (_) {
      if (cancelled) return null;
      rethrow;
    } finally {
      if (route.isActive) navigator.removeRoute(route);
    }
  }

  static Future<Uint8List> _publicationImage(WorkMaterial material) async {
    if (material.bytes != null) {
      if (material.bytes!.length > 8 * 1024 * 1024)
        throw const FormatException('图片超过8MB，请压缩后再分享');
      final codec = await ui.instantiateImageCodec(material.bytes!);
      try {
        final frame = await codec.getNextFrame();
        try {
          final png =
              await frame.image.toByteData(format: ui.ImageByteFormat.png);
          if (png == null || png.lengthInBytes > 8 * 1024 * 1024)
            throw const FormatException('图片无法转换为可分享格式');
          return png.buffer.asUint8List(png.offsetInBytes, png.lengthInBytes);
        } finally {
          frame.image.dispose();
        }
      } finally {
        codec.dispose();
      }
    }
    // Text becomes a complete work image, not an AI profile-card excerpt.
    final painter = TextPainter(
        text: TextSpan(
            text: material.text,
            style: const TextStyle(
                color: Colors.black, fontSize: 28, height: 1.5)),
        textDirection: TextDirection.ltr)
      ..layout(maxWidth: 648);
    try {
      final height = (painter.height + 72).ceil().clamp(360, 2100);
      if (painter.height + 72 > 2100)
        throw const FormatException('正文较长，请先复制作品全文后在平台编辑；未截断或发送部分正文');
      final recorder = ui.PictureRecorder();
      final canvas = Canvas(recorder)
        ..drawRect(Rect.fromLTWH(0, 0, 720, height.toDouble()),
            Paint()..color = Colors.white);
      painter.paint(canvas, const Offset(36, 36));
      final picture = recorder.endRecording();
      final image = await picture.toImage(720, height);
      picture.dispose();
      try {
        final png = await image.toByteData(format: ui.ImageByteFormat.png);
        if (png == null) throw const FormatException('作品图片生成失败');
        return png.buffer.asUint8List(png.offsetInBytes, png.lengthInBytes);
      } finally {
        image.dispose();
      }
    } finally {
      painter.dispose();
    }
  }
}

class WorkShareSheet extends StatelessWidget {
  const WorkShareSheet({super.key});

  List<(WorkShareAction, String, String)> get _items {
    const platforms = [
      (WorkShareAction.douyin, '抖音', '编辑／发布作品'),
      (WorkShareAction.kuaishou, '快手', '交接原始素材，需客户端支持'),
      (WorkShareAction.wechat, '微信', '交给微信确认发送'),
      (WorkShareAction.bilibili, '哔哩哔哩', '交接素材，不代表已开通投稿权限'),
    ];
    bool preferred(WorkShareAction action) =>
        StageBindService.instance.isBound(StagePlatform.byId(action.name)!);
    return [
      ...platforms.where((item) => preferred(item.$1)),
      ...platforms.where((item) => !preferred(item.$1)),
      (WorkShareAction.workbuddy, 'WorkBuddy', '通过系统分享自行选择'),
      (WorkShareAction.system, '系统分享', '选择设备支持的应用'),
      (WorkShareAction.copy, '复制作品全文', '包含 AI 生成标识和回流链接'),
    ];
  }

  @override
  Widget build(BuildContext context) => SafeArea(
          child: SingleChildScrollView(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
        const ListTile(
            title: Text('分享这条 AI 作品'),
            subtitle: Text('分享当前作品的原图、视频或完整正文，不是 AI 资料卡。最终发布由你在目标平台确认。')),
        for (final item in _items)
          ListTile(
              title: Text(item.$2),
              subtitle: Text(item.$3),
              onTap: () => Navigator.pop(context, item.$1)),
        TextButton(
            onPressed: () => Navigator.pop(context), child: const Text('取消')),
      ])));
}
