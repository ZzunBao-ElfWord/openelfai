import 'dart:convert';
import 'package:flutter/services.dart';
import '../models/tool.dart';

class CategoryInfo {
  final String code;
  final String name;
  final String icon;
  final String desc;

  CategoryInfo({required this.code, required this.name, required this.icon, required this.desc});
}

class ToolsRepository {
  static final ToolsRepository _instance = ToolsRepository._internal();
  factory ToolsRepository() => _instance;
  ToolsRepository._internal();

  List<Tool> _tools = [];
  bool _loaded = false;

  static const List<CategoryInfo> categories = [
    CategoryInfo(code: 'chat_assistant', name: '对话助手', icon: 'chat_bubble', desc: '通用大模型对话产品'),
    CategoryInfo(code: 'image_gen', name: '图像生成', icon: 'image', desc: '文生图与图像编辑工具'),
    CategoryInfo(code: 'audio_video', name: '音视频', icon: 'play_circle', desc: '音频视频生成与剪辑'),
    CategoryInfo(code: 'coding', name: '编程开发', icon: 'code', desc: '代码补全与 AI IDE'),
    CategoryInfo(code: 'office', name: '办公效率', icon: 'work', desc: '文档演示与办公套件'),
    CategoryInfo(code: 'agent_search', name: '智能体与搜索', icon: 'search', desc: 'Agent 平台与 AI 搜索'),
  ];

  static const Map<String, String> regionLabel = {
    'domestic': '国内工具',
    'overseas': '海外工具',
  };

  Future<void> load() async {
    if (_loaded) return;
    final jsonString = await rootBundle.loadString('assets/data/tools.json');
    final List<dynamic> jsonList = jsonDecode(jsonString);
    _tools = jsonList.map((j) => Tool.fromJson(j)).where(_isActive).toList();
    _loaded = true;
  }

  bool _isActive(Tool t) {
    if (t.status != 'active') return false;
    final hasEntry = t.region == 'domestic'
        ? t.downloadUrl.trim().isNotEmpty
        : t.officialUrl.trim().isNotEmpty;
    return hasEntry;
  }

  List<Tool> get tools => List.unmodifiable(_tools);

  List<Tool> search(String query, {String? category, String? region}) {
    final q = query.trim().toLowerCase();
    return _tools.where((t) {
      if (category != null && t.category != category) return false;
      if (region != null && t.region != region) return false;
      if (q.isEmpty) return true;
      return t.name.toLowerCase().contains(q) || t.shortDesc.toLowerCase().contains(q);
    }).toList();
  }

  Tool? getById(String id) {
    try {
      return _tools.firstWhere((t) => t.id == id);
    } catch (_) {
      return null;
    }
  }

  List<Tool> getByCategory(String category) =>
      _tools.where((t) => t.category == category).toList();

  List<Tool> get featured => _tools.where((t) => t.isFeatured).toList();

  List<Tool> get latest {
    final copy = List<Tool>.from(_tools);
    copy.sort((a, b) => b.listedAt.compareTo(a.listedAt));
    return copy;
  }

  Map<String, int> get counts {
    final c = <String, int>{'total': _tools.length, 'domestic': 0, 'overseas': 0};
    for (final t in _tools) {
      if (t.region == 'domestic') c['domestic'] = (c['domestic'] ?? 0) + 1;
      if (t.region == 'overseas') c['overseas'] = (c['overseas'] ?? 0) + 1;
    }
    return c;
  }

  Map<String, int> get categoryCounts {
    final c = <String, int>{};
    for (final t in _tools) {
      c[t.category] = (c[t.category] ?? 0) + 1;
    }
    return c;
  }
}
