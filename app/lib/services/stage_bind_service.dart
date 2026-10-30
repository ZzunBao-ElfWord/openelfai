import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// 分享目标。实际交接能力依赖客户端；此处不保存平台 OAuth 授权。
enum StagePlatform {
  douyin('douyin', '抖音', 'com.ss.android.ugc.aweme', '交给抖音编辑，由你确认发布'),
  kuaishou('kuaishou', '快手', 'com.smile.gifmaker', '通过设备支持的分享入口交接作品'),
  wechat('wechat', '微信', 'com.tencent.mm', '通过设备支持的分享入口交给微信'),
  bilibili('bilibili', '哔哩哔哩', 'tv.danmaku.bili', '交接本次素材，不代表已获得投稿权限');

  const StagePlatform(this.id, this.label, this.androidPackage, this.hint);

  final String id;
  final String label;
  final String androidPackage;
  final String hint;

  static StagePlatform? byId(String id) {
    for (final platform in values) {
      if (platform.id == id) return platform;
    }
    return null;
  }
}

/// 平台视觉标识：绑定页与分享面板共用同一套品牌色与图标。
extension StagePlatformStyle on StagePlatform {
  Color get color {
    switch (this) {
      case StagePlatform.douyin:
        return const Color(0xFF161823);
      case StagePlatform.kuaishou:
        return const Color(0xFFFF4906);
      case StagePlatform.wechat:
        return const Color(0xFF07C160);
      case StagePlatform.bilibili:
        return const Color(0xFF00A1D6);
    }
  }

  IconData get icon {
    switch (this) {
      case StagePlatform.douyin:
        return Icons.music_note_rounded;
      case StagePlatform.kuaishou:
        return Icons.ondemand_video_rounded;
      case StagePlatform.wechat:
        return Icons.chat_bubble_rounded;
      case StagePlatform.bilibili:
        return Icons.smart_display_rounded;
    }
  }
}

/// 按用户保存的常用平台偏好，不是账号授权。
/// 保留旧存储键与方法名以兼容已有本机记录，登出不删除记录。
class StageBindService extends ChangeNotifier {
  StageBindService._();
  static final StageBindService instance = StageBindService._();

  static const _keyPrefix = 'openelf.stageBinds';

  String? _userId;
  final Map<StagePlatform, DateTime> _boundAt = {};

  int get boundCount => _boundAt.length;

  bool isBound(StagePlatform platform) => _boundAt.containsKey(platform);

  DateTime? boundAt(StagePlatform platform) => _boundAt[platform];

  Future<void> load(String? userId) async {
    _userId = userId;
    _boundAt.clear();
    if (userId != null && userId.isNotEmpty) {
      try {
        final prefs = await SharedPreferences.getInstance();
        final raw = prefs.getString('$_keyPrefix.$userId');
        if (raw != null) {
          final map = Map<String, dynamic>.from(jsonDecode(raw) as Map);
          map.forEach((id, value) {
            final platform = StagePlatform.byId(id);
            final at = DateTime.tryParse(value?.toString() ?? '');
            if (platform != null && at != null) _boundAt[platform] = at;
          });
        }
      } catch (error) {
        debugPrint('[StageBind] load failed: $error');
      }
    }
    notifyListeners();
  }

  Future<void> bind(StagePlatform platform) async {
    _boundAt[platform] = DateTime.now();
    await _persist();
    notifyListeners();
  }

  Future<void> unbind(StagePlatform platform) async {
    _boundAt.remove(platform);
    await _persist();
    notifyListeners();
  }

  /// 登出：清空内存态，本机绑定记录保留到下次登录。
  void reset() {
    _userId = null;
    _boundAt.clear();
    notifyListeners();
  }

  Future<void> _persist() async {
    final userId = _userId;
    if (userId == null || userId.isEmpty) return;
    final prefs = await SharedPreferences.getInstance();
    final map = _boundAt.map((p, at) => MapEntry(p.id, at.toIso8601String()));
    await prefs.setString('$_keyPrefix.$userId', jsonEncode(map));
  }
}

/// ok 仅表示交接，不代表已发布；失败由调用方提示并询问是否系统分享。
enum StageShareStatus { ok, notInstalled, noReceiver, unsupported, failed }

/// 定向分享：Android 通过原生通道把分享卡片与文案直接交给目标 App 的分享入口，
/// 其他平台（iOS / Web / 桌面）返回 unsupported，由调用方回退到系统分享面板。
class StageShareService {
  StageShareService._();

  static const MethodChannel _channel = MethodChannel('openelf/share');

  static Future<StageShareStatus> shareToApp({
    required StagePlatform platform,
    required String text,
    Uint8List? imageBytes,
    Uint8List? mediaBytes,
    String? mimeType,
    String? title,
  }) async {
    if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) {
      return StageShareStatus.unsupported;
    }
    try {
      final status = await _channel.invokeMethod<String>('shareToApp', {
        'package': platform.androidPackage,
        'text': text,
        'title': title ?? '分享到${platform.label}',
        if (imageBytes != null) 'image': imageBytes,
        if (mediaBytes != null) 'media': mediaBytes,
        if (mimeType != null) 'mime': mimeType,
      });
      switch (status) {
        case 'ok':
          return StageShareStatus.ok;
        case 'not_installed':
          return StageShareStatus.notInstalled;
        case 'no_receiver':
          return StageShareStatus.noReceiver;
        case 'unsupported':
          return StageShareStatus.unsupported;
        default:
          return StageShareStatus.failed;
      }
    } catch (_) {
      return StageShareStatus.failed;
    }
  }
}
