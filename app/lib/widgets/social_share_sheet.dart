import 'package:flutter/material.dart';
import '../sharing/social_share.dart';

enum ShareAction { system, copyLink, bilibili, xiaohongshu, douyin, wechat }

extension ShareActionChannel on ShareAction {
  SocialChannel? get channel => switch (this) {
        ShareAction.bilibili => SocialChannel.bilibili,
        ShareAction.xiaohongshu => SocialChannel.xiaohongshu,
        ShareAction.douyin => SocialChannel.douyin,
        ShareAction.wechat => SocialChannel.wechat,
        _ => null,
      };
}

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
        for (final channel in SocialChannel.values)
          channel: await widget.service.availability(channel),
      };

  @override
  Widget build(BuildContext context) => SafeArea(
      child: SingleChildScrollView(
          child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
              child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('分享到', style: Theme.of(context).textTheme.titleLarge),
                    const SizedBox(height: 8),
                    const Text('将分享 AI 名称、人设、公开数据，以及所选内容摘要。请确认不含不希望公开的信息。'),
                    const SizedBox(height: 8),
                    FutureBuilder<Map<SocialChannel, ShareAvailability>>(
                        future: _statuses,
                        builder: (context, snapshot) => Column(children: [
                              for (final action in ShareAction.values
                                  .where((a) => a.channel != null))
                                ListTile(
                                    key: ValueKey('share-${action.name}'),
                                    leading: const Icon(Icons.share_outlined),
                                    title: Text(action.channel!.label),
                                    subtitle: Text(switch (
                                        snapshot.data?[action.channel]) {
                                      ShareAvailability.ready => '使用已接通的官方分享能力',
                                      ShareAvailability.notConfigured =>
                                        '未配置 · 可选择系统分享',
                                      ShareAvailability.integrationPending =>
                                        '待接入 · 可选择系统分享',
                                      null => '正在检查渠道状态',
                                    }),
                                    onTap: () =>
                                        Navigator.pop(context, action)),
                            ])),
                    const Divider(),
                    ListTile(
                        key: const ValueKey('share-system'),
                        leading: const Icon(Icons.ios_share),
                        title: const Text('系统分享'),
                        subtitle: const Text('在系统面板中手动选择支持分享的应用'),
                        onTap: () =>
                            Navigator.pop(context, ShareAction.system)),
                    ListTile(
                        key: const ValueKey('share-copyLink'),
                        leading: const Icon(Icons.link),
                        title: const Text('复制链接'),
                        onTap: () =>
                            Navigator.pop(context, ShareAction.copyLink)),
                  ]))));
}

Future<ShareAction?> confirmShareFallback(
        BuildContext context, SocialChannel channel) =>
    showDialog<ShareAction>(
        context: context,
        builder: (context) => AlertDialog(
                title: Text('${channel.label}暂未接通'),
                content: const Text(
                    '当前还不能通过官方接口直接分享。你可以打开系统分享面板，手动选择该应用（是否显示由该应用和系统决定），或复制链接。不会自动上传或发布内容。'),
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
