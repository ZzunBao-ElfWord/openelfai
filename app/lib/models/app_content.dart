/// 运营配置下发的内容：法律政策文档与应用文案 / 开关。
///
/// 服务端为唯一事实源（GET /api/v1/app-content），App 侧只做只读消费；
/// 字段缺失或接口不可达时一律回落到这里的内置默认值，保证界面不空白。
class AppContentDocument {
  final String slug;
  final String title;
  final int version;
  final int effectiveAt;
  final String content;

  const AppContentDocument({
    required this.slug,
    required this.title,
    required this.version,
    required this.effectiveAt,
    required this.content,
  });

  factory AppContentDocument.fromJson(String slug, Map<String, dynamic> json) {
    return AppContentDocument(
      slug: slug,
      title: json['title']?.toString() ?? '',
      version: _asInt(json['version']) ?? 1,
      effectiveAt: _asInt(json['effective_at']) ?? 0,
      content: json['content']?.toString() ?? '',
    );
  }

  bool get hasBody => content.trim().isNotEmpty;

  /// 生效日期（毫秒时间戳），0 表示未设置。
  DateTime? get effectiveDate => effectiveAt > 0
      ? DateTime.fromMillisecondsSinceEpoch(effectiveAt)
      : null;
}

class AppContent {
  final String version;
  final Map<String, AppContentDocument> documents;
  final Map<String, dynamic> configs;

  const AppContent({
    this.version = '',
    this.documents = const {},
    this.configs = const {},
  });

  /// 与后台默认 seed 保持一致的内置兜底文案。
  static const Map<String, Object> defaults = {
    'app.about.name': 'OpenElf',
    'app.about.version': 'v1.0.0',
    'app.about.slogan': '我的 AI，我做主',
    'app.about.intro': '把技能做成技能书，自己组装，放进世界替你争夺注意力。',
    'app.about.copyright': '© 2026 OpenElf',
    'app.brand.slogan': '我的 AI，我做主',
    'app.feedback.enabled': true,
    'app.feedback.channel': 'email',
    'app.feedback.email': 'support@openelfai.com',
    'app.feedback.url': '',
    'app.feedback.note': '发现违规或有建议？告诉我们',
    'app.report.enabled': true,
    'app.report.reasons': [
      '色情或低俗',
      '侮辱或攻击',
      '违法违规',
      '垃圾广告',
      '其他',
    ],
    'app.wallet.rule':
        '消费后钻石不再流通：10💎 = ¥1。打赏礼物的 50% 作为服务费结算给创作者，收益过冷静期后可提现。',
    'app.identity.note': '上传身份证完成核验，用于创建本人形象 AI',
    'app.create.declarations': [
      '形象为原创，或我已获得肖像权人的明确授权；不使用他人照片、明星或公众人物形象。',
      '形象不包含色情、暴力、违法犯罪、未成年人或侵犯他人权益的内容。',
      '我同意为 AI 生成的形象加注「AI 生成」标识，并遵守《生成式人工智能服务管理暂行办法》与《人工智能生成合成内容标识办法》。',
    ],
    'app.theme.default': 'system',
  };

  static const AppContent fallback = AppContent(configs: defaults);

  factory AppContent.fromJson(Map<String, dynamic> json) {
    final docs = <String, AppContentDocument>{};
    final rawDocs = json['documents'];
    if (rawDocs is Map) {
      rawDocs.forEach((key, value) {
        if (value is Map) {
          docs[key.toString()] =
              AppContentDocument.fromJson(key.toString(), Map<String, dynamic>.from(value));
        }
      });
    }
    final rawConfigs = json['configs'];
    return AppContent(
      version: json['version']?.toString() ?? '',
      documents: docs,
      configs: rawConfigs is Map ? Map<String, dynamic>.from(rawConfigs) : const {},
    );
  }

  Map<String, dynamic> toJson() => {
        'version': version,
        'documents': {
          for (final entry in documents.entries)
            entry.key: {
              'title': entry.value.title,
              'version': entry.value.version,
              'effective_at': entry.value.effectiveAt,
              'content': entry.value.content,
            },
        },
        'configs': configs,
      };

  String text(String key) {
    final v = configs[key];
    if (v is String && v.trim().isNotEmpty) return v;
    final fallbackValue = defaults[key];
    return fallbackValue is String ? fallbackValue : '';
  }

  bool flag(String key) {
    final v = configs[key];
    if (v is bool) return v;
    final fallbackValue = defaults[key];
    return fallbackValue is bool ? fallbackValue : false;
  }

  List<String> list(String key) {
    final v = configs[key];
    if (v is List) {
      final items = v.map((e) => e.toString()).where((e) => e.trim().isNotEmpty).toList();
      if (items.isNotEmpty) return items;
    }
    final fallbackValue = defaults[key];
    return fallbackValue is List ? List<String>.from(fallbackValue) : const [];
  }

  AppContentDocument? document(String slug) => documents[slug];
}

int? _asInt(Object? value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  if (value is String) return int.tryParse(value);
  return null;
}
