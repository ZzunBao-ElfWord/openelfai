class Tool {
  final String id;
  final String name;
  final String shortDesc;
  final String description;
  final String category;
  final String region;
  final List<String> tags;
  final String logoUrl;
  final String status;
  final String listedAt;
  final bool isFeatured;
  final String downloadUrl;
  final String officialUrl;

  Tool({
    required this.id,
    required this.name,
    required this.shortDesc,
    required this.description,
    required this.category,
    required this.region,
    required this.tags,
    required this.logoUrl,
    required this.status,
    required this.listedAt,
    required this.isFeatured,
    required this.downloadUrl,
    required this.officialUrl,
  });

  factory Tool.fromJson(Map<String, dynamic> json) {
    return Tool(
      id: json['id'] ?? '',
      name: json['name'] ?? '',
      shortDesc: json['short_desc'] ?? '',
      description: json['description'] ?? '',
      category: json['category'] ?? '',
      region: json['region'] ?? '',
      tags: (json['tags'] as List<dynamic>?)?.cast<String>() ?? [],
      logoUrl: json['logo_url'] ?? '',
      status: json['status'] ?? '',
      listedAt: json['listed_at'] ?? '',
      isFeatured: json['is_featured'] ?? false,
      downloadUrl: json['download_url'] ?? '',
      officialUrl: json['official_url'] ?? '',
    );
  }

  String get entryUrl => region == 'domestic' ? downloadUrl : officialUrl;
  String get entryLabel => region == 'domestic' ? '前往下载' : '访问官网';
  String get firstChar {
    final n = name.trim();
    return n.isNotEmpty ? n.characters.first.toUpperCase() : '·';
  }
}
