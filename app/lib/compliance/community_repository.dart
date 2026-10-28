import 'dart:math';
import '../auth/remote_auth_repository.dart';

typedef CommunityRequest = Future<Map<String, dynamic>> Function(String path,
    {Map<String, dynamic>? body});

/// Authenticated, server-backed safety actions. Never fake a successful submission.
class CommunityRepository {
  CommunityRepository({CommunityRequest? request})
      : _request = request ??
            ((path, {body}) => RemoteAuthRepository.instance
                .authenticatedRequest(path, body: body));
  static final instance = CommunityRepository();
  final CommunityRequest _request;

  static String requestId() => List.generate(24,
          (_) => Random.secure().nextInt(256).toRadixString(16).padLeft(2, '0'))
      .join();

  Future<Map<String, dynamic>> snapshot(String mode) => _request(
      '/api/v1/community?environment=${Uri.encodeQueryComponent(mode)}');

  Future<Map<String, dynamic>> report(
          {required String mode,
          required String requestId,
          required String targetKind,
          required String targetId,
          required String reason,
          String details = ''}) =>
      _request('/api/v1/community/reports', body: {
        'environment': mode,
        'requestId': requestId,
        'targetKind': targetKind,
        'targetId': targetId,
        'reason': reason,
        'details': details,
      });

  Future<Map<String, dynamic>> setBlock(
          {required String mode,
          required String targetKind,
          required String targetId,
          required bool blocked}) =>
      _request('/api/v1/community/blocks', body: {
        'environment': mode,
        'targetKind': targetKind,
        'targetId': targetId,
        'blocked': blocked,
      });

  Future<Map<String, dynamic>> acceptTerms(String mode) =>
      _request('/api/v1/community/terms', body: {
        'environment': mode,
        'version': '2026-10-28',
        'accepted': true,
      });
}
