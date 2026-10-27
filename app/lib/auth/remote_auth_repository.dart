import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../config/api_config.dart';
import '../models/user.dart';
import 'auth_repository.dart';

/// 服务端认证实现：短信验证码登录 + access/refresh 双令牌。
/// 令牌存放在 Android Keystore 加密存储，用户资料缓存在 shared_preferences。
class RemoteAuthRepository implements AuthRepository {
  RemoteAuthRepository._();

  RemoteAuthRepository.forTesting({required http.Client client}) : _client = client;

  static final RemoteAuthRepository instance = RemoteAuthRepository._();

  static const _kUserCache = 'openelf.user';
  static const _kDeviceId = 'openelf.deviceId';
  static const _kAccessToken = 'openelf.accessToken';
  static const _kRefreshToken = 'openelf.refreshToken';

  final FlutterSecureStorage _secure = const FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );

  http.Client? _client;
  Future<bool>? _refreshing;
  int _sessionEpoch = 0;

  http.Client get _http => _client ??= http.Client();

  Future<SharedPreferences> get _prefs async => SharedPreferences.getInstance();

  @override
  Future<User?> get currentUser async {
    final raw = (await _prefs).getString(_kUserCache);
    if (raw == null) return null;
    try {
      final json = jsonDecode(raw);
      if (json is Map<String, dynamic>) return User.fromJson(json);
    } catch (_) {}
    return null;
  }

  @override
  Future<User?> restoreSession() async {
    final epoch = _sessionEpoch;
    final accessToken = await _secure.read(key: _kAccessToken);
    final refreshToken = await _secure.read(key: _kRefreshToken);

    if (accessToken == null || refreshToken == null) return null;

    try {
      final body = await _get(ApiConfig.mePath, accessToken: accessToken);
      final user = _parseUser(body['user'], await currentUser);
      if (epoch != _sessionEpoch) return null;
      await _cacheUser(user);
      return user;
    } on AuthException catch (error) {
      // 网络不可用时允许使用本地缓存的登录态，保证离线可进入。
      if (error.code == 'NETWORK_ERROR') return currentUser;

      if (_isUnauthorized(error.code)) {
        final refreshed = await _refreshSession();
        return refreshed ? currentUser : null;
      }

      return currentUser;
    }
  }

  @override
  Future<void> sendCode(String phone, {required CaptchaProof captcha}) async {
    await _post(ApiConfig.sendCodePath, {
      'phone': phone,
      ...captcha.toJson(),
    });
  }

  @override
  Future<User> loginWithCode(
      {required String phone, required String code}) async {
    final deviceId = await _deviceId();
    final body = await _post(ApiConfig.loginByCodePath, {
      'phone': phone,
      'code': code,
      'deviceId': deviceId,
    });

    final accessToken = body['accessToken'];
    final refreshToken = body['refreshToken'];
    if (accessToken is! String || refreshToken is! String) {
      throw const AuthException('INVALID_RESPONSE', '登录响应异常，请稍后重试');
    }

    final user =
        _parseUser(body['user'], await currentUser, fallbackPhone: phone);
    await _saveSession(accessToken, refreshToken, user);
    return user;
  }

  /// 供平台 API（如 API Key、AI 对话）读取当前 access token。
  @override
  Future<String?> get accessToken => _secure.read(key: _kAccessToken);

  /// 平台接口遇到 401 时续期一次：access token 只有 15 分钟有效期，
  /// 过期后本地仍是登录态，需要先用 refresh token 换新再重试。
  Future<bool> refreshAccessToken() => _refreshSession();

  @override
  Future<void> logout() async {
    _sessionEpoch++;
    final accessToken = await _secure.read(key: _kAccessToken);
    final refreshToken = await _secure.read(key: _kRefreshToken);

    if (accessToken != null || refreshToken != null) {
      try {
        await _post(
          ApiConfig.logoutPath,
          {'refreshToken': refreshToken ?? ''},
          accessToken: accessToken,
        );
      } on AuthException {
        // 网络失败也要清本地，避免用户卡在已登录态。
      }
    }

    await _clearSession();
  }

  @override
  Future<void> deleteAccount() async {
    final userId = (await currentUser)?.id;
    final result = await authenticatedRequest('/api/v1/auth/delete-account',
        body: {'confirmation': 'DELETE_MY_ACCOUNT'});
    if (result['deleted'] != true) {
      throw const AuthException('DELETE_NOT_CONFIRMED', '服务器未确认注销成功，请稍后重试');
    }
    _sessionEpoch++;
    // A refresh started before deletion must not restore an old local session.
    final pending = _refreshing;
    if (pending != null) {
      try { await pending; } catch (_) {}
    }
    await _clearSession();
    if (userId != null && userId.isNotEmpty) {
      final prefs = await _prefs;
      for (final key in prefs.getKeys().toList()) {
        if (key.startsWith('openelf.') &&
            (key.endsWith('.$userId') || key.contains('.$userId.'))) {
          await prefs.remove(key);
        }
      }
    }
  }

  // —— 会话续期（单飞：并发请求只刷新一次）——

  Future<bool> _refreshSession() {
    final pending = _refreshing;
    if (pending != null) return pending;

    final future = _doRefresh();
    _refreshing = future;
    return future.whenComplete(() => _refreshing = null);
  }

  Future<bool> _doRefresh() async {
    final epoch = _sessionEpoch;
    final refreshToken = await _secure.read(key: _kRefreshToken);
    if (refreshToken == null) return false;

    final deviceId = await _deviceId();

    try {
      final body = await _post(ApiConfig.refreshPath, {
        'refreshToken': refreshToken,
        'deviceId': deviceId,
      });

      final accessToken = body['accessToken'];
      final newRefreshToken = body['refreshToken'];
      if (accessToken is! String || newRefreshToken is! String) {
        await _clearSession();
        return false;
      }

      final user = _parseUser(body['user'], await currentUser);
      if (epoch != _sessionEpoch) {
        // A response from before logout/deletion must never resurrect a session.
        try {
          await _post(ApiConfig.logoutPath, {'refreshToken': newRefreshToken},
              accessToken: accessToken);
        } catch (_) {}
        return false;
      }
      await _saveSession(accessToken, newRefreshToken, user);
      return true;
    } on AuthException catch (error) {
      if (error.code != 'NETWORK_ERROR') {
        await _clearSession();
      }
      return false;
    }
  }

  // —— HTTP ——

  /// Authenticated API access with one refresh/retry, including payment APIs.
  /// [timeout] 用于上传证件照这类大请求体，默认仍走 15 秒。
  Future<Map<String, dynamic>> authenticatedRequest(
    String path, {
    Map<String, dynamic>? body,
    Duration? timeout,
  }) async {
    Future<Map<String, dynamic>> send() async {
      final token = await _secure.read(key: _kAccessToken);
      if (token == null) {
        throw const AuthException('UNAUTHORIZED', '请先登录');
      }
      return body == null
          ? _get(path, accessToken: token)
          : _post(path, body, accessToken: token, timeout: timeout);
    }

    try {
      return await send();
    } on AuthException catch (error) {
      if (!_isUnauthorized(error.code) || !await _refreshSession()) rethrow;
      return send();
    }
  }

  Future<Map<String, dynamic>> _get(String path, {String? accessToken}) async {
    final uri = Uri.parse('${ApiConfig.baseUrl}$path');
    http.Response response;

    try {
      response = await _http
          .get(uri, headers: _headers(accessToken: accessToken))
          .timeout(ApiConfig.timeout);
    } on TimeoutException {
      throw const AuthException('NETWORK_ERROR', '网络超时，请稍后重试');
    } on http.ClientException {
      throw const AuthException('NETWORK_ERROR', '网络连接失败，请检查网络');
    } catch (_) {
      throw const AuthException('NETWORK_ERROR', '网络连接失败，请检查网络');
    }

    return _decode(response);
  }

  Future<Map<String, dynamic>> _post(
    String path,
    Map<String, dynamic> body, {
    String? accessToken,
    Duration? timeout,
  }) async {
    final uri = Uri.parse('${ApiConfig.baseUrl}$path');
    http.Response response;

    try {
      response = await _http
          .post(
            uri,
            headers: _headers(accessToken: accessToken),
            body: jsonEncode(body),
          )
          .timeout(timeout ?? ApiConfig.timeout);
    } on TimeoutException {
      throw const AuthException('NETWORK_ERROR', '网络超时，请稍后重试');
    } on http.ClientException {
      throw const AuthException('NETWORK_ERROR', '网络连接失败，请检查网络');
    } catch (_) {
      throw const AuthException('NETWORK_ERROR', '网络连接失败，请检查网络');
    }

    return _decode(response);
  }

  Map<String, String> _headers({String? accessToken}) => {
        ...ApiConfig.jsonHeaders,
        if (accessToken != null && accessToken.isNotEmpty)
          'Authorization': 'Bearer $accessToken',
      };

  Map<String, dynamic> _decode(http.Response response) {
    Map<String, dynamic> body = {};
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map<String, dynamic>) body = decoded;
    } catch (_) {}

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return body;
    }

    final error = body['error'];
    if (error is Map) {
      throw AuthException(
        (error['code'] ?? 'UNKNOWN').toString(),
        (error['message'] ?? '请求失败').toString(),
        statusCode: response.statusCode,
      );
    }

    throw AuthException('HTTP_${response.statusCode}', '请求失败，请稍后重试',
        statusCode: response.statusCode);
  }

  // —— 持久化 ——

  Future<void> _saveSession(
      String accessToken, String refreshToken, User user) async {
    await _secure.write(key: _kAccessToken, value: accessToken);
    await _secure.write(key: _kRefreshToken, value: refreshToken);
    await _cacheUser(user);
  }

  Future<void> _cacheUser(User user) async {
    await (await _prefs).setString(_kUserCache, jsonEncode(user.toJson()));
  }

  Future<void> _clearSession() async {
    await _secure.delete(key: _kAccessToken);
    await _secure.delete(key: _kRefreshToken);
    await (await _prefs).remove(_kUserCache);
  }

  /// 对外暴露设备标识：回流计分等服务端去重依赖它。
  Future<String> deviceId() => _deviceId();

  Future<String> _deviceId() async {
    final prefs = await _prefs;
    final existing = prefs.getString(_kDeviceId);
    if (existing != null && existing.length >= 8) return existing;

    final random = Random.secure();
    const chars = '0123456789abcdef';
    final id =
        List.generate(32, (_) => chars[random.nextInt(chars.length)]).join();
    await prefs.setString(_kDeviceId, id);
    return id;
  }

  bool _isUnauthorized(String code) =>
      code == 'UNAUTHORIZED' ||
      code == 'SESSION_EXPIRED' ||
      code == 'SESSION_REVOKED';

  User _parseUser(dynamic raw, User? cached, {String fallbackPhone = ''}) {
    if (raw is Map<String, dynamic>) {
      final id = raw['id']?.toString() ?? '';
      final phone = raw['phone']?.toString() ?? cached?.phone ?? fallbackPhone;
      final nickname = raw['nickname']?.toString() ??
          (phone.length >= 4 ? '用户${phone.substring(phone.length - 4)}' : '用户');
      final avatar = raw['avatarInitial']?.toString() ??
          (nickname.isEmpty ? '用' : nickname[0]);
      final createdAtStr = raw['createdAt']?.toString();
      final createdAt = createdAtStr != null
          ? DateTime.tryParse(createdAtStr) ?? DateTime.now()
          : DateTime.now();

      return User(
        id: id.isEmpty ? (cached?.id ?? '') : id,
        phone: phone,
        nickname: nickname,
        avatarInitial: avatar.isEmpty ? '用' : avatar,
        createdAt: createdAt,
      );
    }

    if (cached != null) return cached;

    return User(
      id: '',
      phone: fallbackPhone,
      nickname: fallbackPhone.length >= 4
          ? '用户${fallbackPhone.substring(fallbackPhone.length - 4)}'
          : '用户',
      avatarInitial: '用',
      createdAt: DateTime.now(),
    );
  }
}
