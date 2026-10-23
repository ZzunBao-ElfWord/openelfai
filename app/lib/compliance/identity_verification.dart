import 'dart:math' as math;

/// 实名认证状态：未认证 / 已认证。
enum IdentityStatus { none, verified }

/// 实名认证结果。
///
/// 隐私约束：本地只保留脱敏后的姓名与证件号，完整身份证号只在核验请求中使用，
/// 不落盘、不进入 AI NFT 元数据、不进入信息流。
class IdentityVerification {
  final IdentityStatus status;

  /// 脱敏姓名，如「张**」。
  final String maskedName;

  /// 脱敏证件号，如「1101********1234」。
  final String maskedIdNumber;

  /// 身份证人像面 / 国徽面的本地影像路径（仅本机可见）。
  final String? frontImagePath;
  final String? backImagePath;

  /// 授权时间与核验通过时间。
  final DateTime authorizedAt;
  final DateTime verifiedAt;

  /// 核验服务标识。本地实现为 local_stub，接入真实服务后替换。
  final String provider;

  const IdentityVerification({
    required this.status,
    required this.maskedName,
    required this.maskedIdNumber,
    this.frontImagePath,
    this.backImagePath,
    required this.authorizedAt,
    required this.verifiedAt,
    required this.provider,
  });

  bool get verified => status == IdentityStatus.verified;

  Map<String, dynamic> toJson() => {
        'status': status.name,
        'maskedName': maskedName,
        'maskedIdNumber': maskedIdNumber,
        'frontImagePath': frontImagePath,
        'backImagePath': backImagePath,
        'authorizedAt': authorizedAt.toIso8601String(),
        'verifiedAt': verifiedAt.toIso8601String(),
        'provider': provider,
      };

  factory IdentityVerification.fromJson(Map<String, dynamic> j) =>
      IdentityVerification(
        status: IdentityStatus.values.firstWhere(
          (s) => s.name == j['status'],
          orElse: () => IdentityStatus.none,
        ),
        maskedName: j['maskedName'] as String? ?? '',
        maskedIdNumber: j['maskedIdNumber'] as String? ?? '',
        frontImagePath: j['frontImagePath'] as String?,
        backImagePath: j['backImagePath'] as String?,
        authorizedAt:
            DateTime.tryParse(j['authorizedAt'] as String? ?? '') ??
                DateTime.now(),
        verifiedAt:
            DateTime.tryParse(j['verifiedAt'] as String? ?? '') ??
                DateTime.now(),
        provider: j['provider'] as String? ?? 'local_stub',
      );
}

/// 身份证二要素（姓名 + 证件号）核验。
///
/// 当前为本地实现：格式校验 + 校验位 + 出生日期合法性。
/// TODO(server): 接入真实核验服务（如公安实名核验 / 阿里云身份证二要素），
/// 把 [verifyRequest] 内部替换成 HTTP 请求，并把返回码映射成核验失败原因。
class IdentityVerificationService {
  const IdentityVerificationService();

  static const String provider = 'local_stub';

  /// 校验姓名。返回 null 表示通过，否则返回给用户看的原因。
  static String? validateName(String raw) {
    final name = raw.trim();
    if (name.isEmpty) return '请填写身份证上的姓名';
    if (!RegExp(r'^[\u4e00-\u9fa5A-Za-z·]{2,20}$').hasMatch(name)) {
      return '姓名需为 2–20 个中文或字母，并与身份证一致';
    }
    return null;
  }

  /// 校验 18 位身份证号（含校验位与出生日期）。
  static String? validateIdNumber(String raw) {
    final id = raw.trim().toUpperCase();
    if (id.isEmpty) return '请填写身份证号';
    if (!RegExp(r'^\d{17}[\dX]$').hasMatch(id)) {
      return '身份证号应为 18 位，最后一位可为 X';
    }
    final year = int.parse(id.substring(6, 10));
    final month = int.parse(id.substring(10, 12));
    final day = int.parse(id.substring(12, 14));
    if (month < 1 || month > 12) return '身份证号中的出生月份不合法';
    final daysInMonth = DateTime(year, month + 1, 0).day;
    if (day < 1 || day > daysInMonth) return '身份证号中的出生日期不合法';
    final birth = DateTime(year, month, day);
    if (year < 1900 || birth.isAfter(DateTime.now())) {
      return '身份证号中的出生日期不合法';
    }
    const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
    const codes = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
    var sum = 0;
    for (var i = 0; i < 17; i++) {
      sum += int.parse(id[i]) * weights[i];
    }
    if (codes[sum % 11] != id[17]) {
      return '身份证号校验位不正确，请核对后重试';
    }
    return null;
  }

  /// 提交核验请求。校验通过后返回脱敏结果。
  ///
  /// 失败时抛出 [IdentityVerifyException]，由调用方转成用户提示。
  static Future<IdentityVerification> verifyRequest({
    required String realName,
    required String idNumber,
    required String frontImagePath,
    required String backImagePath,
  }) async {
    final nameError = validateName(realName);
    if (nameError != null) throw IdentityVerifyException(nameError);
    final idError = validateIdNumber(idNumber);
    if (idError != null) throw IdentityVerifyException(idError);
    if (frontImagePath.isEmpty) {
      throw const IdentityVerifyException('请上传身份证人像面');
    }
    if (backImagePath.isEmpty) {
      throw const IdentityVerifyException('请上传身份证国徽面');
    }

    // TODO(server): 这里改为真实二要素核验请求，人像面/国徽面走 OCR 与活体比对。
    await Future.delayed(const Duration(milliseconds: 900));

    final now = DateTime.now();
    return IdentityVerification(
      status: IdentityStatus.verified,
      maskedName: maskName(realName.trim()),
      maskedIdNumber: maskIdNumber(idNumber.trim()),
      frontImagePath: frontImagePath,
      backImagePath: backImagePath,
      authorizedAt: now,
      verifiedAt: now,
      provider: provider,
    );
  }

  /// 姓名脱敏：保留首字，其余用 * 代替。
  static String maskName(String name) {
    if (name.isEmpty) return '';
    if (name.length == 1) return name;
    return '${name[0]}${'*' * math.min(name.length - 1, 3)}';
  }

  /// 证件号脱敏：保留前 4 位与后 4 位。
  static String maskIdNumber(String id) {
    if (id.length <= 8) return id;
    final head = id.substring(0, 4);
    final tail = id.substring(id.length - 4);
    return '$head${'*' * math.max(id.length - 8, 4)}$tail';
  }
}

class IdentityVerifyException implements Exception {
  final String message;
  const IdentityVerifyException(this.message);

  @override
  String toString() => message;
}
