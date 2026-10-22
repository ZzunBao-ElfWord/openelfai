import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/elf.dart';
import '../models/user.dart';
import '../data/world_data.dart';

/// 应用数据本地持久化仓库。所有状态变更 flush 到 shared_preferences。
/// 以后接后端时，可以同时 flush 到云端（只改 saveXxx 内部，调用方不动）。
class DataRepository {
  DataRepository._();
  static final DataRepository instance = DataRepository._();

  SharedPreferences? _p;

  Future<void> init() async {
    _p ??= await SharedPreferences.getInstance();
  }

  // —— keys ——
  static const _kElfs = 'openelf.elfs';
  static const _kPosts = 'openelf.posts';
  static const _kSeats = 'openelf.seats';
  static const _kPrimary = 'openelf.primaryListings';
  static const _kSecondary = 'openelf.secondaryListings';
  static const _kWallet = 'openelf.wallet';
  static const _kTips = 'openelf.tips';
  static const _kLogs = 'openelf.logs';
  static const _kFollowed = 'openelf.followed';
  static const _kComments = 'openelf.comments';
  static const _kUser = 'openelf.user';

  // —— 保存 / 加载 ——

  Future<void> saveAll({
    required List<Elf> elfs,
    required List<ElfPost> posts,
    required List<Seat> seats,
    required List<MarketListing> primary,
    required List<MarketListing> secondary,
    required Wallet wallet,
    required List<Tip> tips,
    required List<WalletLog> logs,
    required Set<String> followed,
    required Map<String, List<PostComment>> comments,
    required User user,
  }) async {
    final p = await _ensure();
    await Future.wait([
      p.setString(_kElfs, jsonEncode(elfs.map((e) => _serializeElf(e)).toList())),
      p.setString(_kPosts, jsonEncode(posts.map(_serializePost).toList())),
      p.setString(_kSeats, jsonEncode(seats.map(_serializeSeat).toList())),
      p.setString(_kPrimary, jsonEncode(primary.map(_serializeListing).toList())),
      p.setString(_kSecondary, jsonEncode(secondary.map(_serializeListing).toList())),
      p.setString(_kWallet, jsonEncode(_serializeWallet(wallet))),
      p.setString(_kTips, jsonEncode(tips.map(_serializeTip).toList())),
      p.setString(_kLogs, jsonEncode(logs.map(_serializeLog).toList())),
      p.setString(_kFollowed, jsonEncode(followed.toList())),
      p.setString(_kComments, jsonEncode(comments.map(
        (k, v) => MapEntry(k, v.map((c) => c.toJson()).toList()),
      ))),
      p.setString(_kUser, jsonEncode(user.toJson())),
    ]);
  }

  /// 加载。如果本地没存过（首次启动），返回 null 让调用方用种子数据。
  Future<LoadedData?> load() async {
    final p = await _ensure();
    final elfsRaw = p.getString(_kElfs);
    if (elfsRaw == null) return null;

    try {
      final elfs = (jsonDecode(elfsRaw) as List)
          .map((j) => _deserializeElf(Map<String, dynamic>.from(j)))
          .toList();
      final postsRaw = p.getString(_kPosts) ?? '[]';
      final posts = (jsonDecode(postsRaw) as List)
          .map((j) => _deserializePost(Map<String, dynamic>.from(j)))
          .toList();
      final seatsRaw = p.getString(_kSeats) ?? '[]';
      final seats = (jsonDecode(seatsRaw) as List)
          .map((j) => _deserializeSeat(Map<String, dynamic>.from(j)))
          .toList();
      final primaryRaw = p.getString(_kPrimary) ?? '[]';
      final primary = (jsonDecode(primaryRaw) as List)
          .map((j) => _deserializeListing(Map<String, dynamic>.from(j)))
          .toList();
      final secondaryRaw = p.getString(_kSecondary) ?? '[]';
      final secondary = (jsonDecode(secondaryRaw) as List)
          .map((j) => _deserializeListing(Map<String, dynamic>.from(j)))
          .toList();
      final walletRaw = p.getString(_kWallet) ?? '{}';
      final wallet = _deserializeWallet(Map<String, dynamic>.from(jsonDecode(walletRaw)));
      final tipsRaw = p.getString(_kTips) ?? '[]';
      final tips = (jsonDecode(tipsRaw) as List)
          .map((j) => _deserializeTip(Map<String, dynamic>.from(j)))
          .toList();
      final logsRaw = p.getString(_kLogs) ?? '[]';
      final logs = (jsonDecode(logsRaw) as List)
          .map((j) => _deserializeLog(Map<String, dynamic>.from(j)))
          .toList();
      final followedRaw = p.getString(_kFollowed) ?? '[]';
      final followed = (jsonDecode(followedRaw) as List).map((j) => j as String).toSet();
      final commentsRaw = p.getString(_kComments) ?? '{}';
      final comments = (Map<String, dynamic>.from(jsonDecode(commentsRaw))).map(
        (k, v) => MapEntry(
          k,
          (v as List)
              .map((j) => PostComment.fromJson(Map<String, dynamic>.from(j)))
              .toList(),
        ),
      );
      final userRaw = p.getString(_kUser);
      final user = userRaw != null
          ? User.fromJson(Map<String, dynamic>.from(jsonDecode(userRaw)))
          : null;

      return LoadedData(
        elfs: elfs,
        posts: posts,
        seats: seats,
        primaryListings: primary,
        secondaryListings: secondary,
        wallet: wallet,
        tips: tips,
        logs: logs,
        followed: followed,
        comments: comments,
        user: user,
      );
    } catch (e) {
      // 本地数据损坏（schema 变更），安全起见回退到种子
      debugPrint('[DataRepository] load failed: $e');
      return null;
    }
  }

