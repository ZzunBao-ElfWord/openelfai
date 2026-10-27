import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:openelf_douyin_share/openelf_douyin_share.dart';
import 'social_share.dart';

class DouyinShareAdapter implements SocialShareAdapter {
  @override
  SocialChannel get channel => SocialChannel.douyin;
  @override
  Future<ShareAvailability> availability() async {
    if (kIsWeb ||
        ![TargetPlatform.android, TargetPlatform.iOS]
            .contains(defaultTargetPlatform)) {
      return ShareAvailability.integrationPending;
    }
    try {
      return switch (await OpenElfDouyinShare.availability()) {
        'ready' => ShareAvailability.ready,
        'notInstalled' => ShareAvailability.notInstalled,
        _ => ShareAvailability.integrationPending,
      };
    } on MissingPluginException {
      return ShareAvailability.integrationPending;
    } on PlatformException {
      return ShareAvailability.integrationPending;
    }
  }

  @override
  Future<SocialShareOutcome> share(SocialShareContent content) async {
    final outcome =
        await OpenElfDouyinShare.share(content.png, content.douyinScene.name);
    return switch (outcome) {
      'handedOff' => SocialShareOutcome.handedOff,
      'cancelled' => SocialShareOutcome.cancelled,
      _ => SocialShareOutcome.failed,
    };
  }
}
