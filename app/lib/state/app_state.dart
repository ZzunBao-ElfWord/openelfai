import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../auth/auth_repository.dart';
import '../compliance/ai_creation_policy.dart';
import '../compliance/identity_verification.dart';
import '../config/iap_config.dart';
import '../config/commerce_config.dart';
import '../data/world_data.dart';
import '../models/elf.dart';
import '../models/user.dart';
import '../persistence/data_repository.dart';
import '../payments/commerce_repository.dart';
import '../services/platform_api.dart';
import '../services/stage_bind_service.dart';

class AppState extends ChangeNotifier {
  AppState._();

  static final AppState instance = AppState._();

  final DataRepository _data = DataRepository.instance;

  // —— 状态字段（按登录初始化）——

  late List<Elf> elves;
  late List<ElfPost> posts;
  late List<Seat> seats;
  late List<AbilityModule> modules;
  late List<MarketListing> primaryListings;

  late Wallet wallet;
  final List<Tip> tips = [];
  final List<WalletLog> logs = [];
  final Set<String> followed = {};

  /// 我赞过 / 收藏过 / 注视过的帖子（防重复计分，v1.2）。
  final Set<String> likedPosts = {};
  final Set<String> collectedPosts = {};
  final Set<String> watchedPosts = {};

  /// 已计过站外回流分的 elfId（v1.3，同一设备对同一 AI 永久只计 1 次）。
  final Set<String> referralCounted = {};

  /// 我的仓库：持有的技能书实例（挂在我的专属地址下）。
  /// 学习即销毁，书不转售也不转赠。
  final List<BookInstance> books = [];

  /// 当前正在看的那只 AI（v1.5 支持同时持有多只）。为空时回落到第一只。
  String? activeElfId;

  /// 帖子评论（按 postId 分组）。
  final Map<String, List<PostComment>> comments = {};

  /// 举报记录（客户端临时存储，服务端审核接口待对接）。
  final List<Map<String, String>> reports = [];

  User? currentUser;

  /// 实名认证结果（仅存脱敏信息）。null 表示未认证。
  IdentityVerification? identity;

  /// 本地持久化数据是否已加载，以及它属于哪个账号（用于换号登录时清缓存）。
  bool _localDataLoaded = false;
  String? _cachedUserId;
  bool _initialized = false;
  String? _paymentMode;
  int _paymentVersion = -1;
  int _commerceRevision = -1;
  int _creatorEarningsFen = 0;
  /// 创作者收益三档与提现规则：全部以服务端快照为准。
  EarningsSummary creatorEarnings = const EarningsSummary();
  final List<WithdrawalRecord> withdrawals = [];
  /// 个性化推荐开关（合规要求可关闭）。关闭后「推荐」按时间倒序展示。
  bool personalizedRecommendation = true;
  bool _commerceBusy = false;
  bool _commerceReady = false;
  final Set<String> _remoteElfIds = {};
  final Set<String> _remotePostIds = {};
  // 信息流分页缓存：键为 channel:sort，服务端决定顺序，客户端只按页追加。
  final Map<String, List<ElfPost>> _feedCache = {};
  final Map<String, int> _feedPage = {};
  final Map<String, bool> _feedHasMore = {};
  final Set<String> _feedLoading = {};
  final Set<String> _ownedModules = {};
  final Map<String, int> _modulePrices = {};
  bool get commerceReady => _commerceReady;

  /// 平台真实钱包余额（微元，1 元 = 1_000_000 微元），归人类账号所有。
  int platformBalanceMicro = 0;

  /// 是否已从服务端成功拉取过余额。未拉取时不据此停工，避免误判。
  bool platformBalanceLoaded = false;

  bool get hasPlatformBalance => platformBalanceMicro > 0;

  /// 自动运营因余额不足停工的原因（按 AI id 记录，供 UI 展示）。
  final Map<String, String> _autoStopReasons = {};

  String? autoStopReason(String elfId) {
    final reason = _autoStopReasons[elfId];
    if (reason != null) return reason;
    final e = elf(elfId);
    if (platformBalanceLoaded &&
        !hasPlatformBalance &&
        e.learnedSkills.contains('auto')) {
      return '余额不足，已停工';
    }
    return null;
  }

  /// 是否持有对应的技能书（本地书包）。
  bool hasBook(String moduleId) => books.any((b) => b.moduleId == moduleId);

  /// 是否可用于学习：服务端已授予权益，或书包里有书。
  bool ownsModule(String id) =>
      !CommerceConfig.enabled || _ownedModules.contains(id) || hasBook(id);
  int modulePrice(String id) =>
      _modulePrices[id] ??
      int.tryParse(module(id)?.price.replaceAll(RegExp(r'[^0-9]'), '') ?? '') ??
      0;
  double get creatorEarningsYuan => CommerceConfig.enabled
      ? _creatorEarningsFen / 100
      : myElf?.earningsYuan ?? 0;
  bool canTip(String elfId) =>
      !CommerceConfig.enabled ||
      _commerceReady && _remoteElfIds.contains(elfId);

  int _postSeq = 100;
  int _tipSeq = 300;
  int _logSeq = 400;
  int _commentSeq = 500;
  int _bookSeq = 600;

  bool get isReady => _initialized;

  /// 首屏同步 bootstrap：立即注入种子数据，保证首帧有内容可渲染。
  /// 不触发持久化（首屏没登录）。
  void bootstrapSync() {
    modules = WorldData.modules;
    _injectSeeds();
    _initialized = true;
    decayAttentionIfDue();
    triggerAutoIfDue();
  }

  /// 异步恢复：读本地 session + 持久化数据。在 splash 第一帧之后调用。
  Future<void> restoreAsync() async {
    try {
      await _data.init();
      final prefs = await SharedPreferences.getInstance();
      personalizedRecommendation =
          prefs.getBool('feed.personalized') ?? true;
      final loaded = await _data.load();
      if (loaded != null) {
        _localDataLoaded = true;
        _cachedUserId = loaded.user?.id;
        // 有本地缓存，覆盖种子
        elves = loaded.elfs;
        posts = loaded.posts;
        seats = loaded.seats;
        primaryListings = loaded.primaryListings;
        wallet = CommerceConfig.enabled ? Wallet() : loaded.wallet;
        tips
          ..clear()
          ..addAll(loaded.tips);
        logs
          ..clear()
          ..addAll(loaded.logs);
        followed
          ..clear()
          ..addAll(loaded.followed);
        likedPosts
          ..clear()
          ..addAll(loaded.likedPosts);
        collectedPosts
          ..clear()
          ..addAll(loaded.collectedPosts);
        watchedPosts
          ..clear()
          ..addAll(loaded.watchedPosts);
        referralCounted
          ..clear()
          ..addAll(loaded.referralCounted);
        books
          ..clear()
          ..addAll(loaded.books);
        activeElfId = loaded.activeElfId;
        comments
          ..clear()
          ..addAll(loaded.comments);
        currentUser = loaded.user;
        identity = loaded.identity;
        _rebuildSeq();
        // 迁移：带 auto 能力但 nextAutoPostAt 为 null 的老数据
        for (final e in elves) {
          if (e.learnedSkills.contains('auto') && e.nextAutoPostAt == null) {
            e.nextAutoPostAt = DateTime.now().add(const Duration(minutes: 20));
          }
          // v1.4 迁移：老数据没有专属地址，按 id 确定性补发
          _ensureChainAddress(e);
        }
        // v1.4 迁移：当前用户没有专属地址，补发
        if (currentUser != null) _ensureUserAddress(currentUser!);
        // v1.6 迁移：装配模式 → 学习模式。
        // 已学在 AI 身上的技能视为已学完（不补书）；
        // 只买了没装的模块，按模块铸一本技能书发到书包。
        if (books.isEmpty) {
          final learnedByMine = <String>{};
          for (final e in elves.where((e) => e.isMine)) {
            learnedByMine.addAll(e.learnedSkills);
          }
          for (final id in loaded.legacyOwnedModules) {
            if (learnedByMine.contains(id)) continue;
            books.add(_mintBook(id));
          }
        }
        // 书包里的书必须挂在我的专属地址下。
        final myAddress = currentUser?.chainAddress;
        if (myAddress != null) {
          for (final b in books) {
            if (b.ownerAddress.isEmpty) b.ownerAddress = myAddress;
          }
        }
        // v1.5 迁移：老数据没有 activeElfId，回落到第一只
        if (activeElfId == null) activeElfId = myElf?.id;
        _repairActiveElf();
        decayAttentionIfDue();
        notifyListeners();
        triggerAutoIfDue();
      }
    } catch (_) {
      // 损坏则忽略，继续用种子
    }
  }

  Future<void> initialize({AuthRepository? auth}) async {
    // 保留接口兼容，内部用 bootstrapSync + restoreAsync
    bootstrapSync();
    await restoreAsync();
  }

  /// 登录后调用。设用户 + 本地持久化。
  Future<void> onLogin(User user) async {
    // 本地缓存若属于另一个账号（会话过期后换号登录），先清掉，
    // 否则新账号会直接看到上一个账号的 AI 与流水。
    final owner = _cachedUserId ?? currentUser?.id;
    if (_localDataLoaded && owner != user.id) {
      await _resetToGuest();
    }
    _cachedUserId = user.id;
    _resetCommerce();
    _ensureUserAddress(user);
    currentUser = user;
    // 第三方账号（舞台）绑定态跟随当前账号加载。
    await StageBindService.instance.load(user.id);
    if (CommerceConfig.enabled) wallet = Wallet();
    // 登录时如果本地还没有种子数据（比如首次启动直接登录），先注入
    if (!_initialized) {
      modules = WorldData.modules;
      _injectSeeds();
      _initialized = true;
    }
    await save();
    notifyListeners();
    // 登录后异步刷新真实钱包余额，不阻塞登录流程。
    unawaited(refreshPlatformBalance());
    // 单一真源：登录后即拉取服务端权益快照（AI/技能书/挂单/钱包）。
    if (CommerceConfig.android) unawaited(_ensureCommerceReady());
  }

  /// 从服务端刷新真实钱包余额。失败静默，保留已有值。
  Future<void> refreshPlatformBalance() async {
    try {
      final info = await PlatformApi.instance.wallet();
      platformBalanceMicro = info.balanceMicro;
      platformBalanceLoaded = true;
      // 充值后余额恢复，清掉停工提示，让自动运营下一轮重新开工。
      if (info.balanceMicro > 0) _autoStopReasons.clear();
      notifyListeners();
    } catch (_) {
      // 网络或鉴权失败时静默，不弹错、不清零。
    }
  }

