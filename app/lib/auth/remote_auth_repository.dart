import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../config/api_config.dart';
import '../models/user.dart';
import 'auth_repository.dart';

/// 真实后端实现。HTTP + JSON + Bearer token。
/// 接口格式以 [ApiConfig] 里的 path 为准，按你的后端实际 API 调整。
class RemoteAuthRepository implements AuthRepository {
  RemoteAuthRepository._();
  static final RemoteAuthRepository instance = RemoteAuthRepository._();

  static const _kToken = 'openelf.token';
  static const _kUserCache = 'openelf.user';

  http.Client? _client;
  http.Client get _http => _client ??= http.Client();

  Future<SharedPreferences> get _p async => SharedPreferences.getInstance();

  Future<String?> get _token async => (await _p).getString(_kToken);

  @override
  Future<User?> get currentUser async {
    final raw = (await _p).getString(_kUserCache);
    if (raw == null) return null;
    try {
      return User.fromJson(Map<String, dynamic>.from(jsonDecode(raw)));
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> logout() async {
    final p = await _p;
    await p.remove(_kToken);
    await p.remove(_kUserCache);
  }

  @override
  Future<String> sendCode(String phone) async {
    final uri = Uri.parse('${ApiConfig.baseUrl}${ApiConfig.sendCodePath}');
    final resp = await _http
        .post(
          uri,
          headers: ApiConfig.jsonHeaders,
          body: jsonEncode({'phone': phone}),
        )
        .timeout(ApiConfig.timeout);

    if (resp.statusCode >= 200 && resp.statusCode < 300) {
      final body = _parseBody(resp);
      // 后端可能直接返回 code，也可能返回 {data: "1234"}
      final dynamic data = body['data'] ?? body['code'] ?? body;
      if (data is String && data.isNotEmpty) return data;
      // MVP 兜底：后端没返回 code 就返回占位（调试用）
      return '1234';
    }
    throw _err('发送验证码失败', resp);
  }

  @override
  Future<User> loginWithCode({required String phone, required String code}) async {
    final uri = Uri.parse('${ApiConfig.baseUrl}${ApiConfig.loginByCodePath}');
    final resp = await _http
        .post(
          uri,
          headers: ApiConfig.jsonHeaders,
          body: jsonEncode({'phone': phone, 'code': code}),
        )
        .timeout(ApiConfig.timeout);

    if (resp.statusCode >= 200 && resp.statusCode < 300) {
      final body = _parseBody(resp);

      // 取 token（放 Authorization: Bearer xxx，或 data.token）
      final dynamic token = body['token'] ?? body['data']?['token'];
      if (token != null && token is String && token.isNotEmpty) {
        await (await _p).setString(_kToken, token);
      }

      // 取 user
      final dynamic userJson = body['user'] ?? body['data']?['user'] ?? body['data'];
      final user = _parseUser(userJson, phone);
      await (await _p).setString(_kUserCache, jsonEncode(user.toJson()));
      return user;
    }
    throw _err('登录失败', resp);
  }

  // —— helpers ——

  Map<String, dynamic> _parseBody(http.Response resp) {
    try {
      final d = jsonDecode(resp.body);
      if (d is Map<String, dynamic>) return d;
    } catch (_) {}
    return {};
  }

  User _parseUser(dynamic raw, String fallbackPhone) {
    if (raw is Map<String, dynamic>) {
      final id = raw['id']?.toString() ?? raw['uid']?.toString() ?? raw['userId']?.toString() ?? '';
      final nickname = raw['nickname']?.toString() ?? raw['name']?.toString() ?? raw['username']?.toString() ?? '';
      final phone = raw['phone']?.toString() ?? raw['mobile']?.toString() ?? fallbackPhone;
      final avatar = raw['avatarInitial']?.toString() ??
          raw['nickname']?.toString()?.substring(0, 1) ??
          '用';
      final createdAtStr = raw['createdAt']?.toString() ??
          raw['created_at']?.toString() ??
          raw['registerTime']?.toString();
      final createdAt = createdAtStr != null
          ? DateTime.tryParse(createdAtStr) ?? DateTime.now()
          : DateTime.now();
      return User(
        id: id,
        phone: phone,
        nickname: nickname.isEmpty ? '用户${phone.substring(phone.length - 4)}' : nickname,
        avatarInitial: avatar.isEmpty ? '用' : avatar,
        createdAt: createdAt,
      );
    }
    // 后端只返回一个 id 或字符串的兜底
    return User(
      id: raw?.toString() ?? 'local_${fallbackPhone.substring(fallbackPhone.length - 4)}',
      phone: fallbackPhone,
      nickname: '用户${fallbackPhone.substring(fallbackPhone.length - 4)}',
      avatarInitial: '用',
      createdAt: DateTime.now(),
    );
  }

  Exception _err(String prefix, http.Response resp) {
    String detail;
    try {
      final body = _parseBody(resp);
      detail = body['message']?.toString() ??
          body['error']?.toString() ??
          body['msg']?.toString() ??
          resp.body;
    } catch (_) {
      detail = resp.body;
    }
    return Exception('$prefix (HTTP ${resp.statusCode}): $detail');
  }
}
