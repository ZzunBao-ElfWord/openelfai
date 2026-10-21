import '../models/user.dart';

/// 认证仓库接口。实现类可以是 LocalAuthRepository（纯本地 mock）或后端 API 实现。
abstract class AuthRepository {
  /// 当前登录用户，null = 未登录。
  Future<User?> get currentUser;

  /// 登出（只清 session）。
  Future<void> logout();

  /// 发送验证码（MVP 里返回固定 4 位码供测试）。
  Future<String> sendCode(String phone);

  /// 验证码登录。返回 User，失败抛异常。
  Future<User> loginWithCode({required String phone, required String code});
}