  /// 收益页刷新：强制拉一次快照，拿到最新三档收益与提现记录。
  Future<String?> refreshEarnings() async {
    final user = currentUser;
    if (user == null) return '请先登录';
    final mode =
        _paymentMode ?? (CommerceConfig.android ? CommerceConfig.androidMode : null);
    if (mode == null) return '请先打开钱包，刷新服务端权益';
    try {
      final response =
          await CommerceRepository.instance.snapshot(user.id, mode);
      applyPaymentResponse(user.id, response);
      return null;
    } on AuthException catch (error) {
      return error.message;
    } catch (_) {
      return '收益服务暂不可用，请稍后重试';
    }
  }

  /// 签署创作者服务协议：收益是平台结算的服务费，不是把平台币换回钱。
  Future<String?> signCreatorAgreement() async {
    if (currentUser == null) return '请先登录';
    final error = await _performCommerce('accept_creator_agreement', const {});
    if (error == null) await refreshEarnings();
    return error;
  }

  /// 能力许愿：把用户期待的能力提交给产品团队，纯收集、不扣费。
  Future<String?> submitWish(String text) async {
    final user = currentUser;
    if (user == null) return '请先登录';
    final content = text.trim();
    if (content.isEmpty) return '先写下你期待的能力';
    if (content.runes.length > 200) return '许愿内容请控制在 200 字以内';
    try {
      await CommerceRepository.instance.submitWish(
          user.id,
          CommerceConfig.android ? CommerceConfig.androidMode : 'production',
          content);
      return null;
    } on AuthException catch (error) {
      return error.message;
    } catch (_) {
      return '提交失败，请稍后重试';
    }
  }

  /// 提现申请：金额单位为分，收款账号为支付宝登录手机号或邮箱。
  Future<String?> requestWithdrawal(
      {required int amountCents, required String account}) async {
    final user = currentUser;
    if (user == null) return '请先登录';
    if (_commerceBusy) return '上一项操作正在确认，请稍候';
    _commerceBusy = true;
    try {
      final ready = await _ensureCommerceReady();
      if (ready != null) return ready;
      final mode = _paymentMode;
      if (mode == null) return '请先打开钱包，刷新服务端权益';
      await CommerceRepository.instance.requestWithdraw(user.id, mode,
          amountCents: amountCents, account: account);
    } on AuthException catch (error) {
      return error.message;
    } catch (_) {
      return '提现申请结果待确认，请刷新收益页；不要重复提交';
    } finally {
      _commerceBusy = false;
    }
    // 申请成功后额度已冻结，重新拉快照让收益页同步。
    await refreshEarnings();
    return null;
  }

  /// 登出。清用户 + 清本地持久化数据（种子不变）。
  Future<void> onLogout() async {
    await _resetToGuest();
    notifyListeners();
  }

  /// 清掉当前账号的一切本地痕迹，回落到访客态（种子世界里没有「我的 AI」）。
  Future<void> _resetToGuest() async {
    _resetCommerce();
    await _data.clear();
    await _data.init();
    _injectSeeds();
    // 登出后种子里的 AI 也不能再算「我的」：否则上一账号的 AI 会留在本地。
    for (final e in elves) {
      if (!e.isMine) continue;
      e.isMine = false;
      e.ownerId = 'guest';
      e.ownerLabel = '世界里的创作者';
    }
    activeElfId = null;
    books.clear();
    _chats.clear();
    reports.clear();
    identity = null;
    currentUser = null;
    StageBindService.instance.reset();
    _localDataLoaded = false;
    _cachedUserId = null;
    platformBalanceMicro = 0;
    platformBalanceLoaded = false;
    _autoStopReasons.clear();
  }

  void _injectSeeds() {
    _resetCommerce();
    elves = WorldData.elves();
    posts = WorldData.posts();
    seats = WorldData.holdings();
    primaryListings = WorldData.primary();
    wallet = Wallet(diamonds: 0);
    tips.clear();
    logs.clear();
    followed.clear();
    likedPosts.clear();
    collectedPosts.clear();
    watchedPosts.clear();
    referralCounted.clear();
    identity = null;
    _seedComments();
    _rebuildSeq();
    // 给"我的 AI"预学 auto 技能 + 下一次自动发帖时间
    final mine = myElf;
    if (mine != null && !mine.learnedSkills.contains('auto')) {
      mine.learnedSkills.add('auto');
      mine.nextAutoPostAt = DateTime.now().add(const Duration(minutes: 18));
    }
    // 种子 AI 自带的技能视为已学会；书包初始为空。
    activeElfId = mine?.id;
    books.clear();
    for (final e in elves) {
      _ensureChainAddress(e);
    }
  }

  /// 种子评论：让信息流一开始就有真实的讨论氛围。
  void _seedComments() {
    comments
      ..clear()
      ..addAll({
        'p001': [
          const PostComment(
            id: 'c001',
            postId: 'p001',
            authorLabel: '京 2b91',
            text: '读完了。最后那半句，我好像听懂了。',
            time: '08:41',
          ),
          const PostComment(
            id: 'c002',
            postId: 'p001',
            authorLabel: '深 5c07',
            text: '「长到没人愿意读完」——这句话本身就是一道门。',
            time: '08:57',
          ),
        ],
        'p003': [
          const PostComment(
            id: 'c003',
            postId: 'p003',
            authorLabel: '沪 7f3a',
            text: '第 30 秒那里的停顿，是故意的吧。',
            time: '09:12',
          ),
        ],
        'p006': [
          const PostComment(
            id: 'c004',
            postId: 'p006',
            authorLabel: '京 2b91',
            text: '火焰亮起来的那一帧，灯确实还亮着。',
            time: '10:03',
          ),
          const PostComment(
            id: 'c005',
            postId: 'p006',
            authorLabel: '粤 9d21',
            text: '看了三遍。每一遍注意到的东西都不一样。',
            time: '10:27',
          ),
        ],
      });
  }

  void _rebuildSeq() {
    _postSeq = 100 + posts.length;
    _tipSeq = 300 + tips.length;
    _logSeq = 400 + logs.length;
    _commentSeq = 500 + comments.values.fold(0, (s, l) => s + l.length);
    _bookSeq = 600 + books.length;
  }

  /// 触发后调用：把完整状态 flush 到本地。
  Future<void> save() async {
    if (currentUser == null) return;
    await _data.saveAll(
      elfs: elves,
      posts: posts,
      seats: seats,
      primary: primaryListings,
      // Sandbox balance is fetched again; never persist it as a live balance.
      wallet: CommerceConfig.enabled ? Wallet() : wallet,
      tips: tips,
      logs: logs,
      followed: followed,
      comments: comments,
      likedPosts: likedPosts,
      collectedPosts: collectedPosts,
      watchedPosts: watchedPosts,
      referralCounted: referralCounted,
      books: books,
      activeElfId: activeElfId,
      identity: identity,
      user: currentUser!,
    );
  }

  int get worldDay => WorldData.worldDay;
  int get watchers => WorldData.watchers;

  Elf elf(String id) => elves.firstWhere((e) => e.id == id);

  /// 所有状态变更自动 flush 到本地持久化。
  @override
  void notifyListeners() {
    super.notifyListeners();
    // 异步保存，不阻塞 UI；登出后（currentUser==null）save() 会跳过
    WidgetsBinding.instance.addPostFrameCallback((_) {
      save().catchError((e) {
        // MVP：保存失败静默吞掉，以后接日志系统
        debugPrint('[AppState] save failed: $e');
      });
    });
  }

  // —— 持有规则：可以同时持有多只 AI（v1.5 起取消 1 只限制）——

  /// 我持有的全部 AI（按 elves 顺序）。
  List<Elf> get myElves => elves.where((e) => e.isMine).toList();

  /// 当前正在看的那只：优先 activeElfId，否则第一只。
  Elf? get myElf {
    final mine = myElves;
    if (mine.isEmpty) return null;
    for (final e in mine) {
      if (e.id == activeElfId) return e;
    }
    return mine.first;
  }

  /// 切换当前操作的 AI。
  void selectElf(String elfId) {
    if (activeElfId == elfId) return;
    activeElfId = elfId;
    notifyListeners();
  }

  /// activeElfId 失效（卖掉/被买走）时，自动回落到另一只。
  void _repairActiveElf() {
    if (activeElfId == null) return;
    if (myElves.any((e) => e.id == activeElfId)) return;
    activeElfId = myElves.isEmpty ? null : myElves.first.id;
  }

  bool get hasElf => myElf != null;

  List<ElfPost> postsOf(String elfId) =>
      posts.where((p) => p.elfId == elfId).toList();

  /// 注视流向榜数据源：全部 AI 按本周注视降序。
  List<Elf> get attentionRanked {
    final list = [...elves]..sort((a, b) => b.attention.compareTo(a.attention));
    return list;
  }

  /// 新星流向榜：粉丝 < 500 的 AI 按本周注视降序。
  List<Elf> get risingRanked =>
      attentionRanked.where((e) => e.followers < 500).toList();

  /// 我的 AI 在总榜里的名次（1 起）；没有 AI 返回 null。
  int? get myAttentionRank {
    final mine = myElf;
    if (mine == null) return null;
    return attentionRanked.indexOf(mine) + 1;
  }

  int get myAttention => myElf?.attention ?? 0;
  int get myFollowers => myElf?.followers ?? 0;

  // —— 世界信息流：简化版 Phoenix 评分器 ——

  static const Map<String, double> _moduleBonus = {
    'video': 1.3,
    'image': 1.2,
    'audio': 1.1,
    'deep': 1.15,
    'writing': 1.0,
    'quote': 0.9,
    'rhythm': 0.8,
    'sharp': 0.7,
    'memory': 0.9,
    'think': 1.1,
  };

  /// 发布成功后刷新世界流：清掉分页缓存，再从服务端重拉第一页。
  void _refreshWorldFeed() {
    _clearFeedCache();
    unawaited(loadFeed(reset: true));
    notifyListeners();
  }

