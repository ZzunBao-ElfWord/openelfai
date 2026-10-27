import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import '../sharing/social_share.dart';

enum ShareAction {
  system,
  copyLink,
  image,
  bilibili,
  xiaohongshu,
  douyin,
  wechat
}

extension ShareActionChannel on ShareAction {
  SocialChannel? get channel => switch (this) {
        ShareAction.bilibili => SocialChannel.bilibili,
        ShareAction.xiaohongshu => SocialChannel.xiaohongshu,
        ShareAction.douyin => SocialChannel.douyin,
        ShareAction.wechat => SocialChannel.wechat,
        _ => null,
      };
}

/// Ordinary content sharing. No account binding or auto distribution controls.
class SocialShareSheet extends StatefulWidget {
  final SocialShareService service;
  const SocialShareSheet({super.key, required this.service});
  @override
  State<SocialShareSheet> createState() => _SocialShareSheetState();
}

class _SocialShareSheetState extends State<SocialShareSheet> {
  late final Future<Map<SocialChannel, ShareAvailability>> _statuses;
  @override
  void initState() {
    super.initState();
    _statuses = _load();
  }

  Future<Map<SocialChannel, ShareAvailability>> _load() async => {
        for (final c in SocialChannel.values)
          c: await widget.service.availability(c),
      };
  @override
  Widget build(BuildContext context) => SafeArea(
      child: SingleChildScrollView(
          child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Row(children: [
                    const SizedBox(width: 48),
                    Expanded(
                        child: Text('分享至',
                            textAlign: TextAlign.center,
                            style: Theme.of(context).textTheme.titleLarge)),
                    IconButton(
                        key: const ValueKey('share-close'),
                        tooltip: '关闭分享',
                        onPressed: () => Navigator.pop(context),
                        icon: const Icon(Icons.close)),
                  ]),
                  const SizedBox(height: 14),
                  FutureBuilder<Map<SocialChannel, ShareAvailability>>(
                      future: _statuses,
                      builder: (context, snapshot) => SingleChildScrollView(
                          scrollDirection: Axis.horizontal,
                          child: Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                for (final action in [
                                  ShareAction.wechat,
                                  ShareAction.douyin,
                                  ShareAction.xiaohongshu,
                                  ShareAction.bilibili
                                ])
                                  _item(context,
                                      action: action,
                                      title: action.channel!.label,
                                      icon: switch (action) {
                                        ShareAction.wechat =>
                                          Icons.chat_bubble_outline,
                                        ShareAction.douyin => Icons.music_note,
                                        ShareAction.xiaohongshu =>
                                          Icons.auto_stories,
                                        _ => Icons.ondemand_video
                                      },
                                      color: switch (action) {
                                        ShareAction.wechat =>
                                          const Color(0xff07c160),
                                        ShareAction.douyin =>
                                          const Color(0xff222222),
                                        ShareAction.xiaohongshu =>
                                          const Color(0xffff2442),
                                        _ => const Color(0xff00a1d6)
                                      },
                                      status: switch (
                                          snapshot.data?[action.channel]) {
                                        ShareAvailability.ready => '官方分享',
                                        ShareAvailability.notConfigured =>
                                          '未配置',
                                        ShareAvailability.integrationPending =>
                                          '待接入',
                                        ShareAvailability.notInstalled => '未安装',
                                        null => '检查中',
                                      }),
                              ]))),
                  const SizedBox(height: 16),
                  const Divider(),
                  const SizedBox(height: 12),
                  SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(children: [
                        _item(context,
                            action: ShareAction.copyLink,
                            title: '复制链接',
                            icon: Icons.link),
                        _item(context,
                            action: ShareAction.image,
                            title: '生成分享图',
                            icon: Icons.image_outlined),
                        _item(context,
                            action: ShareAction.system,
                            title: '更多分享',
                            icon: Icons.ios_share),
                      ])),
                  const SizedBox(height: 14),
                  Text('仅分享当前 AI 卡片和所选内容摘要，不会自动发布或绑定账号。',
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.bodySmall),
                ],
              ))));

  Widget _item(BuildContext context,
          {required ShareAction action,
          required String title,
          required IconData icon,
          Color? color,
          String? status}) =>
      SizedBox(
          width: 86,
          child: InkWell(
              key: ValueKey('share-${action.name}'),
              borderRadius: BorderRadius.circular(12),
              onTap: () => Navigator.pop(context, action),
              child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Column(children: [
                    CircleAvatar(
                        radius: 26,
                        backgroundColor: color ??
                            Theme.of(context)
                                .colorScheme
                                .surfaceContainerHighest,
                        child: Icon(icon,
                            size: 28,
                            color: color != null
                                ? Colors.white
                                : Theme.of(context).colorScheme.onSurface)),
                    const SizedBox(height: 8),
                    Text(title, style: const TextStyle(fontSize: 12)),
                    if (status != null) ...[
                      const SizedBox(height: 3),
                      Text(status, style: const TextStyle(fontSize: 10))
                    ],
                  ]))));
}

Future<ShareAction?> confirmShareFallback(
        BuildContext context, SocialChannel channel) =>
    showDialog<ShareAction>(
        context: context,
        builder: (context) => AlertDialog(
                title: Text('${channel.label}暂不可用'),
                content: const Text(
                    '可能尚未接通，或设备未安装支持的客户端。可以打开系统面板手动选择应用，或复制链接；系统面板不保证显示所有平台。不会自动上传内容。'),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(context),
                      child: const Text('取消')),
                  TextButton(
                      onPressed: () =>
                          Navigator.pop(context, ShareAction.copyLink),
                      child: const Text('复制链接')),
                  TextButton(
                      onPressed: () =>
                          Navigator.pop(context, ShareAction.system),
                      child: const Text('系统分享')),
                ]));

Future<DouyinShareScene?> confirmDouyinShare(BuildContext context) {
  var scene = DouyinShareScene.contacts;
  return showDialog<DouyinShareScene>(
      context: context,
      builder: (context) => StatefulBuilder(
          builder: (context, setState) => AlertDialog(
                title: const Text('分享到抖音'),
                content: SingleChildScrollView(
                    child: Column(mainAxisSize: MainAxisSize.min, children: [
                  SegmentedButton<DouyinShareScene>(
                      segments: const [
                        ButtonSegment(
                            value: DouyinShareScene.contacts,
                            label: Text('好友／群')),
                        ButtonSegment(
                            value: DouyinShareScene.story, label: Text('日常')),
                      ],
                      selected: {
                        scene
                      },
                      onSelectionChanged: (value) =>
                          setState(() => scene = value.first)),
                  const SizedBox(height: 16),
                  const Text(
                      '同意后，抖音官方 SDK 会处理本次分享图片、应用信息及必要运行数据，并由你在抖音内确认发送。不读取联系人，不代替你自动发布。'),
                  if (!kIsWeb &&
                      defaultTargetPlatform == TargetPlatform.iOS) ...[
                    const SizedBox(height: 12),
                    const Text(
                        'iOS 需要相册权限：本次卡片会保存到系统相册，并将该卡片交给抖音。保存的图片会留在相册，可由你自行删除。'),
                  ],
                ])),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(context),
                      child: const Text('取消')),
                  TextButton(
                      onPressed: () => Navigator.pop(context, scene),
                      child: const Text('同意并继续')),
                ],
              )));
}
