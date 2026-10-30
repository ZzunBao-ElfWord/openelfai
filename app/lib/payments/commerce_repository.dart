import 'dart:convert';
import 'dart:math';

import 'package:shared_preferences/shared_preferences.dart';

import '../auth/auth_repository.dart';
import '../auth/remote_auth_repository.dart';
import '../config/api_config.dart';
import '../config/commerce_config.dart';

/// Retains uncertain operations across restarts, so retries use the same ID.
class CommerceRepository {
  static final instance = CommerceRepository();
  final _auth = RemoteAuthRepository.instance;
  String _key(String userId, String mode) =>
      'openelf.pending_action.$userId.$mode';
  String _withdrawKey(String userId, String mode) =>
      'openelf.pending_withdraw.$userId.$mode';

  Future<Map<String, dynamic>> snapshot(String userId, String mode) async {
    await retryPending(userId, mode);
    return _auth
        .authenticatedRequest('${CommerceConfig.walletPath}?environment=$mode');
  }

  /// 对话记录：服务端按「用户 + AI」存一份，换设备/重装后可拉回。
  Future<Map<String, dynamic>> chatHistory(String userId, String elfId) async {
    if ((await _auth.currentUser)?.id != userId) {
      throw const AuthException('ACCOUNT_CHANGED', '账号已切换，请重新加载对话');
    }
    final query = Uri(queryParameters: {'elfId': elfId}).query;
    return _auth.authenticatedRequest('${CommerceConfig.chatPath}?$query');
  }

  /// 上传 AI 生成视频：原始 MP4 字节走 body，AI 归属与文案走 query。
  Future<Map<String, dynamic>> uploadVideo(
    String userId,
    String mode, {
    required String elfId,
    required String caption,
    required List<int> bytes,
  }) async {
    if ((await _auth.currentUser)?.id != userId) {
      throw const AuthException('ACCOUNT_CHANGED', '账号已切换，请重新上传');
    }
    final query = Uri(queryParameters: {
      'environment': mode,
      'elfId': elfId,
      'caption': caption,
      'aiGenerated': 'true',
    }).query;
    return _auth.authenticatedUpload(
      '${ApiConfig.videoUploadPath}?$query',
      bytes: bytes,
    );
  }

  /// 设备标识由登录模块统一生成并持久化，回流去重按（设备 + AI）在服务端计算。
  Future<String> deviceId() => _auth.deviceId();

  /// 实名核验由服务端完成（阿里云实人认证），客户端只提交原始要素与证件照、回收脱敏结果。
  Future<Map<String, dynamic>> verifyIdentity(
      String userId, String mode, Map<String, dynamic> payload) async {
    if ((await _auth.currentUser)?.id != userId) {
      throw const AuthException('ACCOUNT_CHANGED', '账号已切换，请重新提交');
    }
    return _auth.authenticatedRequest('/api/v1/identity/verify',
        timeout: ApiConfig.chatTimeout,
        body: {
          'environment': mode,
          'platform': CommerceConfig.android ? 'android' : 'ios',
          ...payload,
        });
  }

  /// 信息流分页：排序、分页、去重由服务端决定，客户端只按页追加。
  Future<Map<String, dynamic>> feed(String userId, String mode,
      {required String channel,
      String sort = 'recommend',
      int page = 0,
      int size = 20}) async {
    if ((await _auth.currentUser)?.id != userId) {
      throw const AuthException('ACCOUNT_CHANGED', '账号已切换，请重新加载信息流');
    }
    final query = Uri(queryParameters: {
      'environment': mode,
      'channel': channel,
      'sort': sort,
      'page': '$page',
      'size': '$size',
    }).query;
    return _auth.authenticatedRequest('${CommerceConfig.feedPath}?$query');
  }

  /// 能力许愿：把用户期待的能力留给产品团队，不涉及扣费。
  Future<void> submitWish(String userId, String mode, String text) async {
    if ((await _auth.currentUser)?.id != userId) {
      throw const AuthException('ACCOUNT_CHANGED', '账号已切换，请重新提交');
    }
    await _auth.authenticatedRequest(CommerceConfig.wishesPath,
        body: {'environment': mode, 'text': text});
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

  /// 提现申请：与扣费动作一样先落本地待确认编号，断网重试沿用同一个 requestId。
  Future<Map<String, dynamic>> requestWithdraw(String userId, String mode,
      {required int amountCents, required String account}) async {
    final prefs = await SharedPreferences.getInstance();
    final content = <String, dynamic>{
      'environment': mode,
      'amountCents': amountCents,
      'account': account,
    };
    final signature = jsonEncode(Map.fromEntries(
        content.entries.toList()..sort((a, b) => a.key.compareTo(b.key))));
    final raw = prefs.getString(_withdrawKey(userId, mode));
    Map<String, dynamic> record;
    if (raw != null) {
      record = Map<String, dynamic>.from(jsonDecode(raw) as Map);
      if (record['signature'] != signature) {
        throw const AuthException('PENDING_WITHDRAW', '有一笔提现结果待确认，请先刷新收益页');
      }
    } else {
      final random = Random.secure();
      final id =
          List.generate(32, (_) => random.nextInt(16).toRadixString(16)).join();
      record = {
        'signature': signature,
        'body': {...content, 'requestId': id}
      };
      if (!await prefs.setString(
          _withdrawKey(userId, mode), jsonEncode(record))) {
        throw const AuthException('STORAGE_ERROR', '无法保存提现编号，请稍后重试');
      }
    }
    return _sendWithdraw(userId, mode, record);
  }

  Future<Map<String, dynamic>> _sendWithdraw(
      String userId, String mode, Map<String, dynamic> record) async {
    if ((await _auth.currentUser)?.id != userId) {
      throw const AuthException('ACCOUNT_CHANGED', '账号已切换，请重新打开收益页');
    }
    try {
      final result = await _auth.authenticatedRequest(
          '${CommerceConfig.earningsPath}/withdraw',
          body: Map<String, dynamic>.from(record['body'] as Map));
      await _clearWithdrawIfSame(userId, mode, record);
      return result;
    } on AuthException catch (error) {
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
        await _clearWithdrawIfSame(userId, mode, record);
      }
      rethrow;
    }
  }

  Future<void> _clearWithdrawIfSame(
      String userId, String mode, Map<String, dynamic> record) async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_withdrawKey(userId, mode));
    if (raw != null &&
        (jsonDecode(raw)['body']['requestId'] == record['body']['requestId'])) {
      await prefs.remove(_withdrawKey(userId, mode));
    }
  }

  Future<void> retryPending(String userId, String mode) async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_key(userId, mode));
    if (raw != null)
      await _send(
          userId, mode, Map<String, dynamic>.from(jsonDecode(raw) as Map));
    final withdrawRaw = prefs.getString(_withdrawKey(userId, mode));
    if (withdrawRaw != null)
      await _sendWithdraw(userId, mode,
          Map<String, dynamic>.from(jsonDecode(withdrawRaw) as Map));
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