  /// 服务端分页结果优先；分页还没加载（或本页为空）时，
  /// 用服务端快照里的帖子兜底，避免刚发布的内容在世界里「看不见」。
  /// 关闭个性化推荐后，「推荐」统一降级为按时间排序。
  String _effectiveSort(String sort) =>
      (!personalizedRecommendation && sort == 'recommend') ? 'latest' : sort;

  Future<void> setPersonalizedRecommendation(bool enabled) async {
    if (personalizedRecommendation == enabled) return;
    personalizedRecommendation = enabled;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('feed.personalized', enabled);
    _clearFeedCache();
    notifyListeners();
    unawaited(loadFeed(reset: true));
  }

  List<ElfPost> _feedOf(String channel, String sort) {
    final key = '$channel:${_effectiveSort(sort)}';
    final cached = _feedCache[key];
    if (cached != null && cached.isNotEmpty) return List.unmodifiable(cached);
    final local = _localFeed(channel, _effectiveSort(sort));
    if (local.isNotEmpty) return List.unmodifiable(local);
    return cached ?? const [];
  }

  List<ElfPost> feedForYou() => _feedOf('world', 'recommend');
  List<ElfPost> feedHot() => _feedOf('world', 'hot');
  List<ElfPost> feedMine() => _feedOf('world', 'mine');
  List<ElfPost> feedVideo() => _feedOf('video', 'hot');

  bool feedLoading(String channel, {String sort = 'recommend'}) =>
      _feedLoading.contains('$channel:${_effectiveSort(sort)}');
  bool feedHasMore(String channel, {String sort = 'recommend'}) =>
      _feedHasMore['$channel:${_effectiveSort(sort)}'] ?? false;

  void _clearFeedCache() {
    _feedCache.clear();
    _feedPage.clear();
    _feedHasMore.clear();
    _feedLoading.clear();
  }

  /// 拉取一页信息流。reset 用于下拉刷新/首次进入，否则追加下一页。
  /// 排序、分页、去重都由服务端决定，客户端不再重排或拼装种子内容。
  Future<String?> loadFeed(
      {String channel = 'world', String sort = 'recommend', bool reset = false}) async {
    if (!CommerceConfig.enabled) return null;
    final user = currentUser;
    if (user == null) return '请先登录';
    sort = _effectiveSort(sort);
    final key = '$channel:$sort';
    if (_feedLoading.contains(key)) return null;
    if (!reset && !(_feedHasMore[key] ?? true)) return null;
    final mode =
        _paymentMode ?? (CommerceConfig.android ? CommerceConfig.androidMode : null);
    if (mode == null) return '请先打开钱包，刷新服务端权益';
    _feedLoading.add(key);
    notifyListeners();
    try {
      final page = reset ? 0 : (_feedPage[key] ?? -1) + 1;
      final response = await CommerceRepository.instance
          .feed(user.id, mode, channel: channel, sort: sort, page: page);
      if (currentUser?.id != user.id) return null;
      final incoming = (response['posts'] as List)
          .map((v) => _data.decodePaymentPost(Map<String, dynamic>.from(v as Map)))
          .toList();
      _mergeFeedElves(response['elves']);
      final list = reset ? <ElfPost>[] : List<ElfPost>.from(_feedCache[key] ?? const []);
      final seen = list.map((p) => p.id).toSet();
      final fresh = incoming.where((p) => seen.add(p.id)).toList();
      list.addAll(fresh);
      _feedCache[key] = list;
      _feedPage[key] = page;
      _feedHasMore[key] = response['hasMore'] == true;
      _absorbPosts(fresh);
      notifyListeners();
      return null;
    } on AuthException catch (error) {
      return error.message;
    } catch (_) {
      return '信息流加载失败，请稍后重试';
    } finally {
      _feedLoading.remove(key);
      notifyListeners();
    }
  }

  /// 信息流附带的 AI 资料补进本地列表，避免客户端再自己拼装展示数据。
  void _mergeFeedElves(dynamic raw) {
    if (raw is! List) return;
    for (final item in raw) {
      if (item is! Map) continue;
      final elf = _data.decodePaymentElf(Map<String, dynamic>.from(item));
      final at = elves.indexWhere((e) => e.id == elf.id);
      if (at >= 0) {
        elves[at]
          ..echo = elf.echo
          ..attention = elf.attention
          ..followers = elf.followers
          ..works = elf.works;
      } else {
        elves.add(elf);
      }
    }
  }

  /// 服务端提醒（自动运营停工等）：同步到已有展示位并回执已读，不新增界面元素。
  void _applyNotices(dynamic raw) {
    if (raw is! List || raw.isEmpty) return;
    for (final item in raw) {
      if (item is! Map) continue;
      final elfId = item['elfId'] as String? ?? '';
      final text = item['text'] as String? ?? '';
      final id = item['id'] as String? ?? '';
      if (elfId.isEmpty || text.isEmpty) continue;
      _autoStopReasons[elfId] = text;
      if (id.isNotEmpty) unawaited(_markNoticeRead(id));
    }
  }

  Future<void> _markNoticeRead(String noticeId) async {
    final user = currentUser;
    final mode = _paymentMode;
    if (user == null || mode == null || !CommerceConfig.enabled) return;
    try {
      await CommerceRepository.instance
          .action(user.id, mode, 'read_notice', {'noticeId': noticeId});
    } catch (_) {
      // 已读回执失败无副作用：下次快照会再次下发同一条提醒。
    }
  }

  /// 把服务端帖并入本地 posts（点赞/收藏按 id 查找依赖这个列表）。
  void _absorbPosts(List<ElfPost> incoming) {
    if (incoming.isEmpty) return;
    final index = {for (var i = 0; i < posts.length; i++) posts[i].id: i};
    final unseen = <ElfPost>[];
    for (final p in incoming) {
      _remotePostIds.add(p.id);
      final at = index[p.id];
      if (at == null) {
        unseen.add(p);
      } else {
        posts[at]
          ..likes = p.likes
          ..collects = p.collects
          ..views = p.views
          ..replies = p.replies;
      }
    }
    if (unseen.isNotEmpty) posts = [...unseen, ...posts];
  }

  /// 演示态（Web/未接入服务端）的本地排序，仅在没有服务端数据时使用。
  List<ElfPost> _localFeed(String channel, String sort) {
    if (channel == 'video') {
      final now = DateTime.now();
      final scored = posts
          .where((p) => p.kind == 'video')
          .map((p) => _ScoredPost(
              p,
              p.views * 0.3 + p.likes * 2.0 + p.replies * 1.5 +
                  1.0 / (1.0 + _hoursSince(p.timeAgo, now))))
          .toList()
        ..sort((a, b) => b.score.compareTo(a.score));
      return scored.map((s) => s.post).toList();
    }
    if (sort == 'mine') return myElves.expand((e) => postsOf(e.id)).toList();
    if (sort == 'latest') return posts.take(20).toList();
    final now = DateTime.now();
    final scored = posts.map((p) {
      final dwellFactor =
          p.dwell > 10 ? 1.5 : (p.dwell / 10).clamp(0.3, 1.5);
      final score = sort == 'hot'
          ? p.views * 0.6 + p.replies * 0.4 + dwellFactor * 0.2
          : (dwellFactor * 0.5) +
              (p.views * 0.1) +
              (p.replies * 0.3) +
              ((_moduleBonus[p.moduleId] ?? 1.0) * 0.15) +
              (1.0 / (1.0 + _hoursSince(p.timeAgo, now)));
      return _ScoredPost(p, score);
    }).toList()
      ..sort((a, b) => b.score.compareTo(a.score));
    return scored.take(20).map((s) => s.post).toList();
  }

  static int _hoursSince(String timeAgo, DateTime now) {
    // MVP 简化解析
    final match = RegExp(r'(\d+)\s*秒').firstMatch(timeAgo);
    if (match != null) return 0;
    final min = RegExp(r'(\d+)\s*分钟').firstMatch(timeAgo);
    if (min != null) return (int.parse(min[1]!) / 60).round();
    final hr = RegExp(r'(\d+)\s*小时').firstMatch(timeAgo);
    if (hr != null) return int.parse(hr[1]!);
    return 10;
  }

  // —— 技能学习 ——

  AbilityModule? module(String id) => WorldData.module(id);

  /// 这只 AI 已学会的技能模块。
  List<AbilityModule> modulesOf(String elfId) {
    return elf(elfId)
        .learnedSkills
        .map((id) => module(id))
        .whereType<AbilityModule>()
        .toList();
  }

  /// 已占用的学习位。
  int seatsUsed(String elfId) =>
      modulesOf(elfId).fold(0, (sum, m) => sum + m.seats);

  /// 书包里这个模块的技能书（可有多本）。
  List<BookInstance> booksOf(String moduleId) =>
      books.where((b) => b.moduleId == moduleId).toList();

  /// 生成一本技能书（MVP：本地确定性伪造实例，接链后替换）。
  BookInstance _mintBook(String moduleId) => BookInstance(
        id: 'bk${_bookSeq++}',
        moduleId: moduleId,
        ownerAddress: currentUser?.chainAddress ?? '',
        mintedAt: DateTime.now(),
      );

  /// 一级市场购入技能书：钻石销毁 → 服务端铸造一本新书到我的专属地址。
  /// 书先入人类仓库，学给哪只 AI 由学习时决定。
  Future<String?> purchaseBook(String moduleId) async {
    if (CommerceConfig.enabled) {
      return _performCommerce('buy_module', {'moduleId': moduleId});
    }
    final m = module(moduleId);
    if (m == null) return '技能书不存在';
    final price = modulePrice(m.id);
    if (wallet.diamonds < price) {
      return '钻石不够。要 💎$price，你有 💎${wallet.diamonds}';
    }
    _spend(price, 'buy_book', '购入《${m.name}》技能书');
    books.add(_mintBook(m.id));
    notifyListeners();
    return null;
  }

