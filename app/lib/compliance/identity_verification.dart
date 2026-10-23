import 'dart:convert';
import 'dart:io';

import '../auth/auth_repository.dart';
import '../auth/remote_auth_repository.dart';
import '../config/api_config.dart';

/// 实名认证状态：未认证 / 已认证。
enum IdentityStatus { none, verified }

/// 服务端确认过的实名认证结果。
///
/// 客户端仅缓存脱敏姓名、脱敏证件号和核验时间；证件图片、完整姓名与完整
/// 身份证号码都不会写入 SharedPreferences。
class IdentityVerification {
  final IdentityStatus status;
  final String maskedName;
  final String maskedIdNumber;
  final DateTime authorizedAt;
  final DateTime verifiedAt;
  final String provider;

  const IdentityVerification({
    required this.status,
    required this.maskedName,
    required this.maskedIdNumber,
    required this.authorizedAt,
    required this.verifiedAt,
    required this.provider,
  });

  bool get verified => status == IdentityStatus.verified;

  String get providerLabel =>
      provider == 'aliyun_id2_ocr' ? '阿里云信息核验' : provider;

  Map<String, dynamic> toJson() => {
        'status': status.name,
        'maskedName': maskedName,
        'maskedIdNumber': maskedIdNumber,
        'authorizedAt': authorizedAt.toIso8601String(),
        'verifiedAt': verifiedAt.toIso8601String(),
        'provider': provider,
      };

  factory IdentityVerification.fromJson(Map<String, dynamic> json) {
    final provider = json['provider']?.toString() ?? '';
    // 旧版本的 local_stub 没有经过权威源核验，升级后不得继续视为已实名。
    final rawStatus = json['status']?.toString();
    final status = provider == 'local_stub'
        ? IdentityStatus.none
        : IdentityStatus.values.firstWhere(
            (value) => value.name == rawStatus,
            orElse: () => IdentityStatus.none,
          );
    final verifiedAt =
        DateTime.tryParse(json['verifiedAt']?.toString() ?? '') ??
            DateTime.now();
    return IdentityVerification(
      status: status,
      maskedName: json['maskedName']?.toString() ?? '',
      maskedIdNumber: json['maskedIdNumber']?.toString() ?? '',
      authorizedAt: DateTime.tryParse(json['authorizedAt']?.toString() ?? '') ??
          verifiedAt,
      verifiedAt: verifiedAt,
      provider: provider,
    );
  }
}

class IdentityVerificationService {
  const IdentityVerificationService();

  static const int maxImageBytes = 2 * 1024 * 1024;

  static IdentityVerification? _parseIdentity(dynamic raw) {
    if (raw is! Map) {
      throw const IdentityVerifyException('实名认证响应异常，请稍后重试');
    }
    final json = Map<String, dynamic>.from(raw);
    if (json['status']?.toString() != 'verified') return null;
    final maskedName = json['maskedName']?.toString() ?? '';
    final maskedId = json['maskedIdNumber']?.toString() ?? '';
    final provider = json['provider']?.toString() ?? '';
    final verifiedAt = DateTime.tryParse(json['verifiedAt']?.toString() ?? '');
    if (maskedName.isEmpty || maskedId.isEmpty || provider.isEmpty) {
      throw const IdentityVerifyException('实名认证响应异常，请稍后重试');
    }
    final now = verifiedAt ?? DateTime.now();
    return IdentityVerification(
      status: IdentityStatus.verified,
      maskedName: maskedName,
      maskedIdNumber: maskedId,
      authorizedAt: now,
      verifiedAt: now,
      provider: provider,
    );
  }

  static Future<List<int>> _readImage(String path, String label) async {
    if (path.isEmpty) throw IdentityVerifyException('请上传身份证$label');
    final file = File(path);
    if (!await file.exists()) {
      throw IdentityVerifyException('身份证$label文件已失效，请重新选择');
    }
    final size = await file.length();
    if (size <= 0 || size > maxImageBytes) {
      throw IdentityVerifyException(
        size > maxImageBytes
            ? '身份证$label不能超过 2 MB，请重新选择'
            : '身份证$label图片无效，请重新选择',
      );
    }
    return file.readAsBytes();
  }

  /// 从服务端恢复可信的实名状态。返回 null 表示当前账号未认证。
  static Future<IdentityVerification?> fetchStatus() async {
    try {
      final body = await RemoteAuthRepository.instance.authenticatedRequest(
        ApiConfig.identityStatusPath,
      );
      return _parseIdentity(body['identity']);
    } on AuthException catch (error) {
      throw IdentityVerifyException(error.message);
    }
  }

  /// 上传身份证正反面到 OpenElf 后端，由后端调用阿里云 OCR 二要素核验。
  static Future<IdentityVerification> verifyRequest({
    required String frontImagePath,
    required String backImagePath,
  }) async {
    final images = await Future.wait([
      _readImage(frontImagePath, '人像面'),
      _readImage(backImagePath, '国徽面'),
    ]);
    try {
      final body = await RemoteAuthRepository.instance.authenticatedRequest(
        ApiConfig.identityVerifyPath,
        body: {
          'frontImageBase64': base64Encode(images[0]),
          'backImageBase64': base64Encode(images[1]),
          'consent': true,
        },
        timeout: const Duration(seconds: 35),
      );
      final identity = _parseIdentity(body['identity']);
      if (identity == null) {
        throw const IdentityVerifyException('实名认证未通过，请检查证件后重试');
      }
      return identity;
    } on AuthException catch (error) {
      throw IdentityVerifyException(error.message);
    }
  }
}

class IdentityVerifyException implements Exception {
  final String message;
  const IdentityVerifyException(this.message);

  @override
  String toString() => message;
}
