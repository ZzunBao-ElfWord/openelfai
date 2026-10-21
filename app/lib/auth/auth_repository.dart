import '../models/user.dart';

/// 认证异常：code 对应服务端错误码，message 可直接展示给用户。
class AuthException implements Exception {
  final String code;
  final String message;

  const AuthException(this.code, this.message);

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

  /// 发送验证码（服务端下发短信）。
  Future<void> sendCode(String phone);

  /// 验证码登录。返回 User，失败抛 [AuthException]。
  Future<User> loginWithCode({required String phone, required String code});

  /// 退出登录：撤销服务端会话并清除本地令牌。
  Future<void> logout();
}