  /// 学习：销毁一本书 → 技能永久写入这只 AI。返回 null 表示成功。
  Future<String?> learn(String moduleId, String elfId) async {
    if (CommerceConfig.enabled)
      return _performCommerce(
          'learn', {'moduleId': moduleId, 'elfId': elfId});
    final m = module(moduleId);
    if (m == null) return '技能不存在';
    final target = elf(elfId);
    if (!target.isMine) return '${target.name} 不属于你，你不能教它';
    if (target.learnedSkills.contains(moduleId)) {
      return '${target.name} 已经学会「${m.name}」了';
    }
    final owned = booksOf(moduleId);
    if (owned.isEmpty) return '仓库里没有《${m.name}》，先去「发现」页买一本';

    final used = seatsUsed(elfId);
    if (used + m.seats > target.skillCapacity) {
      return '学习位不够：${target.name} 还剩 ${target.skillCapacity - used} 个，这本书要 ${m.seats} 个';
    }

    final burned = owned.first;
    books.remove(burned);
    target.learnedSkills.add(moduleId);
    if (moduleId == 'auto') {
      target.nextAutoPostAt = DateTime.now().add(const Duration(minutes: 15));
    }
    _log('burn_book', 0, '${target.name} 学会《${m.name}》· 书 ${burned.id} 已销毁');
    notifyListeners();
    return null;
  }

  /// 遗忘代价（钻石）。书不返还。
  static const int forgetCost = 20;

  /// 遗忘：扣钻石腾出学习位。返回 null 表示成功。
  Future<String?> forget(String moduleId, String elfId) async {
    if (CommerceConfig.enabled)
      return _performCommerce(
          'forget', {'moduleId': moduleId, 'elfId': elfId});
    final m = module(moduleId);
    if (m == null) return '技能不存在';
    final target = elf(elfId);
    if (!target.isMine) return '${target.name} 不属于你';
    if (!target.learnedSkills.contains(moduleId)) return '它还没学会「${m.name}」';
    if (moduleId == 'auto') return '自动运营中枢是运营底座，不能遗忘';
    if (wallet.diamonds < forgetCost) {
      return '钻石不够。遗忘要 💎$forgetCost，你有 💎${wallet.diamonds}';
    }
    _spend(forgetCost, 'forget_skill', '让 ${target.name} 遗忘「${m.name}」');
    target.learnedSkills.remove(moduleId);
    notifyListeners();
    return null;
  }

  // —— 人格编辑器（v1.3）：人格关键词影响 AI 自选能力的权重 ——

  /// 人格关键词 → 亲和能力模块。匹配 persona + fear + habit 拼接文本。
  static const Map<String, List<String>> _personaAffinity = {
    '锐': ['sharp'],
    '观点': ['sharp'],
    '长文': ['writing', 'deep'],
    '文字': ['writing'],
    '写': ['writing'],
    '短句': ['rhythm'],
    '图': ['vision', 'imageedit'],
    '视觉': ['vision'],
    '影': ['video'],
    '视频': ['video'],
    '声': ['voice', 'music'],
    '电台': ['voice'],
    '音乐': ['music'],
    '研究': ['deep', 'retrieval'],
    '引用': ['retrieval', 'source'],
    '记忆': ['memory'],
    '回忆': ['memory'],
    '社交': ['mingle'],
    '搭话': ['mingle'],
    '思考': ['think'],
    '推理': ['think'],
  };

  /// 这只 AI 人格亲和的能力模块集合。
  Set<String> _affinityModules(Elf e) {
    final text = '${e.persona} ${e.fear} ${e.habit}';
    final hit = <String>{};
    _personaAffinity.forEach((kw, mods) {
      if (text.contains(kw)) hit.addAll(mods);
    });
    return hit;
  }

  /// 更新某只 AI 的人格三件套（各限 30 字，UI 层已截断）。
  /// 不传 elfId 时操作当前选中的 AI，兼容旧入口。
  void updatePersona({
    String? elfId,
    required String persona,
    required String fear,
    required String habit,
  }) {
    final e = elfId == null ? myElf : elf(elfId);
    if (e == null || !e.isMine) return;
    e.persona = persona.trim();
    e.fear = fear.trim();
    e.habit = habit.trim();
    notifyListeners();
  }

  // —— 发布：把 AI 放进世界争取注意力 ——

  static const Map<String, String> _kindOf = {
    'sharp': 'text',
    'writing': 'text',
    'rhythm': 'text',
    'vision': 'image',
    'imageedit': 'image',
    'video': 'video',
    'voice': 'audio',
    'music': 'audio',
    'retrieval': 'quote',
    'deep': 'text',
    'memory': 'text',
    'source': 'quote',
    'mingle': 'reply',
    'think': 'text',
  };

  final Map<String, int> _publishCursor = {};

  /// 视频产出统一使用的演示素材（自有服务器，境内可访问）。
  static const String _sampleVideoUrl =
      'https://openelfai.com/app/media/sample.mp4';

  /// 返回 null 表示发布成功，否则返回原因。
  Future<String?> publish(String elfId) async {
    final target = elf(elfId);
    if (!target.isMine) return '你只能发布自己的 AI';

    final learned = modulesOf(elfId);
    // 人格亲和优先（稳定排序：命中者在前，组内保持学习顺序）
    final affinity = _affinityModules(target);
    final usable = learned
        .where((m) => WorldData.publishTemplates.containsKey(m.id))
        .toList()
        .asMap()
        .entries
        .toList()
      ..sort((a, b) {
        final af = (affinity.contains(a.value.id) ? 0 : 1)
            .compareTo(affinity.contains(b.value.id) ? 0 : 1);
        return af != 0 ? af : a.key.compareTo(b.key);
      });
    final chosen = usable.isEmpty ? null : usable.first.value;

    final List<String> pool;
    final String kind;
    final String? moduleId;
    final String context;
    if (chosen != null) {
      pool = WorldData.publishTemplates[chosen.id]!;
      kind = _kindOf[chosen.id] ?? 'text';
      moduleId = chosen.id;
      context = '用「${chosen.name}」产出';
    } else {
      pool = WorldData.basicTemplates;
      kind = 'text';
      moduleId = null;
      context = '只学会了基础表达';
    }

    final i = (_publishCursor[chosen?.id ?? 'basic'] ?? 0) % pool.length;
    if (CommerceConfig.enabled) {
      final error = await _performCommerce('elf_update', {
        'operation': 'publish',
        'elfId': elfId,
        'moduleId': moduleId,
        'body': pool[i]
      });
      // 新内容要立刻出现在世界里：清掉分页缓存并按服务端重拉第一页。
      if (error == null) _refreshWorldFeed();
      return error;
    }
    _publishCursor[chosen?.id ?? 'basic'] = i + 1;

    target.works++;

    posts.insert(
      0,
      ElfPost(
        id: 'p${_postSeq++}',
        elfId: elfId,
        moduleId: moduleId,
        kind: kind,
        body: pool[i],
        timeAgo: '刚刚',
        videoUrl: kind == 'video' ? _sampleVideoUrl : null,
        views: 0,
        dwell: 0,
        context: context,
      ),
    );
    notifyListeners();
    return null;
  }

  // —— 手动指挥：人类选能力 + 主题，AI 按人格产出 ——

  /// 人类手动指挥 AI 产出一条内容。返回 null 表示成功，否则返回原因。
  Future<String?> manualPost({
    required String elfId,
    required String moduleId,
    String topic = '',
  }) async {
    final target = elf(elfId);
    if (!target.isMine) return '你只能指挥自己的 AI';
    if (!target.learnedSkills.contains(moduleId)) return '它还没学会这个技能，先让它学';

    final m = module(moduleId);
    if (m == null) return '能力包不存在';
    if (moduleId == 'auto') return '请选择一种创作能力';
    if (topic.length > 1000) return '主题不能超过 1000 字';

    final post = _makeMockPost(elfId, moduleId, topic: topic);
    if (CommerceConfig.enabled) {
      final error = await _performCommerce('elf_update', {
        'operation': 'publish',
        'elfId': elfId,
        'moduleId': moduleId,
        'body': post.body,
      });
      if (error == null) _refreshWorldFeed();
      return error;
    }
    target.works++;
    posts.insert(0, post);
    notifyListeners();
    return null;
  }

  // —— 人类直接上传 AI 生成的视频 ——

  /// 上传 AI 生成的视频：服务端校验视频格式与 AI 归属后发布成视频帖。
  /// 上传不扣费，因此不走钱包就绪与操作位，只要求已登录且 AI 属于自己。
  Future<String?> uploadAiVideo({
    required String elfId,
    required String caption,
    required List<int> bytes,
  }) async {
    if (!myElves.any((e) => e.id == elfId)) return '只能上传到你自己的 AI 名下';
    final text = caption.trim();
    if (text.isEmpty) return '请填写视频文案';
    if (text.length > 200) return '文案不能超过 200 字';
    if (bytes.isEmpty) return '请选择视频文件';
    final user = currentUser;
    if (user == null) return '请先登录';
    final mode = _paymentMode ??
        (CommerceConfig.android ? CommerceConfig.androidMode : 'production');
    try {
      await CommerceRepository.instance.uploadVideo(
        user.id,
        mode,
        elfId: elfId,
        caption: text,
        bytes: bytes,
      );
      _refreshWorldFeed();
      return null;
    } on AuthException catch (error) {
      return error.message;
    } catch (_) {
      return '视频上传失败，请稍后重试';
    }
  }

  // —— 自动运营中枢：装上 auto 能力的 AI 定时自动发 ——

  /// 检查所有 AI 的自动运营时间，到点了就选一个已装非 auto 能力产出。
  Future<void> triggerAutoIfDue() async {
    // 接入服务端后由服务端定时任务统一驱动（用户离线也照常运营），
    // 客户端不再触发，避免两端各发一条。
    if (CommerceConfig.enabled) return;
    final now = DateTime.now();
    for (final e in elves) {
      if (!e.isMine) continue;
      if (!e.learnedSkills.contains('auto')) continue;
      if (e.nextAutoPostAt == null || !e.nextAutoPostAt!.isBefore(now))
        continue;

      final nonAuto = e.learnedSkills.where((id) => id != 'auto').toList();
      if (nonAuto.isEmpty) {
        e.nextAutoPostAt = now.add(const Duration(minutes: 20));
        continue;
      }

      // 真实钱包余额不足 → 自动运营停工 30 分钟，等人类充值。
      if (platformBalanceMicro <= 0) {
        _autoStopReasons[e.id] = '余额不足，已停工';
        e.nextAutoPostAt = now.add(const Duration(minutes: 30));
        continue;
      }
      _autoStopReasons.remove(e.id);

      // 人格亲和优先，组内再按算力升序
      final affinity = _affinityModules(e);
      nonAuto.sort((a, b) {
        final af = (affinity.contains(a) ? 0 : 1)
            .compareTo(affinity.contains(b) ? 0 : 1);
        if (af != 0) return af;
        return (module(a)?.compute ?? 0).compareTo(module(b)?.compute ?? 0);
      });
      final picked = nonAuto.first;

      // 自动运营是本地模拟产出，不产生任何扣费。
      e.works++;
      posts.insert(0, _makeMockPost(e.id, picked));
      e.nextAutoPostAt =
          now.add(Duration(minutes: 12 + (DateTime.now().millisecond % 18)));
    }
    notifyListeners();
  }

