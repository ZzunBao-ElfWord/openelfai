import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:openelf/auth/auth_repository.dart';
import 'package:openelf/compliance/community_repository.dart';
import 'package:openelf/models/user.dart';
import 'package:openelf/state/app_state.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final state = AppState.instance;
  Map<String, dynamic> response() => {
    'protocol': 1, 'contentEnvironment': 'production', 'hasMore': false,
    'community': {'version': 1, 'blocks': [], 'reports': []}, 'elves': [],
    'posts': [{'id': 'public_post', 'elfId': 'shi_5c07', 'kind': 'text',
      'body': 'Server-approved public content', 'timeAgo': '刚刚'}],
  };
  setUp(() {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    state.bootstrapSync();
    state.currentUser = User(id: 'u_reader', phone: '18000000000', nickname: 'Reader',
      avatarInitial: 'R', createdAt: DateTime(2026));
  });
  tearDown(() { state.currentUser = null; debugDefaultTargetPlatformOverride = null; });
  test('iOS feed loads with no StoreKit/wallet initialization and sends no environment', () async {
    String? path;
    final repo = CommunityRepository(request: (p, {body}) async {
      path = p; return response();
    });
    expect(state.commerceReady, false);
    expect(await state.loadFeed(repository: repo, reset: true), isNull);
    expect(path, startsWith('/api/v1/community/feed?'));
    expect(path, isNot(contains('environment')));
    expect(state.feedForYou().map((p) => p.id), ['public_post']);
    expect(state.commerceReady, false);
    expect(state.communityMode, 'production');
  });
  test('network failure is not presented as a successfully empty feed', () async {
    final repo = CommunityRepository(request: (p, {body}) async =>
      throw const AuthException('NETWORK_ERROR', '网络请求失败'));
    expect(await state.loadFeed(repository: repo, reset: true), '网络请求失败');
    expect(state.feedError('world'), '网络请求失败');
    expect(state.feedForYou(), isEmpty);
    expect(state.feedLoading('world'), false);
  });
  test('old endpoint/malformed protocol never falls back to demo posts', () async {
    final repo = CommunityRepository(request: (p, {body}) async => {'posts': []});
    expect(await state.loadFeed(repository: repo, reset: true), isNotNull);
    expect(state.feedError('world'), contains('公共内容服务尚未更新'));
    expect(state.feedForYou(), isEmpty);
  });
  test('a response for a logged-out account cannot repopulate public cache', () async {
    final pending = Completer<Map<String, dynamic>>();
    final repo = CommunityRepository(request: (p, {body}) => pending.future);
    final request = state.loadFeed(repository: repo, reset: true);
    state.currentUser = null;
    state.bootstrapSync();
    pending.complete(response());
    await request;
    expect(state.feedForYou(), isEmpty);
  });
}
