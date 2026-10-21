import '../models/user.dart';
import 'auth_repository.dart';
import 'local_auth_repository.dart';
import 'remote_auth_repository.dart';

/// AuthRepository 工厂。
///
/// [useRemote] = true 时优先走远程后端，网络失败自动 fallback 本地 mock。
/// 上线前把 [ApiConfig.baseUrl] 改成真实后端地址。
AuthRepository createAuth({bool useRemote = true}) {
  if (!useRemote) return LocalAuthRepository.instance;
  return _RemoteWithLocalFallback();
}

/// 优先远程、失败回退本地的组合实现。
class _RemoteWithLocalFallback implements AuthRepository {
  final _remote = RemoteAuthRepository.instance;
  final _local = LocalAuthRepository.instance;

  bool _networkAvailable = true; // 简单标记，没接 connectivity 先硬编码 true

  // —— 只读优先从本地 session 恢复（冷启动最快）——
  @override
  Future<User?> get currentUser async {
    // 本地缓存永远可用（因为 LocalAuth 是 shared_preferences，跟 DataRepository 同一套存储）
    return _local.currentUser;
  }

  @override
  Future<void> logout() async {
    await _remote.logout();
    await _local.logout();
  }

  @override
  Future<String> sendCode(String phone) async {
    try {
      return await _remote.sendCode(phone);
    } catch (e) {
      // 网络错误 → fallback 本地（返回固定 1234）
      _networkAvailable = false;
      return await _local.sendCode(phone);
    }
  }

  @override
  Future<User> loginWithCode({required String phone, required String code}) async {
    try {
      final user = await _remote.loginWithCode(phone: phone, code: code);
      _networkAvailable = true;
      // 远程成功后同步写本地缓存（保证下次冷启动能恢复）
      await _local.sendCode(phone); // 先 mock 存一份 sentCode
      return user;
    } catch (e) {
      // 远程失败（网络/后端挂）→ fallback 本地 mock
      _networkAvailable = false;
      return await _local.loginWithCode(phone: phone, code: code);
    }
  }
}