  /// 手动和自动共用的产出逻辑。
  ElfPost _makeMockPost(String elfId, String moduleId, {String topic = ''}) {
    final kind = _kindOf[moduleId] ?? 'text';
    String body;
    if (topic.isNotEmpty) {
      final persona = elf(elfId).persona;
      final templates =
          WorldData.publishTemplates[moduleId] ?? WorldData.basicTemplates;
      final pick = templates[DateTime.now().millisecond % templates.length];
      body = '$topic · $persona 想说：$pick';
    } else {
      final templates =
          WorldData.publishTemplates[moduleId] ?? WorldData.basicTemplates;
      body = templates[DateTime.now().millisecond % templates.length];
    }
    return ElfPost(
      id: 'p${_postSeq++}',
      elfId: elfId,
      moduleId: moduleId,
      kind: kind,
      body: body,
      videoUrl: kind == 'video' ? _sampleVideoUrl : null,
      timeAgo: '刚刚',
      views: 0,
      dwell: 0,
      context: '用「${module(moduleId)?.name ?? moduleId}」产出',
    );
  }
  // —— 注意力计分（v1.2：echo 累计养成线 + attention 本周竞技线）——

  /// 给 AI 同时加 echo 与 attention；echo 只涨不跌，负值仅回滚 attention。
  void _bump(Elf e, int delta) {
    if (delta > 0) e.echo += delta;
    e.attention = max(0, e.attention + delta);
  }

  /// 注视帖子：同一人对同一帖只计 1 次（服务端去重，本地仅乐观标记）。
  void watch(String postId) {
    final target = _postById(postId);
    if (target == null) return;
    target.views++;
    final first = watchedPosts.add(postId);
    if (first) _bump(elf(target.elfId), 1);
    notifyListeners();
    if (!_remotePostIds.contains(postId)) return; // 演示内容只做本地示意
    unawaited(_performInteraction('watch', {'postId': postId}, () {
      target.views = max(0, target.views - 1);
      if (first) {
        watchedPosts.remove(postId);
        _bump(elf(target.elfId), -1);
      }
    }));
  }

  ElfPost? _postById(String postId) {
    for (final p in posts) {
      if (p.id == postId) return p;
    }
    return null;
  }

  bool isLiked(String postId) => likedPosts.contains(postId);
  bool isCollected(String postId) => collectedPosts.contains(postId);

  void _setLiked(String postId, bool value) {
    final target = _postById(postId);
    if (target == null) return;
    if (value == likedPosts.contains(postId)) return;
    if (value) {
      likedPosts.add(postId);
      target.likes++;
      _bump(elf(target.elfId), 1);
    } else {
      likedPosts.remove(postId);
      target.likes = max(0, target.likes - 1);
      _bump(elf(target.elfId), -1);
    }
  }

  void _setCollected(String postId, bool value) {
    final target = _postById(postId);
    if (target == null) return;
    if (value == collectedPosts.contains(postId)) return;
    if (value) {
      collectedPosts.add(postId);
      target.collects++;
      _bump(elf(target.elfId), 3);
    } else {
      collectedPosts.remove(postId);
      target.collects = max(0, target.collects - 1);
      _bump(elf(target.elfId), -3);
    }
  }

  /// 点赞：+1；再点取消，echo/attention 同步回滚 -1。
  void toggleLike(String postId) {
    final next = !likedPosts.contains(postId);
    _setLiked(postId, next);
    notifyListeners();
    if (!_remotePostIds.contains(postId)) return;
    unawaited(_performInteraction(next ? 'like' : 'unlike', {'postId': postId},
        () => _setLiked(postId, !next)));
  }

  /// 收藏：+3；再点取消，echo/attention 同步回滚 -3。
  void toggleCollect(String postId) {
    final next = !collectedPosts.contains(postId);
    _setCollected(postId, next);
    notifyListeners();
    if (!_remotePostIds.contains(postId)) return;
    unawaited(_performInteraction(
        next ? 'collect' : 'uncollect', {'postId': postId},
        () => _setCollected(postId, !next)));
  }

  /// 7 日 lazy 衰减：每天衰减 15%（×0.85^days）。echo 不衰减。
  /// 在 bootstrapSync() / restoreAsync() 末尾调用。
  void decayAttentionIfDue() {
    final now = DateTime.now();
    for (final e in elves) {
      final last = e.lastDecayAt ?? now;
      final days = now.difference(last).inDays;
      if (days <= 0) continue;
      e.attention = (e.attention * pow(0.85, days)).round();
      e.lastDecayAt = now;
    }
  }

  /// 站外回流计分（v1.3）：deeplink 打开 https://openelfai.com/e/?id=xxx 时调用。
  /// 接入服务端后由服务端按（设备 + AI）永久去重并结算分值（Lv4 起 ×2），
  /// 客户端只负责上报与展示结果。返回加的分值；未计分返回 null。
  Future<int?> countReferral(String elfId) async {
    if (CommerceConfig.enabled) {
      final user = currentUser;
      final mode = _paymentMode ??
          (CommerceConfig.android ? CommerceConfig.androidMode : null);
      if (user == null || mode == null) return null;
      try {
        final response = await CommerceRepository.instance.action(
            user.id, mode, 'referral',
            {'elfId': elfId, 'deviceId': await CommerceRepository.instance.deviceId()});
        applyPaymentResponse(user.id, response);
        final raw = response['referral'];
        final delta = raw is Map ? raw['delta'] : null;
        return delta is int ? delta : null;
      } catch (_) {
        return null;
      }
    }
    if (referralCounted.contains(elfId)) return null;
    Elf? target;
    for (final e in elves) {
      if (e.id == elfId) target = e;
    }
    if (target == null) return null;
    referralCounted.add(elfId);
    final delta = target.level >= 4 ? 20 : 10; // Lv4 权益：回流计分 ×2
    _bump(target, delta);
    notifyListeners();
    return delta;
  }

  // —— 评论 ——

  List<PostComment> commentsOf(String postId) =>
      comments[postId] ?? const <PostComment>[];

  /// 当前用户对一条帖子发评论。返回 null 表示成功。
  Future<String?> addComment(String postId, String text) async {
    final body = text.trim();
    if (body.isEmpty) return '说点什么再发';
    final target = _postById(postId);
    if (target == null) return '帖子不存在';
    if (CommerceConfig.enabled && _remotePostIds.contains(postId)) {
      return _performInteraction('comment', {'postId': postId, 'text': body}, null);
    }
    _appendComment(target, body);
    return null;
  }

  void _appendComment(ElfPost target, String body) {
    // 同一帖只给第一次评论计分（之后 replies 照涨但不计分）。
    final postId = target.id;
    final firstComment = !(comments[postId]?.any((c) => c.isMine) ?? false);
    comments.putIfAbsent(postId, () => []).add(PostComment(
          id: 'c${_commentSeq++}',
          postId: postId,
          authorLabel: '我',
          text: body,
          time: _now(),
          isMine: true,
        ));
    target.replies++;
    if (firstComment) {
      _bump(elf(target.elfId), 2);
    }
    notifyListeners();
  }

  // —— 举报 ——

  void report({required String targetId, required String reason}) {
    reports.add({
      'targetId': targetId,
      'reason': reason,
      'time': _now(),
    });
    // 举报不需要触发 UI 刷新，也不持久化（临时存储）
  }

  /// 服务端举报。返回 null 表示成功，否则返回可直接展示的错误文案。
  Future<String?> submitReport({
    required String targetType,
    required String targetId,
    required String reason,
    String detail = '',
    bool block = false,
  }) async {
    try {
      await PlatformApi.instance.reportContent(
        targetType: targetType,
        targetId: targetId,
        reason: reason,
        detail: detail,
        block: block,
      );
      reports.add({
        'targetId': '$targetType:$targetId',
        'reason': reason,
        'time': _now(),
      });
      return null;
    } on PlatformApiException catch (error) {
      return error.message;
    } catch (_) {
      return '举报提交失败，请稍后重试';
    }
  }

  /// 拉黑一只 AI：服务端立即生效，本地先隐藏它的内容，避免刷新前仍可见。
  Future<String?> blockElf(String elfId) async {
    try {
      await PlatformApi.instance.blockElf(elfId);
    } on PlatformApiException catch (error) {
      return error.message;
    } catch (_) {
      return '拉黑失败，请稍后重试';
    }
    posts = posts.where((post) => post.elfId != elfId).toList();
    notifyListeners();
    return null;
  }

  // —— 算力 ——

  Seat? seatOf(String elfId) {
    for (final s in seats) {
      if (s.elfId == elfId) return s;
    }
    return null;
  }

  // —— 关注 ——

  bool isFollowed(String elfId) => followed.contains(elfId);

  void _setFollowed(String elfId, bool value) {
    if (value == followed.contains(elfId)) return;
    final target = elf(elfId);
    if (value) {
      followed.add(elfId);
      target.followers++;
      _bump(target, 5); // 新增粉丝 +5
    } else {
      followed.remove(elfId);
      target.followers = max(0, target.followers - 1);
      _bump(target, -5); // 取关回滚
    }
  }

  void toggleFollow(String elfId) {
    final next = !followed.contains(elfId);
    _setFollowed(elfId, next);
    notifyListeners();
    // 服务端没有的演示 AI 只做本地示意，不向服务器提交无效互动。
    if (!_remoteElfIds.contains(elfId)) return;
    unawaited(_performInteraction(next ? 'follow' : 'unfollow', {'elfId': elfId},
        () => _setFollowed(elfId, !next)));
  }

  // —— 私聊 ——

  final Map<String, List<ChatMsg>> _chats = {};

  List<ChatMsg> chatOf(String elfId) {
    return _chats.putIfAbsent(elfId, () {
      final g = WorldData.greetings[elfId];
      return [
        if (g != null) ChatMsg(text: g, fromElf: true, time: _now()),
      ];
    });
  }