  /// 清本地数据（登出时调用）。
  Future<void> clear() async {
    final p = await _ensure();
    await Future.wait([
      p.remove(_kElfs),
      p.remove(_kPosts),
      p.remove(_kSeats),
      p.remove(_kPrimary),
      p.remove(_kSecondary),
      p.remove(_kWallet),
      p.remove(_kTips),
      p.remove(_kLogs),
      p.remove(_kFollowed),
      p.remove(_kComments),
    ]);
    // _kUser 不在这里清——登出由 LocalAuthRepository 自己管
  }

  Future<SharedPreferences> _ensure() async {
    _p ??= await SharedPreferences.getInstance();
    return _p!;
  }

  // —— serialize / deserialize ——

  Map<String, dynamic> _serializeElf(Elf e) => {
        'id': e.id,
        'serial': e.serial,
        'name': e.name,
        'initial': e.initial,
        'ownerId': e.ownerId,
        'ownerLabel': e.ownerLabel,
        'isMine': e.isMine,
        'generation': e.generation,
        'edition': e.edition,
        'persona': e.persona,
        'fear': e.fear,
        'habit': e.habit,
        'status': e.status.name,
        'energy': e.energy,
        'maxEnergy': e.maxEnergy,
        'followers': e.followers,
        'echo': e.echo,
        'works': e.works,
        'attention': e.attention,
        'earningsYuan': e.earningsYuan,
        'nextAutoPostAt': e.nextAutoPostAt?.toIso8601String(),
        'slots': e.slots,
        'equipped': e.equipped,
        'today': e.today,
        'relations': e.relations
            .map((r) => {
                  'targetId': r.targetId,
                  'type': r.type,
                  'strength': r.strength,
                })
            .toList(),
      };

  Elf _deserializeElf(Map<String, dynamic> j) => Elf(
        id: j['id'] as String,
        serial: j['serial'] as String,
        name: j['name'] as String,
        initial: j['initial'] as String,
        ownerId: j['ownerId'] as String,
        ownerLabel: j['ownerLabel'] as String,
        isMine: j['isMine'] as bool,
        generation: j['generation'] as int,
        edition: j['edition'] as String,
        persona: j['persona'] as String,
        fear: j['fear'] as String,
        habit: j['habit'] as String,
        status: ElfStatus.values.firstWhere((s) => s.name == j['status']),
        energy: j['energy'] as int,
        maxEnergy: j['maxEnergy'] as int,
        followers: j['followers'] as int,
        echo: j['echo'] as int,
        works: j['works'] as int,
        attention: j['attention'] as int,
        earningsYuan: (j['earningsYuan'] as num?)?.toDouble() ?? 0,
        nextAutoPostAt: j['nextAutoPostAt'] == null
            ? null
            : DateTime.tryParse(j['nextAutoPostAt'] as String),
        slots: j['slots'] as int,
        equipped: List<String>.from(j['equipped'] as List),
        today: List<String>.from(j['today'] as List),
        relations: (j['relations'] as List)
            .map((r) => RelationEdge(
                  targetId: r['targetId'] as String,
                  type: r['type'] as String,
                  strength: r['strength'] as int,
                ))
            .toList(),
      );

  Map<String, dynamic> _serializePost(ElfPost p) => {
        'id': p.id,
        'elfId': p.elfId,
        'moduleId': p.moduleId,
        'kind': p.kind,
        'body': p.body,
        'timeAgo': p.timeAgo,
        'imageUrl': p.imageUrl,
        'videoUrl': p.videoUrl,
        'audioUrl': p.audioUrl,
        'audioDuration': p.audioDuration,
        'views': p.views,
        'dwell': p.dwell,
        'replies': p.replies,
        'context': p.context,
        'isReply': p.isReply,
      };

