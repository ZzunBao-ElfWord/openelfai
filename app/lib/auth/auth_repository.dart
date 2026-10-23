import '../models/user.dart';

class CaptchaProof {
  final String platform;
  final String lotNumber;
  final String passToken;
  final String genTime;
  final String captchaOutput;

  const CaptchaProof({
    required this.platform,
    required this.lotNumber,
    required this.passToken,
    required this.genTime,
    required this.captchaOutput,
  });

  factory CaptchaProof.fromJson(String platform, Map<String, dynamic> json) {
    String field(String name) {
      final value = json[name]?.toString() ?? '';
      if (value.isEmpty) {
        throw const AuthException('INVALID_CAPTCHA_PROOF', '图形验证结果异常，请重试');
      }
      return value;
    }

    return CaptchaProof(
      platform: platform,
      lotNumber: field('lot_number'),
      passToken: field('pass_token'),
      genTime: field('gen_time'),
      captchaOutput: field('captcha_output'),
    );
  }

  Map<String, String> toJson() => {
        'platform': platform,
        'lot_number': lotNumber,
        'pass_token': passToken,
        'gen_time': genTime,
        'captcha_output': captchaOutput,
      };
}

/// 认证异常：code 对应服务端错误码，message 可直接展示给用户。
class AuthException implements Exception {
  final String code;
  final String message;
  final int? statusCode;

  const AuthException(this.code, this.message, {this.statusCode});

  @override
  String toString() => message;
}

/// 认证仓库接口。当前只有服务端实现。
abstract class AuthRepository {
  /// 本地缓存的当前用户，null = 未登录。不发起网络请求。
  Future<User?> get currentUser;

  /// 冷启动恢复会话：校验 access token，必要时用 refresh token 续期。
  /// 网络不可用时返回本地缓存用户。
  Future<User?> restoreSession();

  /// 图形验证通过后发送短信验证码。
  Future<void> sendCode(String phone, {required CaptchaProof captcha});

  /// 验证码登录。返回 User，失败抛 [AuthException]。
  Future<User> loginWithCode({required String phone, required String code});

  /// 退出登录：撤销服务端会话并清除本地令牌。
  Future<void> logout();
}