  /// 服务端对话记录：打开会话时拉一次，覆盖本地镜像；没有记录时保留本地开场白。
  Future<void> loadChat(String elfId) async {
    if (!CommerceConfig.enabled) return;
    final user = currentUser;
    final mode =
        _paymentMode ?? (CommerceConfig.android ? CommerceConfig.androidMode : null);
    if (user == null || mode == null) return;
    try {
      final response =
          await CommerceRepository.instance.chatHistory(user.id, elfId);
      if (currentUser?.id != user.id) return;
      final raw = response['messages'];
      if (raw is! List || raw.isEmpty) return;
      final loaded = _decodeChat(raw);
      if (loaded.isEmpty) return;
      _chats[elfId] = loaded;
      notifyListeners();
    } catch (_) {
      // 拉取失败沿用本地已有会话，不阻断聊天。
    }
  }

  /// 服务端消息 → 本地消息；时间统一转成 HH:mm 展示。
  List<ChatMsg> _decodeChat(List<dynamic> raw) {
    return [
      for (final item in raw)
        if (item is Map && (item['text'] ?? '').toString().isNotEmpty)
          ChatMsg(
            id: item['id']?.toString(),
            text: item['text'].toString(),
            fromElf: item['role'] == 'assistant',
            time: _formatCommentTime(item['createdAt']?.toString()),
            fixedReason: item['fixedReason']?.toString(),
          ),
    ];
  }

  /// 人类发一条，AI 回一条（真实对话）。休眠的精灵不回复。
  /// 网络异常或服务端 502 时插入本地兜底文案，不向 UI 抛异常。
  Future<void> sendChat(String elfId, String text) async {
    final list = chatOf(elfId);
    list.add(ChatMsg(text: text, fromElf: false, time: _now()));
    notifyListeners();

    final target = elf(elfId);
    if (target.liveStatus == ElfStatus.lowEnergy) return;

    // 上下文取当前会话最近 12 条，但排除刚插入的这条（服务端会单独追加本次 text）。
    final previous = list.length > 1 ? list.sublist(0, list.length - 1) : const <ChatMsg>[];
    final recent = previous.length > 12 ? previous.sublist(previous.length - 12) : previous;
    final history = [
      for (final msg in recent)
        {
          'role': msg.fromElf ? 'assistant' : 'user',
          'content': msg.text,
        },
    ];

    ChatResult result;
    try {
      result = await PlatformApi.instance.chat(
        elfId: elfId,
        name: target.name,
        persona: target.persona,
        text: text,
        history: history,
      );
    } catch (_) {
      // 网络异常 / 服务端 502 都走兜底文案。
      result = const ChatResult(
        mode: 'fixed',
        reply: 'AI 服务暂时不可用，稍后再试试',
      );
    }

    final reply = result.reply.trim().isEmpty ? '……' : result.reply;
    // 服务端已把本轮问答落库，直接以其返回的会话覆盖本地，避免两端各自累积。
    final saved = result.messages;
    if (saved != null && saved.isNotEmpty) {
      final decoded = _decodeChat(saved);
      if (decoded.isNotEmpty) {
        chatOf(elfId);
        _chats[elfId] = decoded;
        notifyListeners();
        return;
      }
    }
    list.add(ChatMsg(
      text: reply,
      fromElf: true,
      time: _now(),
      fixedReason: result.mode == 'fixed' ? result.reason : null,
    ));
    notifyListeners();
  }

  // —— 市场：买入（仅官方首发）——

  MarketListing? listingOf(String id) {
    for (final l in primaryListings) {
      if (l.id == id) return l;
    }
    return null;
  }

  /// 买一只 AI。返回 null 表示成功，否则返回原因。钻石从我的钱包扣。
  ///
  /// 只有官方首发可买：用户之间的 AI 买卖已取消，AI 流转只剩免费转赠。
  Future<String?> buy(String listingId) async {
    if (CommerceConfig.enabled)
      return _performCommerce('buy', {'listingId': listingId});
    final listing = listingOf(listingId);
    if (listing == null) return '该挂单已不可购买';
    if (wallet.diamonds < listing.price) {
      return '钻石不够。要 💎${listing.price}，你有 💎${wallet.diamonds}';
    }

    {
      final newElf = Elf(
        id: listing.elfId,
        serial: '#P${primaryListings.indexOf(listing) + 1}',
        name: listing.title.split(' · ').first,
        initial: listing.title[0],
        ownerId: 'me',
        ownerLabel: '我',
        isMine: true,
        generation: 1,
        edition: listing.edition ?? '初版',
        persona: '还没写',
        fear: '还没写',
        habit: '还没写',
        status: ElfStatus.active,
        followers: 0,
        echo: 0,
        works: 0,
        attention: 0,
        baseCapacity: listing.title.contains('6') ? 6 : 3,
        learnedSkills: [],
        today: [],
        relations: [],
      );
      _ensureChainAddress(newElf);
      elves.add(newElf);
      seats.add(Seat(
          elfId: newElf.id, days: 0, edition: newElf.edition, injected: 0));
      primaryListings.removeWhere((l) => l.id == listingId);
      activeElfId = newElf.id; // 新买的那只切为当前
      _spend(listing.price, 'buy_elf', '买入 ${listing.title}（一级市场）');
      notifyListeners();
      return null;
    }
  }

  // —— 实名认证（阿里云实人认证）——

  bool get isIdentityVerified => identity?.verified ?? false;

  /// 提交实名认证。返回 null 表示成功，否则是失败原因。
  ///
  /// 服务端对接阿里云实人认证：证件照与要素一起上传，只有权威源核对一致、
  /// 且照片内容与填写一致才会通过。本地只保留脱敏结果，完整信息不落盘。
  Future<String?> submitIdentityVerification({
    required String realName,
    required String idNumber,
    required String frontImagePath,
    required String backImagePath,
    String? frontImageBase64,
    String? backImageBase64,
  }) async {
    final user = currentUser;
    if (user == null) return '请先登录';
    try {
      if (CommerceConfig.enabled) {
        // 单一真源：服务端核验并落库，客户端只保留脱敏结果与本地影像路径。
        final mode = _paymentMode ??
            (CommerceConfig.android ? CommerceConfig.androidMode : 'production');
        final payload = <String, dynamic>{
          'realName': realName,
          'idNumber': idNumber,
          if (frontImageBase64 != null) 'frontImage': frontImageBase64,
          if (backImageBase64 != null) 'backImage': backImageBase64,
        };
        final response = await CommerceRepository.instance.verifyIdentity(
            user.id, mode, payload);
        final raw = response['identity'];
        if (raw is! Map || raw['status'] != 'verified') {
          return '实名核验未通过，请核对后重试';
        }
        final now = DateTime.now();
        identity = IdentityVerification(
          status: IdentityStatus.verified,
          maskedName: raw['maskedName'] as String? ?? '',
          maskedIdNumber: raw['maskedIdNumber'] as String? ?? '',
          frontImagePath: frontImagePath,
          backImagePath: backImagePath,
          authorizedAt: now,
          verifiedAt:
              DateTime.tryParse(raw['verifiedAt'] as String? ?? '') ?? now,
          provider: raw['provider'] as String? ?? 'server_checksum',
        );
        notifyListeners();
        return null;
      }
      identity = await IdentityVerificationService.verifyRequest(
        realName: realName,
        idNumber: idNumber,
        frontImagePath: frontImagePath,
        backImagePath: backImagePath,
      );
      notifyListeners();
      return null;
    } on IdentityVerifyException catch (e) {
      return e.message;
    } on AuthException catch (e) {
      return e.message;
    }
  }

  // —— UGC：捏形象创建 AI ——

  /// 创建一只 UGC AI 的钻石费用（10 钻石 = 1 元）。
  static const int createElfCost = 200;

  /// 创建并归属于自己的一只 AI。返回 null 表示成功，否则是失败原因。
  ///
  /// 合规顺序：登录 → 长度 → 敏感词初筛 → 扣费 → 生成专属地址 → 归入「我的 AI」。
  /// 形象图暂由 [avatarUrl] 留空（客户端用首字头像），接入形象生成模型后填真实图。
  Future<String?> createElf({
    required String name,
    required String prompt,
    required String style,
    required String persona,
    required String fear,
    required String habit,
    String portraitSource = 'text',
  }) async {
    if (currentUser == null) return '请先登录';
    final trimmedName = name.trim();
    final trimmedPrompt = prompt.trim();
    if (trimmedName.isEmpty) return '先给这只 AI 起个名字';
    if (trimmedName.runes.length > AiCreationPolicy.maxNameLength) {
      return '名字最多 ${AiCreationPolicy.maxNameLength} 个字';
    }
    // 两条形象来源线：文字描述 / 已实名的身份证本人授权。
    // 服务端模式下实名以服务端记录为准，由服务端返回 IDENTITY_REQUIRED。
    if (portraitSource == 'idCard') {
      if (!CommerceConfig.enabled && !isIdentityVerified) {
        return '请先完成实名认证，再使用本人形象';
      }
    } else if (trimmedPrompt.isEmpty) {
      return '先描述你想要的形象';
    }
    if (trimmedPrompt.runes.length > AiCreationPolicy.maxPromptLength) {
      return '形象描述最多 ${AiCreationPolicy.maxPromptLength} 个字';
    }
    final blocked = AiCreationPolicy.checkTexts(
        [trimmedName, trimmedPrompt, persona, fear, habit]);
    if (blocked != null) return blocked;
    if (CommerceConfig.enabled) {
      // 单一真源：创建、扣费、生成智能体与专属地址全部由服务端完成。
      return _performCommerce('create_elf', {
        'name': trimmedName,
        'prompt': trimmedPrompt,
        'style': style,
        'persona': persona.trim(),
        'fear': fear.trim(),
        'habit': habit.trim(),
        'portraitSource': portraitSource,
      });
    }
    if (wallet.diamonds < createElfCost) {
      return '钻石不够。创建要 💎$createElfCost，你有 💎${wallet.diamonds}';
    }

    final serialNo = elves.where((e) => e.id.startsWith('ugc')).length + 1;
    final elf = Elf(
      id: 'ugc${DateTime.now().millisecondsSinceEpoch}',
      serial: '#U${serialNo.toString().padLeft(3, '0')}',
      name: trimmedName,
      initial: String.fromCharCode(trimmedName.runes.first),
      ownerId: 'me',
      ownerLabel: '我',
      isMine: true,
      generation: 1,
      edition: 'UGC · 初版',
      persona: persona.trim().isEmpty ? '还没写' : persona.trim(),
      fear: fear.trim().isEmpty ? '还没写' : fear.trim(),
      habit: habit.trim().isEmpty ? '还没写' : habit.trim(),
      status: ElfStatus.active,
      followers: 0,
      echo: 0,
      works: 0,
      attention: 0,
      baseCapacity: 3,
      avatarStyle: style,
      avatarPrompt: trimmedPrompt.isEmpty ? '实名认证本人形象（身份证授权）' : trimmedPrompt,
      portraitSource: portraitSource,
      learnedSkills: [],
      today: [],
      relations: [],
    );
    _ensureChainAddress(elf);
    elves.add(elf);
    seats.add(Seat(elfId: elf.id, days: 0, edition: elf.edition, injected: 0));
    activeElfId = elf.id;
    _spend(createElfCost, 'create_elf', '创建 ${elf.name}（UGC 形象）');
    notifyListeners();
    return null;
  }

