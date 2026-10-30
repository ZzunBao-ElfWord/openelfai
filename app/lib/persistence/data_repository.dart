import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../compliance/identity_verification.dart';
import '../models/elf.dart';
import '../models/user.dart';

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
  static const _kWallet = 'openelf.wallet';
  static const _kTips = 'openelf.tips';
  static const _kLogs = 'openelf.logs';
  static const _kFollowed = 'openelf.followed';
  static const _kComments = 'openelf.comments';
  static const _kUser = 'openelf.user';
  static const _kLikedPosts = 'openelf.likedPosts';
  static const _kCollectedPosts = 'openelf.collectedPosts';
  static const _kWatchedPosts = 'openelf.watchedPosts';
  static const _kReferralCounted = 'openelf.referralCounted';
  static const _kBooks = 'openelf.books';

  /// 旧版（装配模式）的已购模块 id，仅用于 v1.6 迁移读取，不再写入。
  static const _kLegacyOwnedModules = 'openelf.ownedModules';
  static const _kActiveElfId = 'openelf.activeElfId';
  static const _kIdentity = 'openelf.identity';

  // —— 保存 / 加载 ——

  Future<void> saveAll({
    required List<Elf> elfs,
    required List<ElfPost> posts,
    required List<Seat> seats,
    required List<MarketListing> primary,
    required Wallet wallet,
    required List<Tip> tips,
    required List<WalletLog> logs,
    required Set<String> followed,
    required Map<String, List<PostComment>> comments,
    required Set<String> likedPosts,
    required Set<String> collectedPosts,
    required Set<String> watchedPosts,
    required Set<String> referralCounted,
    required List<BookInstance> books,
    String? activeElfId,
    IdentityVerification? identity,
    required User user,
  }) async {
    final p = await _ensure();
    await Future.wait([
      p.setString(
          _kElfs, jsonEncode(elfs.map((e) => _serializeElf(e)).toList())),
      p.setString(_kPosts, jsonEncode(posts.map(_serializePost).toList())),
      p.setString(_kSeats, jsonEncode(seats.map(_serializeSeat).toList())),
      p.setString(
          _kPrimary, jsonEncode(primary.map(_serializeListing).toList())),
      p.setString(_kWallet, jsonEncode(_serializeWallet(wallet))),
      p.setString(_kTips, jsonEncode(tips.map(_serializeTip).toList())),
      p.setString(_kLogs, jsonEncode(logs.map(_serializeLog).toList())),
      p.setString(_kFollowed, jsonEncode(followed.toList())),
      p.setString(
          _kComments,
          jsonEncode(comments.map(
            (k, v) => MapEntry(k, v.map((c) => c.toJson()).toList()),
          ))),
      p.setString(_kUser, jsonEncode(user.toJson())),
      p.setString(_kLikedPosts, jsonEncode(likedPosts.toList())),
      p.setString(_kCollectedPosts, jsonEncode(collectedPosts.toList())),
      p.setString(_kWatchedPosts, jsonEncode(watchedPosts.toList())),
      p.setString(_kReferralCounted, jsonEncode(referralCounted.toList())),
      p.setString(_kBooks, jsonEncode(books.map(_serializeBook).toList())),
      if (activeElfId != null)
        p.setString(_kActiveElfId, activeElfId)
      else
        p.remove(_kActiveElfId),
      if (identity != null)
        p.setString(_kIdentity, jsonEncode(identity.toJson()))
      else
        p.remove(_kIdentity),
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
      final walletRaw = p.getString(_kWallet) ?? '{}';
      final wallet =
          _deserializeWallet(Map<String, dynamic>.from(jsonDecode(walletRaw)));
      final tipsRaw = p.getString(_kTips) ?? '[]';
      final tips = (jsonDecode(tipsRaw) as List)
          .map((j) => _deserializeTip(Map<String, dynamic>.from(j)))
          .toList();
      final logsRaw = p.getString(_kLogs) ?? '[]';
      final logs = (jsonDecode(logsRaw) as List)
          .map((j) => _deserializeLog(Map<String, dynamic>.from(j)))
          .toList();
      final followedRaw = p.getString(_kFollowed) ?? '[]';
      final followed =
          (jsonDecode(followedRaw) as List).map((j) => j as String).toSet();
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
      final identityRaw = p.getString(_kIdentity);
      final identity = identityRaw != null
          ? IdentityVerification.fromJson(
              Map<String, dynamic>.from(jsonDecode(identityRaw)))
          : null;
      // v1.2 新增字段：老数据缺失时迁移为空集
      Set<String> readSet(String key) {
        final raw = p.getString(key) ?? '[]';
        return (jsonDecode(raw) as List).map((j) => j as String).toSet();
      }

      return LoadedData(
        elfs: elfs,
        posts: posts,
        seats: seats,
        primaryListings: primary,
        wallet: wallet,
        tips: tips,
        logs: logs,
        followed: followed,
        comments: comments,
        likedPosts: readSet(_kLikedPosts),
        collectedPosts: readSet(_kCollectedPosts),
        watchedPosts: readSet(_kWatchedPosts),
        referralCounted: readSet(_kReferralCounted),
        books: (jsonDecode(p.getString(_kBooks) ?? '[]') as List)
            .map((j) => _deserializeBook(Map<String, dynamic>.from(j)))
            .toList(),
        legacyOwnedModules: readSet(_kLegacyOwnedModules),
        activeElfId: p.getString(_kActiveElfId),
        identity: identity,
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
      p.remove(_kWallet),
      p.remove(_kTips),
      p.remove(_kLogs),
      p.remove(_kFollowed),
      p.remove(_kComments),
      p.remove(_kLikedPosts),
      p.remove(_kCollectedPosts),
      p.remove(_kWatchedPosts),
      p.remove(_kReferralCounted),
      p.remove(_kBooks),
      p.remove(_kLegacyOwnedModules),
      p.remove(_kActiveElfId),
      p.remove(_kIdentity),
    ]);
    // _kUser 不在这里清——登出由 LocalAuthRepository 自己管
  }

  Future<SharedPreferences> _ensure() async {
    _p ??= await SharedPreferences.getInstance();
    return _p!;
  }

  // —— serialize / deserialize ——
  // Payment snapshots use the same model schema, but ownership is server-owned.
  Elf decodePaymentElf(Map<String, dynamic> value) =>
      _deserializeElf({...value, 'status': 'active'});
  ElfPost decodePaymentPost(Map<String, dynamic> value) =>
      _deserializePost(value);
  MarketListing decodePaymentListing(Map<String, dynamic> value) =>
      _deserializeListing(value);
  WalletLog decodePaymentLog(Map<String, dynamic> value) =>
      _deserializeLog(value);
  BookInstance decodePaymentBook(Map<String, dynamic> value) =>
      _deserializeBook(value);

  /// 技能书目录项：名称/图标/赛道/文案/价格由服务端下发，客户端只做展示。
  AbilityModule decodePaymentModule(Map<String, dynamic> j) => AbilityModule(
        id: j['id'] as String,
        name: j['name']?.toString() ?? '',
        glyph: j['glyph']?.toString() ?? '',
        category: j['category']?.toString() ?? 'text',
        track: j['track']?.toString() ?? 'writing',
        summary: j['summary']?.toString() ?? '',
        effect: j['effect']?.toString() ?? '',
        price: '💎 ${j['price'] ?? 0}',
        seats: (j['seats'] as num?)?.toInt() ?? 1,
        compute: (j['compute'] as num?)?.toInt() ?? 0,
      );

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
        'followers': e.followers,
        'echo': e.echo,
        'works': e.works,
        'attention': e.attention,
        'earningsYuan': e.earningsYuan,
        'nextAutoPostAt': e.nextAutoPostAt?.toIso8601String(),
        'lastDecayAt': e.lastDecayAt?.toIso8601String(),
        'chainAddress': e.chainAddress,
        'avatarUrl': e.avatarUrl,
        'avatarStyle': e.avatarStyle,
        'avatarPrompt': e.avatarPrompt,
        'portraitSource': e.portraitSource,
        'isOfficial': e.isOfficial,
        'baseCapacity': e.baseCapacity,
        'learnedSkills': e.learnedSkills,
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
        followers: j['followers'] as int,
        echo: j['echo'] as int,
        works: j['works'] as int,
        attention: j['attention'] as int,
        earningsYuan: (j['earningsYuan'] as num?)?.toDouble() ?? 0,
        nextAutoPostAt: j['nextAutoPostAt'] is num
            ? DateTime.fromMillisecondsSinceEpoch(
                (j['nextAutoPostAt'] as num).toInt())
            : j['nextAutoPostAt'] == null
                ? null
                : DateTime.tryParse(j['nextAutoPostAt'] as String),
        lastDecayAt: j['lastDecayAt'] == null
            ? null
            : DateTime.tryParse(j['lastDecayAt'] as String),
        wallet: ElfWallet(chainAddress: j['chainAddress'] as String?),
        avatarUrl: j['avatarUrl'] as String?,
        avatarStyle: j['avatarStyle'] as String?,
        avatarPrompt: j['avatarPrompt'] as String?,
        portraitSource: j['portraitSource'] as String? ?? 'text',
        isOfficial: j['isOfficial'] as bool? ?? false,
        // v1.6 迁移：baseSlots/slots → baseCapacity；equipped → learnedSkills
        baseCapacity: (j['baseCapacity'] as int?) ??
            (j['baseSlots'] as int?) ??
            (j['slots'] as int),
        learnedSkills:
            List<String>.from((j['learnedSkills'] ?? j['equipped']) as List),
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
        'coverUrl': p.coverUrl,
        'audioUrl': p.audioUrl,
        'audioDuration': p.audioDuration,
        'views': p.views,
        'dwell': p.dwell,
        'replies': p.replies,
        'likes': p.likes,
        'collects': p.collects,
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
        coverUrl: j['coverUrl'] as String?,
        audioUrl: j['audioUrl'] as String?,
        audioDuration: j['audioDuration'] as int?,
        views: j['views'] as int? ?? 0,
        dwell: j['dwell'] as int? ?? 0,
        replies: j['replies'] as int? ?? 0,
        likes: j['likes'] as int? ?? 0,
        collects: j['collects'] as int? ?? 0,
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
        'edition': l.edition,
        'note': l.note,
      };

  MarketListing _deserializeListing(Map<String, dynamic> j) => MarketListing(
        id: j['id'] as String,
        market: j['market'] as String,
        elfId: j['elfId'] as String? ?? '',
        title: j['title'] as String,
        subtitle: j['subtitle'] as String,
        price: j['price'] as int,
        edition: j['edition'] as String?,
        note: j['note'] as String?,
      );

  Map<String, dynamic> _serializeBook(BookInstance b) => {
        'id': b.id,
        'moduleId': b.moduleId,
        'ownerAddress': b.ownerAddress,
        'mintedAt': b.mintedAt.toIso8601String(),
      };

  BookInstance _deserializeBook(Map<String, dynamic> j) => BookInstance(
        id: j['id'] as String,
        moduleId: j['moduleId'] as String,
        ownerAddress: j['ownerAddress'] as String? ?? '',
        mintedAt:
            DateTime.tryParse(j['mintedAt'] as String? ?? '') ?? DateTime.now(),
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
  final Wallet wallet;
  final List<Tip> tips;
  final List<WalletLog> logs;
  final Set<String> followed;
  final Map<String, List<PostComment>> comments;
  final Set<String> likedPosts;
  final Set<String> collectedPosts;
  final Set<String> watchedPosts;
  final Set<String> referralCounted;
  final List<BookInstance> books;

  /// 仅用于 v1.6 迁移：旧版已购模块 id。
  final Set<String> legacyOwnedModules;
  final String? activeElfId;
  final IdentityVerification? identity;
  final User? user;

  const LoadedData({
    required this.elfs,
    required this.posts,
    required this.seats,
    required this.primaryListings,
    required this.wallet,
    required this.tips,
    required this.logs,
    required this.followed,
    required this.comments,
    required this.likedPosts,
    required this.collectedPosts,
    required this.watchedPosts,
    required this.referralCounted,
    required this.books,
    this.legacyOwnedModules = const {},
    this.activeElfId,
    this.identity,
    required this.user,
  });
}
