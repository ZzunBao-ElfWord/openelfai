import 'dart:typed_data';

enum SocialChannel { bilibili, xiaohongshu, douyin, wechat }

enum ShareAvailability {
  notConfigured,
  integrationPending,
  notInstalled,
  ready
}

enum DouyinShareScene { contacts, story }

enum SocialShareOutcome { handedOff, cancelled, failed }

extension SocialChannelLabel on SocialChannel {
  String get label => switch (this) {
        SocialChannel.bilibili => '哔哩哔哩',
        SocialChannel.xiaohongshu => '小红书',
        SocialChannel.douyin => '抖音',
        SocialChannel.wechat => '微信',
      };
}

/// Public application IDs only. Never put AppSecret/access tokens in Dart.
class SocialShareConfig {
  final Map<SocialChannel, String> publicAppIds;
  const SocialShareConfig({this.publicAppIds = const {}});
  static const build = SocialShareConfig(publicAppIds: {
    SocialChannel.bilibili:
        String.fromEnvironment('OPENELF_SHARE_BILIBILI_APP_ID'),
    SocialChannel.xiaohongshu:
        String.fromEnvironment('OPENELF_SHARE_XIAOHONGSHU_APP_ID'),
    // Must match both native SDKs and the registered iOS URL scheme.
    SocialChannel.douyin: 'awf8w18qtnqq1kum',
    SocialChannel.wechat: String.fromEnvironment('OPENELF_SHARE_WECHAT_APP_ID'),
  });
  bool configured(SocialChannel channel) =>
      publicAppIds[channel]?.trim().isNotEmpty ?? false;
}

/// Prepared after explicit user action, with no account credentials.
class SocialShareContent {
  final String title;
  final String text;
  final Uri link;
  final Uint8List png;
  final DouyinShareScene douyinScene;
  const SocialShareContent(
      {required this.title,
      required this.text,
      required this.link,
      required this.png,
      this.douyinScene = DouyinShareScene.contacts});
}

/// Implement using approved SDK/API after credentials and permissions are issued.
/// handedOff means SDK acceptance, not proof of publication.
abstract interface class SocialShareAdapter {
  SocialChannel get channel;
  Future<ShareAvailability> availability();
  Future<SocialShareOutcome> share(SocialShareContent content);
}

class SocialShareService {
  final SocialShareConfig config;
  final Map<SocialChannel, SocialShareAdapter> _adapters;
  SocialShareService(
      {this.config = SocialShareConfig.build,
      Map<SocialChannel, SocialShareAdapter> adapters = const {}})
      : _adapters = Map.unmodifiable(adapters) {
    for (final entry in _adapters.entries) {
      if (entry.value.channel != entry.key) throw ArgumentError('分享适配器与渠道不匹配');
    }
  }

  Future<ShareAvailability> availability(SocialChannel channel) async {
    if (!config.configured(channel)) return ShareAvailability.notConfigured;
    final adapter = _adapters[channel];
    if (adapter == null) return ShareAvailability.integrationPending;
    try {
      return await adapter.availability();
    } catch (_) {
      return ShareAvailability.integrationPending;
    }
  }

  Future<SocialShareOutcome> share(
      SocialChannel channel, SocialShareContent content) async {
    if (await availability(channel) != ShareAvailability.ready) {
      throw StateError('${channel.label}尚未接通');
    }
    if (content.link.scheme != 'https' ||
        content.link.host != 'openelfai.com' ||
        content.png.isEmpty) {
      throw ArgumentError('分享素材无效');
    }
    try {
      return await _adapters[channel]!.share(content);
    } catch (_) {
      return SocialShareOutcome.failed;
    }
  }
}