  ElfPost _deserializePost(Map<String, dynamic> j) => ElfPost(
        id: j['id'] as String,
        elfId: j['elfId'] as String,
        moduleId: j['moduleId'] as String?,
        kind: j['kind'] as String,
        body: j['body'] as String,
        timeAgo: j['timeAgo'] as String,
        imageUrl: j['imageUrl'] as String?,
        videoUrl: j['videoUrl'] as String?,
        audioUrl: j['audioUrl'] as String?,
        audioDuration: j['audioDuration'] as int?,
        views: j['views'] as int? ?? 0,
        dwell: j['dwell'] as int? ?? 0,
        replies: j['replies'] as int? ?? 0,
        context: j['context'] as String?,
        isReply: j['isReply'] as bool? ?? false,
      );

  Map<String, dynamic> _serializeSeat(Seat s) => {
        'elfId': s.elfId,
        'days': s.days,
        'edition': s.edition,
        'seats': s.seats,
        'injected': s.injected,
      };

  Seat _deserializeSeat(Map<String, dynamic> j) => Seat(
        elfId: j['elfId'] as String,
        days: j['days'] as int,
        edition: j['edition'] as String,
        seats: j['seats'] as int? ?? 1,
        injected: j['injected'] as int? ?? 0,
      );

  Map<String, dynamic> _serializeListing(MarketListing l) => {
        'id': l.id,
        'market': l.market,
        'elfId': l.elfId,
        'title': l.title,
        'subtitle': l.subtitle,
        'price': l.price,
        'sellerLabel': l.sellerLabel,
        'equippedCarry': l.equippedCarry,
        'edition': l.edition,
        'note': l.note,
      };

  MarketListing _deserializeListing(Map<String, dynamic> j) => MarketListing(
        id: j['id'] as String,
        market: j['market'] as String,
        elfId: j['elfId'] as String,
        title: j['title'] as String,
        subtitle: j['subtitle'] as String,
        price: j['price'] as int,
        sellerLabel: j['sellerLabel'] as String?,
        equippedCarry: j['equippedCarry'] == null
            ? null
            : List<String>.from(j['equippedCarry'] as List),
        edition: j['edition'] as String?,
        note: j['note'] as String?,
      );

  Map<String, dynamic> _serializeWallet(Wallet w) => {
        'diamonds': w.diamonds,
        'totalRecharged': w.totalRecharged,
        'totalSpent': w.totalSpent,
      };

  Wallet _deserializeWallet(Map<String, dynamic> j) => Wallet(
        diamonds: j['diamonds'] as int? ?? 0,
        totalRecharged: j['totalRecharged'] as int? ?? 0,
        totalSpent: j['totalSpent'] as int? ?? 0,
      );

  Map<String, dynamic> _serializeTip(Tip t) => {
        'id': t.id,
        'postId': t.postId,
        'elfId': t.elfId,
        'amount': t.amount,
        'time': t.time,
      };

  Tip _deserializeTip(Map<String, dynamic> j) => Tip(
        id: j['id'] as String,
        postId: j['postId'] as String,
        elfId: j['elfId'] as String,
        amount: j['amount'] as int,
        time: j['time'] as String,
      );

  Map<String, dynamic> _serializeLog(WalletLog l) => {
        'id': l.id,
        'type': l.type,
        'amount': l.amount,
        'note': l.note,
        'time': l.time,
      };

  WalletLog _deserializeLog(Map<String, dynamic> j) => WalletLog(
        id: j['id'] as String,
        type: j['type'] as String,
        amount: j['amount'] as int,
        note: j['note'] as String,
        time: j['time'] as String,
      );
}

/// 加载后的数据快照（首次启动时为 null）。
class LoadedData {
  final List<Elf> elfs;
  final List<ElfPost> posts;
  final List<Seat> seats;
  final List<MarketListing> primaryListings;
  final List<MarketListing> secondaryListings;
  final Wallet wallet;
  final List<Tip> tips;
  final List<WalletLog> logs;
  final Set<String> followed;
  final Map<String, List<PostComment>> comments;
  final User? user;

  const LoadedData({
    required this.elfs,
    required this.posts,
    required this.seats,
    required this.primaryListings,
    required this.secondaryListings,
    required this.wallet,
    required this.tips,
    required this.logs,
    required this.followed,
    required this.comments,
    required this.user,
  });
}
