/// API 配置。
///
/// 服务端：https://openelfai.com（Nginx 反向代理到鉴权服务）
/// 可用 --dart-define=OPENELF_API_BASE=https://... 覆盖。
class ApiConfig {
  static const String baseUrl = String.fromEnvironment(
    'OPENELF_API_BASE',
    defaultValue: 'https://openelfai.com',
  );

  /// 全局请求超时（秒）。
  static const Duration timeout = Duration(seconds: 15);

  /// 请求头（JSON API）。
  static const Map<String, String> jsonHeaders = {
    'Content-Type': 'application/json; charset=UTF-8',
    'Accept': 'application/json',
  };

  /// 发送验证码（POST）。body: {"phone": "11位手机号"}
  static const String sendCodePath = '/api/v1/auth/send-code';

  /// 验证码登录（POST）。body: {"phone", "code", "deviceId"}
  static const String loginByCodePath = '/api/v1/auth/login-by-code';

  /// 刷新会话（POST）。body: {"refreshToken", "deviceId"}
  static const String refreshPath = '/api/v1/auth/refresh';

  /// 退出登录（POST）。
  static const String logoutPath = '/api/v1/auth/logout';

  /// 当前用户（GET）。header: Authorization: Bearer xxx
  static const String mePath = '/api/v1/auth/me';
}
