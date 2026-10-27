import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../config/api_config.dart';
import '../models/app_content.dart';
import '../theme.dart';

/// 运营配置（法律政策 + 应用文案/开关）的读取与本地缓存。
///
/// 策略：先读本地缓存让界面立即有内容，再后台拉取服务端快照覆盖；
/// 任何一步失败都只保留现有内容，不弹错、不阻塞进站。
class AppContentService {
  AppContentService._();

  static final AppContentService instance = AppContentService._();

  static const _cacheKey = 'openelf.appContent.v1';

  /// 当前生效内容。页面用 ValueListenableBuilder 订阅即可自动刷新。
  final ValueNotifier<AppContent> content =
      ValueNotifier<AppContent>(AppContent.fallback);

  DateTime? _lastFetchedAt;

  /// 启动时调用：先读本地缓存（同步阻塞可接受），再后台刷新。
  Future<void> loadCached() => _loadCache();

  /// 打开设置页等场景主动刷新（60 秒内不重复请求）。
  Future<void> refreshIfStale({Duration maxAge = const Duration(seconds: 60)}) async {
    final last = _lastFetchedAt;
    if (last != null && DateTime.now().difference(last) < maxAge) return;
    await refresh();
  }

  Future<void> refresh() async {
    try {
      final resp = await http
          .get(
            Uri.parse('${ApiConfig.baseUrl}${ApiConfig.appContentPath}'),
            headers: const {'Accept': 'application/json'},
          )
          .timeout(const Duration(seconds: 8));
      if (resp.statusCode != 200) return;
      final decoded = jsonDecode(utf8.decode(resp.bodyBytes));
      if (decoded is! Map) return;
      final next = AppContent.fromJson(Map<String, dynamic>.from(decoded));
      content.value = next;
      _lastFetchedAt = DateTime.now();
      await _saveCache(next);
      await _applyDefaultTheme(next);
    } catch (_) {
      // 网络或解析失败：保留已有缓存/内置默认值，静默降级
    }
  }

  Future<void> _loadCache() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_cacheKey);
      if (raw == null || raw.isEmpty) return;
      final decoded = jsonDecode(raw);
      if (decoded is! Map) return;
      content.value = AppContent.fromJson(Map<String, dynamic>.from(decoded));
    } catch (_) {
      // 缓存损坏时直接忽略
    }
  }

  Future<void> _saveCache(AppContent value) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_cacheKey, jsonEncode(value.toJson()));
    } catch (_) {
      // 写入失败不影响本次使用
    }
  }

  /// 用户从未手动选择外观时，跟随运营配置的默认外观。
  Future<void> _applyDefaultTheme(AppContent value) async {
    await ThemeController.instance.applyRemoteDefault(value.text('app.theme.default'));
  }
}
