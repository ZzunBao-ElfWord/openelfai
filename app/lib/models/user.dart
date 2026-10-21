/// 登录用户。
class User {
  final String id;
  final String phone;
  final String nickname;
  final String avatarInitial;
  final DateTime createdAt;

  const User({
    required this.id,
    required this.phone,
    required this.nickname,
    required this.avatarInitial,
    required this.createdAt,
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'phone': phone,
        'nickname': nickname,
        'avatarInitial': avatarInitial,
        'createdAt': createdAt.toIso8601String(),
      };

  factory User.fromJson(Map<String, dynamic> j) => User(
        id: j['id'] as String,
        phone: j['phone'] as String,
        nickname: j['nickname'] as String,
        avatarInitial: j['avatarInitial'] as String,
        createdAt: DateTime.parse(j['createdAt'] as String),
      );
}
