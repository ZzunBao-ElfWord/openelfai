import 'package:flutter/foundation.dart';
import 'package:openelf_wechat_share/openelf_wechat_share.dart';
import 'social_share.dart';
import 'wechat_share_config.dart';

class WechatShareAdapter implements SocialShareAdapter {
  final String appId;
  final String universalLink;
  final bool iosAssociationReady;
  const WechatShareAdapter(
      {this.appId = WechatShareConfig.appId,
      this.universalLink = WechatShareConfig.universalLink,
      this.iosAssociationReady = WechatShareConfig.iosAssociationReady});
  @override
  SocialChannel get channel => SocialChannel.wechat;
  @override
  Future<ShareAvailability> availability() async {
    if (appId.isEmpty) return ShareAvailability.notConfigured;
    if (!RegExp(r'^wx[0-9a-fA-F]{16}$').hasMatch(appId) ||
        kIsWeb ||
        ![TargetPlatform.android, TargetPlatform.iOS]
            .contains(defaultTargetPlatform)) {
      return ShareAvailability.integrationPending;
    }
    if (defaultTargetPlatform == TargetPlatform.iOS &&
        (!iosAssociationReady ||
            universalLink != WechatShareConfig.universalLink)) {
      return ShareAvailability.integrationPending;
    }
    try {
      return switch (
          await OpenElfWechatShare.availability(appId, universalLink)) {
        'ready' => ShareAvailability.ready,
        'notInstalled' => ShareAvailability.notInstalled,
        'notConfigured' => ShareAvailability.notConfigured,
        _ => ShareAvailability.integrationPending,
      };
    } catch (_) {
      return ShareAvailability.integrationPending;
    }
  }

  @override
  Future<SocialShareOutcome> share(SocialShareContent content) async {
    if (await availability() != ShareAvailability.ready) {
      throw StateError('微信分享尚未配置完成');
    }
    const header = [137, 80, 78, 71, 13, 10, 26, 10];
    if (content.png.length < 8 ||
        content.png.length > 8 * 1024 * 1024 ||
        List.generate(8, (i) => content.png[i] == header[i]).contains(false)) {
      throw ArgumentError('微信分享图片无效');
    }
    try {
      final outcome = await OpenElfWechatShare.share(
          appId: appId,
          universalLink: universalLink,
          png: content.png,
          scene: content.wechatScene.name);
      return switch (outcome) {
        'handedOff' => SocialShareOutcome.handedOff,
        'cancelled' => SocialShareOutcome.cancelled,
        _ => SocialShareOutcome.failed,
      };
    } catch (_) {
      return SocialShareOutcome.failed;
    }
  }
}