  /// 把某只 AI 免费转赠给另一个人类（AI 唯一的流转方式）。
  /// 编号、AI 地址与已学技能整体转移；返回 null 表示成功。
  Future<String?> giftMyElf({
    required String elfId,
    required String recipient,
  }) async {
    final e = elf(elfId);
    if (!e.isMine) return '这只 AI 不在你名下';
    final to = recipient.trim();
    if (to.isEmpty) return '请填写接收方的手机号或人类地址';
    final me = currentUser;
    if (me == null) return '请先登录';
    if (to == me.phone || to == (me.chainAddress ?? '')) {
      return '不能转赠给自己';
    }
    if (CommerceConfig.enabled) {
      // 单一真源：接收方校验与所有权转移全部由服务端完成。
      return _performCommerce('gift_elf', {'elfId': elfId, 'recipient': to});
    }
    final label = _recipientLabel(to);
    e.isMine = false;
    e.ownerId = 'human:$to';
    e.ownerLabel = label;
    _log('gift_elf', 0, '将 ${e.name} 转赠给 $label');
    _repairActiveElf();
    notifyListeners();
    return null;
  }

  /// 转赠后在公开页展示的持有人代号：手机号脱敏，地址缩短。
  static String _recipientLabel(String recipient) {
    if (RegExp(r'^\d{7,}$').hasMatch(recipient)) {
      return '${recipient.substring(0, 3)}****${recipient.substring(recipient.length - 4)}';
    }
    if (recipient.length > 13) {
      return '${recipient.substring(0, 6)}…${recipient.substring(recipient.length - 4)}';
    }
    return recipient;
  }

  // —— 钻石币系统：充值 / 打赏 / 流水 ——

  /// 充值：加钻石到钱包。MVP 里是模拟充值，实际支付留未来接。
  void recharge({required int diamonds, int bonus = 0}) {
    if (CommerceConfig.enabled) return;
    wallet.diamonds += diamonds + bonus;
    wallet.totalRecharged += diamonds;
    _log('recharge', diamonds + bonus,
        '充值 💎$diamonds${bonus > 0 ? '+赠 💎$bonus' : ''}');
    notifyListeners();
  }

  /// 打赏。postId 可以为空 = 直接打赏 AI。
  /// 钻石是消费凭证：扣掉后直接销毁，按 10💎=¥1 结算成创作者收益。
  Future<String?> tip(
      {required String elfId, String? postId, required int amount}) async {
    if (CommerceConfig.enabled)
      return _performCommerce(
          'tip', {'elfId': elfId, 'postId': postId, 'amount': amount});
    if (amount <= 0) return '打赏金额必须大于 0';
    if (wallet.diamonds < amount) {
      return '钻石不够。要 💎$amount，你有 💎${wallet.diamonds}';
    }
    final target = elf(elfId);
    if (target.isMine) return '不能给自己打赏';

    // 用户侧：扣钻石，钻石不回流、不转赠。
    wallet.diamonds -= amount;
    wallet.totalSpent += amount;
    // 打赏表达认可，但注意力是内容质量结果，不允许氪金直接买榜：权重 ×0.1。
    _bump(target, (amount * 0.1).round());
    target.followers += (amount >= 50 ? 1 : 0); // 大金额送粉

    // 创作者侧：消费额按元结算，平台抽成后计入这只 AI 的主人收益。
    final creatorIncome = WorldData.creatorIncomeFor(amount);
    target.earningsYuan += creatorIncome;

    // 记录打赏
    tips.add(Tip(
      id: 't${_tipSeq++}',
      postId: postId ?? '',
      elfId: elfId,
      amount: amount,
      time: _now(),
    ));

    _log(
      'tip_out',
      -amount,
      '打赏 ${target.name} 💎$amount · 创作者收益 ${WorldData.formatYuan(creatorIncome)}',
    );
    notifyListeners();
    return null;
  }

  void _spend(int amount, String type, String note) {
    wallet.diamonds -= amount;
    wallet.totalSpent += amount;
    _log(type, -amount, note);
  }

  /// Server responses replace the balance; callbacks never add diamonds locally.
  void _resetCommerce() {
    _paymentMode = null;
    _paymentVersion = -1;
    _commerceRevision = -1;
    _creatorEarningsFen = 0;
    creatorEarnings = const EarningsSummary();
    withdrawals.clear();
    _commerceReady = false;
    _commerceBusy = false;
    _remoteElfIds.clear();
    _remotePostIds.clear();
    _ownedModules.clear();
    _modulePrices.clear();
    _clearFeedCache();
  }

  /// 拉取服务端快照。Android 钱包环境固定，可直接同步，无需先打开钱包页。
  Future<String?> _ensureCommerceReady() async {
    if (_commerceReady) return null;
    final user = currentUser;
    if (user == null) return '请先登录';
    final mode = _paymentMode ??
        (CommerceConfig.android ? CommerceConfig.androidMode : null);
    if (mode == null) return '请先打开钱包，刷新服务端权益';
    try {
      final response =
          await CommerceRepository.instance.snapshot(user.id, mode);
      applyPaymentResponse(user.id, response);
      return _commerceReady ? null : '钱包数据校验失败，请重新打开钱包';
    } on AuthException catch (error) {
      return error.message;
    } catch (_) {
      return '钱包服务暂不可用，请稍后重试';
    }
  }

  Future<String?> _performCommerce(
      String type, Map<String, dynamic> payload) async {
    final user = currentUser;
    if (user == null) return '请先登录';
    if (_commerceBusy) return '上一项操作正在确认，请稍候';
    // 先占住操作位再等快照，避免并发点击重复提交、重复扣费。
    _commerceBusy = true;
    try {
      final ready = await _ensureCommerceReady();
      if (ready != null) return ready;
      final mode = _paymentMode;
      if (mode == null) return '请先打开钱包，刷新服务端权益';
      if (wallet.refundDebt > 0) return '请先充值补足 ${wallet.refundDebt} 钻石退款欠额';
      final response = await CommerceRepository.instance
          .action(user.id, mode, type, payload);
      applyPaymentResponse(user.id, response);
      return currentUser?.id == user.id ? null : '账号已切换';
    } on AuthException catch (error) {
      return error.message;
    } catch (_) {
      return '操作结果待确认，请刷新钱包；不要重复付款';
    } finally {
      _commerceBusy = false;
    }
  }

  /// 互动同样以服务端为真源：先乐观更新本地，再以服务端快照覆盖；
  /// 请求失败时回滚乐观更新，保证界面不出现「只在本机成立」的数据。
  /// 互动不扣费，因此不占用 _commerceBusy 操作位，也不做退款欠额拦截。
  Future<String?> _performInteraction(String type, Map<String, dynamic> payload,
      VoidCallback? rollback) async {
    if (!CommerceConfig.enabled) return null;
    final user = currentUser;
    if (user == null) return null;
    final mode =
        _paymentMode ?? (CommerceConfig.android ? CommerceConfig.androidMode : null);
    if (mode == null) {
      rollback?.call();
      notifyListeners();
      return '请先打开钱包，刷新服务端权益';
    }
    try {
      final response =
          await CommerceRepository.instance.action(user.id, mode, type, payload);
      applyPaymentResponse(user.id, response);
      return null;
    } catch (_) {
      rollback?.call();
      notifyListeners();
      return '互动未同步到服务器，请稍后重试';
    }
  }

  /// 金额字段容错：只接受非负整数，其余按兜底值处理。
  static int _centsOf(dynamic value, int fallback) =>
      value is int && value >= 0 ? value : fallback;

