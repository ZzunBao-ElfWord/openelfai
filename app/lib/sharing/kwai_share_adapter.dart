import 'package:flutter/foundation.dart';
import 'package:openelf_kwai_share/openelf_kwai_share.dart';
import 'pending_share_config.dart';
import 'social_share.dart';

class KwaiShareAdapter implements SocialShareAdapter {
  final String appId;
  final String universalLink;
  final bool iosAssociationReady;
  const KwaiShareAdapter(
      {this.appId = KwaiShareConfig.appId,
      this.universalLink = KwaiShareConfig.universalLink,
      this.iosAssociationReady = KwaiShareConfig.iosAssociationReady});
  @override
  SocialChannel get channel => SocialChannel.kuaishou;
  @override
  Future<ShareAvailability> availability() async {
    if (appId.isEmpty) return ShareAvailability.notConfigured;
    if (!RegExp(r'^ks[0-9]+$').hasMatch(appId) ||
        kIsWeb ||
        ![TargetPlatform.android, TargetPlatform.iOS]
            .contains(defaultTargetPlatform)) {
      return ShareAvailability.integrationPending;
    }
    if (defaultTargetPlatform == TargetPlatform.iOS &&
        (!iosAssociationReady ||
            universalLink != KwaiShareConfig.universalLink)) {
      return ShareAvailability.integrationPending;
    }
    try {
      return switch (
          await OpenElfKwaiShare.availability(appId, universalLink)) {
        'ready' => ShareAvailability.ready,
        'notInstalled' => ShareAvailability.notInstalled,
        _ => ShareAvailability.integrationPending,
      };
    } catch (_) {
      return ShareAvailability.integrationPending;
    }
  }

  @override
  Future<SocialShareOutcome> share(SocialShareContent content) async {
    if (await availability() != ShareAvailability.ready) {
      throw StateError('快手分享尚未配置完成');
    }
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (content.png.length < 8 || content.png.length > 8 * 1024 * 1024) {
      throw ArgumentError('图片无效');
    }
    for (var i = 0; i < 8; i++) {
      if (content.png[i] != signature[i]) throw ArgumentError('PNG格式无效');
    }
    try {
      return switch (
          await OpenElfKwaiShare.share(appId, universalLink, content.png)) {
        'handedOff' => SocialShareOutcome.handedOff,
        'cancelled' => SocialShareOutcome.cancelled,
        _ => SocialShareOutcome.failed,
      };
    } catch (_) {
      return SocialShareOutcome.failed;
    }
  }
}
