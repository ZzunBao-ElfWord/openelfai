import 'auth_repository.dart';
import 'remote_auth_repository.dart';

/// 认证仓库工厂。只走服务端，不做本地 mock 回退。
AuthRepository createAuth() => RemoteAuthRepository.instance;
