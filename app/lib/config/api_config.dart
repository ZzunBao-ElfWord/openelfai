/// API 配置。
///
/// 域名：openelfai.com
/// 当前路径是 REST API v1 规范，后端实际路径确定后改这三个常量即可。
class ApiConfig {
  /// 后端根地址。HTTPS 正式环境。
  static const String baseUrl = 'https://openelfai.com';

  /// 全局请求超时（秒）。
  static const Duration timeout = Duration(seconds: 15);

  /// 请求头（JSON API）。
  static const Map<String, String> jsonHeaders = {
    'Content-Type': 'application/json; charset=UTF-8',
    'Accept': 'application/json',
  };

  // —— 接口路径（按你后端实际 API 调整）——
  // TODO: 后端实现后把下面三个 path 对齐真实路径

  /// 发送验证码（POST）。body: {"phone": "11位手机号"}
  static const String sendCodePath = '/api/v1/auth/send-code';

  /// 验证码登录（POST）。body: {"phone": "...", "code": "..."}
  /// 返回：{"token": "...", "user": {...}}
  static const String loginByCodePath = '/api/v1/auth/login-by-code';

  /// 用 token 换用户信息（GET）。header: Authorization: Bearer xxx
  static const String mePath = '/api/v1/auth/me';
}