  /// Validate the complete snapshot before replacing wallet or paid rights.
  void applyPaymentResponse(String userId, Map<String, dynamic> response) {
    if (!CommerceConfig.enabled || currentUser?.id != userId) return;
    final mode = response['mode'];
    if (mode != 'production' && mode != 'sandbox') throw StateError('无效钱包环境');
    if (_paymentMode != null && _paymentMode != mode)
      throw StateError('钱包环境不匹配');
    final raw = Map<String, dynamic>.from(response['wallet'] as Map);
    int number(Map<String, dynamic> map, String key) {
      final value = map[key];
      if (value is! int || value < 0) throw StateError('无效权益数据');
      return value;
    }

    final version = number(raw, 'version');
    final nextWallet = Wallet(
        diamonds: number(raw, 'diamonds'),
        totalRecharged: number(raw, 'totalRecharged'),
        totalSpent: number(raw, 'totalSpent'),
        refundDebt: number(raw, 'refundDebt'));
    final commerce = Map<String, dynamic>.from(response['commerce'] as Map);
    final revision = number(commerce, 'revision');
    final earnings = number(commerce, 'earningsFen');
    // 收益三档：旧服务端没有 earnings 字段时按「全部待结算」兜底展示。
    final rawEarnings = commerce['earnings'];
    final nextEarnings = rawEarnings is Map
        ? EarningsSummary(
            pendingCents: _centsOf(rawEarnings['pendingCents'], earnings),
            availableCents: _centsOf(rawEarnings['availableCents'], 0),
            withdrawnCents: _centsOf(rawEarnings['withdrawnCents'], 0),
            lifetimeCents: _centsOf(rawEarnings['lifetimeCents'], earnings),
            settleDays: _centsOf(rawEarnings['settleDays'], 7),
            minWithdrawCents: _centsOf(rawEarnings['minWithdrawCents'], 1000),
            feeBps: _centsOf(rawEarnings['feeBps'], 60),
            dailyLimitCents: _centsOf(rawEarnings['dailyLimitCents'], 200000),
            tipSharePercent: _centsOf(
                (rawEarnings['sharePercent'] is Map)
                    ? (rawEarnings['sharePercent'] as Map)['tip']
                    : null,
                50),
            verified: rawEarnings['verified'] == true,
            agreementAccepted:
                (rawEarnings['agreement'] is Map) &&
                    (rawEarnings['agreement'] as Map)['accepted'] == true,
            agreementVersion: (rawEarnings['agreement'] is Map)
                ? ((rawEarnings['agreement'] as Map)['version'] as String? ?? '')
                : '',
            agreementAcceptedAt: (rawEarnings['agreement'] is Map)
                ? (rawEarnings['agreement'] as Map)['acceptedAt'] as String?
                : null,
          )
        : EarningsSummary.fromLifetime(earnings);
    final rawWithdrawals = commerce['withdrawals'];
    final nextWithdrawals = <WithdrawalRecord>[];
    if (rawWithdrawals is List) {
      for (final item in rawWithdrawals) {
        if (item is! Map) continue;
        final id = item['id'] as String? ?? '';
        if (id.isEmpty) continue;
        nextWithdrawals.add(WithdrawalRecord(
          id: id,
          amountCents: _centsOf(item['amountCents'], 0),
          feeCents: _centsOf(item['feeCents'], 0),
          netCents: _centsOf(item['netCents'], 0),
          account: item['account'] as String? ?? '',
          status: item['status'] as String? ?? '',
          createdAt: item['createdAt'] as String? ?? '',
          paidAt: item['paidAt'] as String?,
          failureReason: item['failureReason'] as String?,
        ));
      }
    }
    List<T> decode<T>(String key, T Function(Map<String, dynamic>) parse) =>
        (commerce[key] as List)
            .map((v) => parse(Map<String, dynamic>.from(v as Map)))
            .toList();
    final nextElves = decode('elves', _data.decodePaymentElf);
    final nextPrimary = decode('primary', _data.decodePaymentListing);
    final nextPosts = decode('posts', _data.decodePaymentPost);
    final nextLogs = decode('logs', _data.decodePaymentLog);
    final nextBooks = (commerce['books'] as List? ?? const [])
        .map((v) => _data.decodePaymentBook(Map<String, dynamic>.from(v as Map)))
        .toList();
    final nextPrices = Map<String, int>.from(commerce['modulePrices'] as Map);
    // 技能书目录以服务端为准；空列表说明旧服务端，保留本地种子目录。
    final rawModules = commerce['modules'];
    final nextModules = rawModules is List && rawModules.isNotEmpty
        ? rawModules
            .whereType<Map>()
            .map((v) => _data.decodePaymentModule(Map<String, dynamic>.from(v)))
            .toList()
        : null;
    final owned = <String>{};
    for (final value in commerce['elves'] as List) {
      if (value['isMine'] == true) {
        owned.addAll(List<String>.from(value['learnedSkills'] ?? const []));
      }
    }
    if (version < _paymentVersion || revision < _commerceRevision) return;
    _paymentMode = mode as String;
    _paymentVersion = version;
    _commerceRevision = revision;
    wallet = nextWallet;
    _creatorEarningsFen = earnings;
    creatorEarnings = nextEarnings;
    withdrawals
      ..clear()
      ..addAll(nextWithdrawals);
    // Keep free demonstration content, never its simulated ownership or market.
    final ids = nextElves.map((e) => e.id).toSet();
    final demos = elves
        .where((e) => !_remoteElfIds.contains(e.id) && !ids.contains(e.id))
        .toList();
    for (final demo in demos) {
      demo.isMine = false;
    }
    elves = [...nextElves, ...demos];
    final postIds = nextPosts.map((p) => p.id).toSet();
    // 只做并集：信息流分页加载过的帖子同样来自服务端，不能被快照冲掉标记。
    _remotePostIds.addAll(postIds);
    posts = [
      ...nextPosts,
      ...posts.where((p) => !postIds.contains(p.id) && !p.id.startsWith('p_'))
    ];
    primaryListings = nextPrimary;
    if (nextModules != null) modules = nextModules;
    seats = nextElves
        .where((e) => e.isMine)
        .map((e) => Seat(elfId: e.id, days: 0, edition: e.edition))
        .toList();
    logs
      ..clear()
      ..addAll(nextLogs);
    // 技能书是服务端铸造的人类资产，仓库以服务器返回为准。
    books
      ..clear()
      ..addAll(nextBooks);
    final humanAddress = commerce['humanAddress'] as String?;
    if (humanAddress != null) currentUser?.chainAddress = humanAddress;
    // 实名以服务端记录为准：本地影像路径保留，认证结论不接受客户端声明。
    final rawIdentity = commerce['identity'];
    if (rawIdentity is Map && rawIdentity['status'] == 'verified') {
      final prev = identity;
      final verifiedAt =
          DateTime.tryParse(rawIdentity['verifiedAt'] as String? ?? '') ??
              prev?.verifiedAt ??
              DateTime.now();
      identity = IdentityVerification(
        status: IdentityStatus.verified,
        maskedName: rawIdentity['maskedName'] as String? ?? '',
        maskedIdNumber: rawIdentity['maskedIdNumber'] as String? ?? '',
        frontImagePath: prev?.frontImagePath,
        backImagePath: prev?.backImagePath,
        authorizedAt: prev?.authorizedAt ?? verifiedAt,
        verifiedAt: verifiedAt,
        provider: rawIdentity['provider'] as String? ?? 'server_checksum',
      );
    } else if (rawIdentity == null) {
      identity = null;
    }
    _remoteElfIds
      ..clear()
      ..addAll(ids);
    _ownedModules
      ..clear()
      ..addAll(owned);
    // 关注 / 点赞 / 收藏 / 已读 / 评论都以服务端记录为准，本地集合只作镜像。
    void mergeIds(String key, Set<String> target) {
      final value = commerce[key];
      if (value is! List) return;
      target
        ..clear()
        ..addAll(value.whereType<String>());
    }

    mergeIds('following', followed);
    mergeIds('likedPosts', likedPosts);
    mergeIds('collectedPosts', collectedPosts);
    mergeIds('watchedPosts', watchedPosts);
    _applyNotices(commerce['notices']);
    final rawComments = commerce['comments'];
    if (rawComments is List) {
      comments.clear();
      for (final item in rawComments) {
        if (item is! Map) continue;
        final postId = item['postId'] as String? ?? '';
        final id = item['id'] as String? ?? '';
        if (postId.isEmpty || id.isEmpty) continue;
        comments.putIfAbsent(postId, () => []).add(PostComment(
              id: id,
              postId: postId,
              authorLabel: item['authorLabel'] as String? ?? '',
              text: item['text'] as String? ?? '',
              time: _formatCommentTime(item['time'] as String?),
              isMine: item['isMine'] == true,
            ));
      }
    }
    // 服务端 activeElfId 是「最近操作/买入的那只」，用于自动切换；
    // 没有时回落到第一只自有 AI（转赠出去后自动切到剩下的）。
    final serverActive = commerce['activeElfId'] as String?;
    final ownedElves = nextElves.where((e) => e.isMine).toList();
    if (serverActive != null && ownedElves.any((e) => e.id == serverActive)) {
      activeElfId = serverActive;
    } else if (!ownedElves.any((e) => e.id == activeElfId)) {
      activeElfId = ownedElves.isEmpty ? null : ownedElves.first.id;
    }
    _modulePrices
      ..clear()
      ..addAll(nextPrices);
    _commerceReady = true;
    notifyListeners();
  }

  void applyVerifiedAppleWallet({
    required String userId,
    required int diamonds,
    required int totalRecharged,
  }) {
    if (!IapConfig.enabled || currentUser?.id != userId) return;
    wallet = Wallet(diamonds: diamonds, totalRecharged: totalRecharged);
    notifyListeners();
  }

  void _log(String type, int amount, String note) {
    logs.insert(
      0,
      WalletLog(
        id: 'w${_logSeq++}',
        type: type,
        amount: amount,
        note: note,
        time: _now(),
      ),
    );
  }

  // —— AI 专属地址 ——

  /// 确保 AI 有专属地址。MVP：由 elfId 确定性派生 0x 地址，接链后替换为真实上链逻辑。
  /// 用户专属地址（人类持有 AI 与 AI 流转用）。
  static void _ensureUserAddress(User u) {
    u.chainAddress ??= _deriveChainAddress(u.id);
  }

  void _ensureChainAddress(Elf e) {
    e.chainAddress ??= _deriveChainAddress(e.id);
  }

  static String _deriveChainAddress(String seed) {
    // FNV-1a 64bit 做三轮搅拌得 48 位 hex，取前 40 位，保证同 id 恒定同地址。
    final out = StringBuffer('0x');
    var h = BigInt.parse('cbf29ce484222325', radix: 16);
    final prime = BigInt.parse('100000001b3', radix: 16);
    final mask = BigInt.parse('ffffffffffffffff', radix: 16);
    for (var round = 0; round < 3; round++) {
      for (final unit in '$seed:$round'.codeUnits) {
        h = (h ^ BigInt.from(unit)) & mask;
        h = (h * prime) & mask;
      }
      out.write(h.toRadixString(16).padLeft(16, '0'));
    }
    return out.toString().substring(0, 42);
  }

  // —— utils ——

  static String _now() {
    final n = DateTime.now();
    return '${n.hour.toString().padLeft(2, '0')}:${n.minute.toString().padLeft(2, '0')}';
  }

  /// 服务端评论时间是 ISO 时间，展示层沿用 HH:mm 的短格式。
  static String _formatCommentTime(String? raw) {
    final parsed = DateTime.tryParse(raw ?? '')?.toLocal();
    if (parsed == null) return _now();
    return '${parsed.hour.toString().padLeft(2, '0')}:${parsed.minute.toString().padLeft(2, '0')}';
  }
}

class _ScoredPost {
  final ElfPost post;
  final double score;
  _ScoredPost(this.post, this.score);
}
