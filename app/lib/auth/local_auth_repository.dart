import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/user.dart';
import 'auth_repository.dart';

/// 本地 mock 实现。用 shared_preferences 存 session，验证码固定 1234。
/// 接后端时直接换成 RemoteAuthRepository，UI 层零改动。
class LocalAuthRepository implements AuthRepository {
  LocalAuthRepository._();
  static final LocalAuthRepository instance = LocalAuthRepository._();

  static const _kSession = 'openelf.session';
  static const _kSentCode = 'openelf.sentCode';
  static const _kSentPhone = 'openelf.sentPhone';

  Future<SharedPreferences> get _p async => SharedPreferences.getInstance();

  @override
  Future<User?> get currentUser async {
    final raw = (await _p).getString(_kSession);
    if (raw == null) return null;
    try {
      final m = jsonDecode(raw) as Map<String, dynamic>;
      return User.fromJson(m);
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> logout() async {
    final p = await _p;
    await p.remove(_kSession);
    await p.remove(_kSentCode);
    await p.remove(_kSentPhone);
  }

  @override
  Future<String> sendCode(String phone) async {
    // MVP：固定 1234，真实后端换成调用短信 API
    const code = '1234';
    final p = await _p;
    await p.setString(_kSentCode, code);
    await p.setString(_kSentPhone, phone);
    return code;
  }

  @override
  Future<User> loginWithCode({required String phone, required String code}) async {
    final p = await _p;
    final sent = p.getString(_kSentCode);
    final sentPhone = p.getString(_kSentPhone);
    if (sent == null || sent != code || sentPhone != phone) {
      throw Exception('验证码不对');
    }
    await p.remove(_kSentCode);
    await p.remove(_kSentPhone);

    final nick = '用户${phone.substring(phone.length - 4)}';
    final user = User(
      id: 'u_${phone.substring(phone.length - 4)}',
      phone: phone,
      nickname: nick,
      avatarInitial: nick[0],
      createdAt: DateTime.now(),
    );
    await p.setString(_kSession, jsonEncode(user.toJson()));
    return user;
  }
}
