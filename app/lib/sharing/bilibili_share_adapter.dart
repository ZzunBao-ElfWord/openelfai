import 'dart:typed_data';

import 'social_share.dart';
import 'pending_share_config.dart';

/// Internal prepared material, NOT a Bilibili API/SDK request format.
/// No OAuth credentials, private chat history, or account-binding operations.
class BilibiliShareMaterial {
  final String title;
  final String summary;
  final Uri sourceLink;
  final List<int> png;

  BilibiliShareMaterial._(
      this.title, this.summary, this.sourceLink, Uint8List bytes)
      : png = List<int>.unmodifiable(bytes);

  factory BilibiliShareMaterial.fromContent(SocialShareContent content) {
    const header = [137, 80, 78, 71, 13, 10, 26, 10];
    // Local memory budget, not a claim about the platform's upload limits.
    if (content.title.trim().isEmpty ||
        content.png.length < header.length ||
        content.png.length > 8 * 1024 * 1024 ||
        content.link.scheme != 'https' ||
        content.link.host != 'openelfai.com' ||
        content.link.userInfo.isNotEmpty ||
        content.link.port != 443) {
      throw ArgumentError('B站分享素材无效');
    }
    for (var index = 0; index < header.length; index++) {
      if (content.png[index] != header[index]) {
        throw ArgumentError('B站分享图片必须为PNG');
      }
    }
    return BilibiliShareMaterial._(
        content.title.trim(), content.text.trim(), content.link, content.png);
  }
}

/// Implement ONLY after the app's approved ordinary-sharing capability and
/// official documentation are confirmed. An OAuth SDK is not a share gateway.
/// Implementations must obtain user confirmation before sending material.
abstract interface class BilibiliShareGateway {
  Future<ShareAvailability> availability(String clientId);
  Future<SocialShareOutcome> share(
      String clientId, BilibiliShareMaterial material);
}

/// Prepared routing layer; deliberately no production gateway before approval.
/// Filling a Client ID alone must never turn this channel into "ready".
class BilibiliShareAdapter implements SocialShareAdapter {
  final String clientId;
  final BilibiliShareGateway? gateway;

  BilibiliShareAdapter(
      {String clientId = BilibiliShareConfig.clientId, this.gateway})
      : clientId = clientId.trim();

  @override
  SocialChannel get channel => SocialChannel.bilibili;

  @override
  Future<ShareAvailability> availability() async {
    if (clientId.isEmpty) return ShareAvailability.notConfigured;
    if (gateway == null) return ShareAvailability.integrationPending;
    try {
      return await gateway!.availability(clientId);
    } catch (_) {
      return ShareAvailability.integrationPending;
    }
  }

  @override
  Future<SocialShareOutcome> share(SocialShareContent content) async {
    if (await availability() != ShareAvailability.ready) {
      throw StateError('B站普通分享尚未接通');
    }
    final material = BilibiliShareMaterial.fromContent(content);
    try {
      // No automatic OAuth, posting, clipboard write, or system-share fallback.
      return await gateway!.share(clientId, material);
    } catch (_) {
      return SocialShareOutcome.failed;
    }
  }
}
