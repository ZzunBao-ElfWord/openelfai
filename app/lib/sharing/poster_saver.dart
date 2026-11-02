import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

enum PosterSaveResult { gallery, file, cancelled }

/// Saves only the user-generated PNG, without OAuth or broad photo access.
class PosterSaver {
  static const channel = MethodChannel('openelf/poster');
  static bool get supported =>
      !kIsWeb &&
      (defaultTargetPlatform == TargetPlatform.android ||
          defaultTargetPlatform == TargetPlatform.iOS);

  static Future<PosterSaveResult> save(Uint8List png) async {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (png.length > 10 * 1024 * 1024 ||
        png.length < signature.length ||
        !listEquals(png.sublist(0, signature.length), signature)) {
      throw ArgumentError('分享图片无效');
    }
    if (!supported) throw UnsupportedError('请通过系统分享保存图片');
    final result = await channel.invokeMethod<String>('save', {'png': png});
    return switch (result) {
      'gallery' => PosterSaveResult.gallery,
      'file' => PosterSaveResult.file,
      'cancelled' => PosterSaveResult.cancelled,
      _ => throw StateError('图片尚未确认保存'),
    };
  }
}
