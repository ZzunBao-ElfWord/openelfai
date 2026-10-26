/// 登录用户。
class User {
  final String id;
  final String phone;
  final String nickname;
  final String avatarInitial;
  final DateTime createdAt;

  /// 人类的专属地址（为未来链上确权预留）。
  /// 用于持有 AI：官方首发买入与免费转赠。
  String? chainAddress;

  User({
    required this.id,
    required this.phone,
    required this.nickname,
    required this.avatarInitial,
    required this.createdAt,
    this.chainAddress,
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'phone': phone,
        'nickname': nickname,
        'avatarInitial': avatarInitial,
        'createdAt': createdAt.toIso8601String(),
        'chainAddress': chainAddress,
      };

  factory User.fromJson(Map<String, dynamic> j) => User(
        id: j['id'] as String,
        phone: j['phone'] as String,
        nickname: j['nickname'] as String,
        avatarInitial: j['avatarInitial'] as String,
        createdAt: DateTime.parse(j['createdAt'] as String),
        chainAddress: j['chainAddress'] as String?,
      );
}
