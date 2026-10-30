import 'dart:typed_data';
import 'package:http/http.dart' as http;
import '../models/elf.dart';

class WorkMaterial {
  final String postId;
  final String text;
  final Uint8List? bytes;
  final String? mime;
  const WorkMaterial(this.postId, this.text, {this.bytes, this.mime});
  String get filename =>
      'openelf_work.${mime == 'video/mp4' ? 'mp4' : mime == 'image/jpeg' ? 'jpg' : mime == 'image/webp' ? 'webp' : 'png'}';
}

/// Fetch only the public asset selected by the user. No auth headers, redirects,
/// platform tokens, unrelated photos or background uploads are involved.
class WorkMaterialLoader {
  static const maxBytes = 50 * 1024 * 1024;
  final http.Client client;
  WorkMaterialLoader(this.client);

  static String caption(ElfPost post) =>
      '${post.body.trim()}\n\n内容由 AI 生成 · OpenElf\nhttps://openelfai.com/e/?id=${Uri.encodeQueryComponent(post.elfId)}';

  static bool allowed(Uri uri) =>
      uri.scheme == 'https' &&
      uri.port == 443 &&
      uri.userInfo.isEmpty &&
      const {
        'openelfai.com',
        'www.openelfai.com',
        'web.openelfai.com',
        'media.openelfai.com'
      }.contains(uri.host) &&
      uri.path.startsWith('/api/v1/world-assets/');

  Future<WorkMaterial> load(ElfPost post) async {
    final text = caption(post);
    if (!{'image', 'video'}.contains(post.kind)) {
      if (post.kind == 'audio')
        throw const FormatException('声音作品暂不支持直接发布，请使用作品链接');
      return WorkMaterial(post.id, text);
    }
    final url = post.kind == 'video' ? post.videoUrl : post.imageUrl;
    final uri = Uri.tryParse(url ?? '');
    if (uri == null || !allowed(uri))
      throw const FormatException('作品素材地址不可用，请刷新作品后重试');
    final response = await client
        .send(http.Request('GET', uri)..followRedirects = false)
        .timeout(const Duration(seconds: 15));
    if (response.statusCode != 200)
      throw const FormatException('作品素材下载失败，未交给第三方平台');
    if ((response.contentLength ?? 0) > maxBytes)
      throw const FormatException('作品超过50MB，请先导出后手动发布');
    final buffer = BytesBuilder(copy: false);
    final totalTimeout = Stopwatch()..start();
    await for (final chunk
        in response.stream.timeout(const Duration(seconds: 15))) {
      if (buffer.length + chunk.length > maxBytes ||
          totalTimeout.elapsed > const Duration(minutes: 5)) {
        throw const FormatException('作品过大或下载超时，请稍后重试');
      }
      buffer.add(chunk);
    }
    final bytes = buffer.takeBytes();
    String? mime;
    if (bytes.length >= 12 &&
        String.fromCharCodes(bytes.sublist(4, 8)) == 'ftyp') mime = 'video/mp4';
    if (bytes.length >= 8 &&
        bytes[0] == 137 &&
        bytes[1] == 80 &&
        bytes[2] == 78 &&
        bytes[3] == 71) mime = 'image/png';
    if (bytes.length >= 3 &&
        bytes[0] == 255 &&
        bytes[1] == 216 &&
        bytes[2] == 255) mime = 'image/jpeg';
    if (bytes.length >= 12 &&
        String.fromCharCodes(bytes.sublist(0, 4)) == 'RIFF' &&
        String.fromCharCodes(bytes.sublist(8, 12)) == 'WEBP')
      mime = 'image/webp';
    if (mime == null || (post.kind == 'video') != (mime == 'video/mp4'))
      throw const FormatException('作品文件格式不正确，未发送');
    return WorkMaterial(post.id, text, bytes: bytes, mime: mime);
  }
}
