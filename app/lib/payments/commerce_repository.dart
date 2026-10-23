import 'dart:convert';
import 'dart:math';

import 'package:shared_preferences/shared_preferences.dart';

import '../auth/auth_repository.dart';
import '../auth/remote_auth_repository.dart';
import '../config/commerce_config.dart';

/// Retains uncertain operations across restarts, so retries use the same ID.
class CommerceRepository {
  static final instance = CommerceRepository();
  final _auth = RemoteAuthRepository.instance;
  String _key(String userId, String mode) =>
      'openelf.pending_action.$userId.$mode';

  Future<Map<String, dynamic>> snapshot(String userId, String mode) async {
    await retryPending(userId, mode);
    return _auth
        .authenticatedRequest('${CommerceConfig.walletPath}?environment=$mode');
  }

  Future<Map<String, dynamic>> action(String userId, String mode, String type,
      Map<String, dynamic> payload) async {
    final prefs = await SharedPreferences.getInstance();
    final content = <String, dynamic>{
      'environment': mode,
      'type': type,
      ...payload
    };
    final signature = jsonEncode(Map.fromEntries(
        content.entries.toList()..sort((a, b) => a.key.compareTo(b.key))));
    final raw = prefs.getString(_key(userId, mode));
    Map<String, dynamic> record;
    if (raw != null) {
      record = Map<String, dynamic>.from(jsonDecode(raw) as Map);
      if (record['signature'] != signature) {
        throw const AuthException('PENDING_ACTION', '有操作结果待确认，请先刷新钱包');
      }
    } else {
      final random = Random.secure();
      final id =
          List.generate(32, (_) => random.nextInt(16).toRadixString(16)).join();
      record = {
        'signature': signature,
        'body': {...content, 'requestId': id}
      };
      if (!await prefs.setString(_key(userId, mode), jsonEncode(record))) {
        throw const AuthException('STORAGE_ERROR', '无法保存操作编号，请稍后重试');
      }
    }
    return _send(userId, mode, record);
  }

  Future<Map<String, dynamic>> _send(
      String userId, String mode, Map<String, dynamic> record) async {
    if ((await _auth.currentUser)?.id != userId) {
      throw const AuthException('ACCOUNT_CHANGED', '账号已切换，请重新打开钱包');
    }
    try {
      final result = await _auth.authenticatedRequest(
          CommerceConfig.actionsPath,
          body: Map<String, dynamic>.from(record['body'] as Map));
      await _clearIfSame(userId, mode, record);
      return result;
    } on AuthException catch (error) {
      // Keep network/5xx/authorization errors: the original write may have committed.
      if ((error.statusCode ?? 0) < 500 &&
          !error.code.startsWith('HTTP_5') &&
          ![
            'NETWORK_ERROR',
            'INTERNAL_ERROR',
            'UNAUTHORIZED',
            'SESSION_EXPIRED',
            'SESSION_REVOKED',
            'ACCOUNT_CHANGED'
          ].contains(error.code)) {
        await _clearIfSame(userId, mode, record);
      }
      rethrow;
    }
  }

  Future<void> retryPending(String userId, String mode) async {
    final raw =
        (await SharedPreferences.getInstance()).getString(_key(userId, mode));
    if (raw != null)
      await _send(
          userId, mode, Map<String, dynamic>.from(jsonDecode(raw) as Map));
  }

  Future<void> _clearIfSame(
      String userId, String mode, Map<String, dynamic> record) async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_key(userId, mode));
    if (raw != null &&
        (jsonDecode(raw)['body']['requestId'] == record['body']['requestId'])) {
      await prefs.remove(_key(userId, mode));
    }
  }
}
