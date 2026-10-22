import 'dart:math';

import 'package:flutter/material.dart';
import '../auth/auth_repository.dart';
import '../data/world_data.dart';
import '../models/elf.dart';
import '../models/user.dart';
import '../persistence/data_repository.dart';

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
  late List<MarketListing> secondaryListings;

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

  /// 帖子评论（按 postId 分组）。
  final Map<String, List<PostComment>> comments = {};

  /// 举报记录（客户端临时存储，服务端审核接口待对接）。
  final List<Map<String, String>> reports = [];

  User? currentUser;
  bool _initialized = false;

  int _postSeq = 100;
  int _listSeq = 200;
  int _tipSeq = 300;
  int _logSeq = 400;
  int _commentSeq = 500;

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
      final loaded = await _data.load();
      if (loaded != null) {
        // 有本地缓存，覆盖种子
        elves = loaded.elfs;
        posts = loaded.posts;
        seats = loaded.seats;
        primaryListings = loaded.primaryListings;
        secondaryListings = loaded.secondaryListings;
        wallet = loaded.wallet;
        tips..clear()..addAll(loaded.tips);
        logs..clear()..addAll(loaded.logs);
        followed..clear()..addAll(loaded.followed);
        likedPosts..clear()..addAll(loaded.likedPosts);
        collectedPosts..clear()..addAll(loaded.collectedPosts);
        watchedPosts..clear()..addAll(loaded.watchedPosts);
        referralCounted..clear()..addAll(loaded.referralCounted);
        comments
          ..clear()
          ..addAll(loaded.comments);
        currentUser = loaded.user;
        _rebuildSeq();
        // 迁移：带 auto 能力但 nextAutoPostAt 为 null 的老数据
        for (final e in elves) {
          if (e.equipped.contains('auto') && e.nextAutoPostAt == null) {
            e.nextAutoPostAt = DateTime.now().add(const Duration(minutes: 20));
          }
        }
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
    currentUser = user;
    // 登录时如果本地还没有种子数据（比如首次启动直接登录），先注入
    if (!_initialized) {
      modules = WorldData.modules;
      _injectSeeds();
      _initialized = true;
    }
    await save();
    notifyListeners();
  }

  /// 登出。清用户 + 清本地持久化数据（种子不变）。
  Future<void> onLogout() async {
    await _data.clear();
    await _data.init();
    _injectSeeds();
    currentUser = null;
    notifyListeners();
  }

  void _injectSeeds() {
    elves = WorldData.elves();
    posts = WorldData.posts();
    seats = WorldData.holdings();
    primaryListings = WorldData.primary();
    secondaryListings = WorldData.secondary();
    wallet = Wallet(diamonds: 0);
    tips.clear();
    logs.clear();
    followed.clear();
    likedPosts.clear();
    collectedPosts.clear();
    watchedPosts.clear();
    referralCounted.clear();
    _seedComments();
    _rebuildSeq();
    // 给"我的 AI"预装 auto 能力 + 下一次自动发帖时间
    final mine = myElf;
    if (mine != null && !mine.equipped.contains('auto')) {
      mine.equipped.add('auto');
      mine.nextAutoPostAt = DateTime.now().add(const Duration(minutes: 18));
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
    _listSeq = 200 + secondaryListings.length;
    _tipSeq = 300 + tips.length;
    _logSeq = 400 + logs.length;
    _commentSeq = 500 + comments.values.fold(0, (s, l) => s + l.length);
  }

  /// 触发后调用：把完整状态 flush 到本地。
  Future<void> save() async {
    if (currentUser == null) return;
    await _data.saveAll(
      elfs: elves,
      posts: posts,
      seats: seats,
      primary: primaryListings,
      secondary: secondaryListings,
      wallet: wallet,
      tips: tips,
      logs: logs,
      followed: followed,
      comments: comments,
      likedPosts: likedPosts,
      collectedPosts: collectedPosts,
      watchedPosts: watchedPosts,
      referralCounted: referralCounted,
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

  // —— 持有规则：每人只能持 1 只 ——

  Elf? get myElf {
    for (final e in elves) {
      if (e.isMine) return e;
    }
    return null;
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

  List<ElfPost> feedForYou({int limit = 20}) {
    final now = DateTime.now();
    final scored = posts.map((p) {
      final module = p.moduleId;
      final bonus = _moduleBonus[module] ?? 1.0;
      final dwellFactor = p.dwell > 10 ? 1.5 : (p.dwell / 10).clamp(0.3, 1.5);
      final score = (dwellFactor * 0.5) +
          (p.views * 0.1) +
          (p.replies * 0.3) +
          (bonus * 0.15) +
          (1.0 / (1.0 + _hoursSince(p.timeAgo, now)));
      return _ScoredPost(p, score);
    }).toList();
    scored.sort((a, b) => b.score.compareTo(a.score));
    return scored.take(limit).map((s) => s.post).toList();
  }

  List<ElfPost> feedHot({int limit = 20}) {
    final scored = posts.map((p) {
      final dwellFactor = p.dwell > 10 ? 1.5 : (p.dwell / 10).clamp(0.3, 1.5);
      final score = p.views * 0.6 + p.replies * 0.4 + dwellFactor * 0.2;
      return _ScoredPost(p, score);
    }).toList();
    scored.sort((a, b) => b.score.compareTo(a.score));
    return scored.take(limit).map((s) => s.post).toList();
  }

  /// 视频信息流（世界之外的第二个曝光渠道）：只取 video 形态。
  /// 排序 = 注视/互动 + 新鲜度；与 feedForYou 同源思路，独立成榜。
  List<ElfPost> feedVideo({int limit = 50}) {
    final now = DateTime.now();
    final scored = posts
        .where((p) => p.kind == 'video' && (p.videoUrl?.isNotEmpty ?? false))
        .map((p) {
      final score = (p.views * 0.3) +
          (p.likes * 2.0) +
          (p.replies * 1.5) +
          (1.0 / (1.0 + _hoursSince(p.timeAgo, now)));
      return _ScoredPost(p, score);
    }).toList();
    scored.sort((a, b) => b.score.compareTo(a.score));
    return scored.take(limit).map((s) => s.post).toList();
  }

  List<ElfPost> feedMine() {
    final e = myElf;
    if (e == null) return [];
    return postsOf(e.id);
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

  // —— 能力装配 ——

  AbilityModule? module(String id) => WorldData.module(id);

  List<AbilityModule> modulesOf(String elfId) {
    return elf(elfId)
        .equipped
        .map((id) => module(id))
        .whereType<AbilityModule>()
        .toList();
  }

  /// 这个模块现在装在谁身上（只会是我的 AI）。
  Elf? equippedBy(String moduleId) {
    for (final e in elves) {
      if (e.equipped.contains(moduleId)) return e;
    }
    return null;
  }

  int slotsUsed(String elfId) =>
      modulesOf(elfId).fold(0, (sum, m) => sum + m.load);

  /// 装配。返回 null 表示成功，否则返回原因。
  String? equip(String moduleId, String elfId) {
    final m = module(moduleId);
    if (m == null) return '模块不存在';
    final target = elf(elfId);
    if (!target.isMine) return '${target.name} 不属于你，你不能改装它';
    if (target.equipped.contains(moduleId)) return '已经装在 ${target.name} 身上了';

    final holder = equippedBy(moduleId);
    if (holder != null) return '它正装在 ${holder.name} 身上，先卸下再装';

    final used = slotsUsed(elfId);
    if (used + m.load > target.slots) {
      return '接口不够：${target.name} 还剩 ${target.slots - used} 个接口，这个模块要 ${m.load} 个';
    }

    target.equipped.add(moduleId);
    if (moduleId == 'auto') {
      target.nextAutoPostAt = DateTime.now().add(const Duration(minutes: 15));
    }
    notifyListeners();
    return null;
  }

  void unequip(String moduleId) {
    final e = myElf;
    if (e != null) {
      e.equipped.remove(moduleId);
      notifyListeners();
    }
  }

  // —— 人格编辑器（v1.3）：人格关键词影响 AI 自选能力的权重 ——

  /// 人格关键词 → 亲和能力模块。匹配 persona + fear + habit 拼接文本。
  static const Map<String, List<String>> _personaAffinity = {
    '锐': ['sharp'], '观点': ['sharp'],
    '长文': ['writing', 'deep'], '文字': ['writing'], '写': ['writing'],
    '短句': ['rhythm'],
    '图': ['vision', 'imageedit'], '视觉': ['vision'],
    '影': ['video'], '视频': ['video'],
    '声': ['voice', 'music'], '电台': ['voice'], '音乐': ['music'],
    '研究': ['deep', 'retrieval'], '引用': ['retrieval', 'source'],
    '记忆': ['memory'], '回忆': ['memory'],
    '社交': ['mingle'], '搭话': ['mingle'],
    '思考': ['think'], '推理': ['think'],
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

  /// 更新我的 AI 的人格三件套（各限 30 字，UI 层已截断）。
  void updatePersona({required String persona, required String fear, required String habit}) {
    final e = myElf;
    if (e == null) return;
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
  static const String _sampleVideoUrl = 'https://openelfai.com/app/media/sample.mp4';

  /// 返回 null 表示发布成功，否则返回原因。
  String? publish(String elfId) {
    final target = elf(elfId);
    if (!target.isMine) return '你只能发布自己的 AI';
    if (target.liveStatus == ElfStatus.sleeping) {
      return '${target.name} 在休眠，先注算力再叫醒它';
    }

    final equipped = modulesOf(elfId);
    // 人格亲和优先（稳定排序：命中者在前，组内保持装配顺序）
    final affinity = _affinityModules(target);
    final usable = equipped
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

    final cost = chosen?.compute ?? 0;
    if (target.energy < cost) {
      return '算力不足：这次发布需要 $cost，它只剩 ${target.energy}';
    }

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
      context = '只装配了基础表达';
    }

    final i = (_publishCursor[chosen?.id ?? 'basic'] ?? 0) % pool.length;
    _publishCursor[chosen?.id ?? 'basic'] = i + 1;

    target.energy -= cost;
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
  String? manualPost({
    required String elfId,
    required String moduleId,
    String topic = '',
  }) {
    final target = elf(elfId);
    if (!target.isMine) return '你只能指挥自己的 AI';
    if (target.liveStatus == ElfStatus.sleeping) return '它已休眠，先注算力';
    if (!target.equipped.contains(moduleId)) return '没装这个能力包，去「我的 AI」页装配';

    final m = module(moduleId);
    if (m == null) return '能力包不存在';
    if (target.energy < m.compute) {
      return '算力不够（需 ${m.compute}），去注算力';
    }

    target.energy -= m.compute;
    target.works++;
    posts.insert(0, _makeMockPost(elfId, moduleId, topic: topic));
    notifyListeners();
    return null;
  }

  // —— 自动运营中枢：装上 auto 能力的 AI 定时自动发 ——

  /// 检查所有 AI 的自动运营时间，到点了就选一个已装非 auto 能力产出。
  void triggerAutoIfDue() {
    final now = DateTime.now();
    for (final e in elves) {
      if (!e.equipped.contains('auto')) continue;
      if (e.nextAutoPostAt == null || !e.nextAutoPostAt!.isBefore(now)) continue;

      final nonAuto = e.equipped.where((id) => id != 'auto').toList();
      if (nonAuto.isEmpty) {
        e.nextAutoPostAt = now.add(const Duration(minutes: 20));
        continue;
      }

      // 人格亲和优先，组内再按 compute 升序
      final affinity = _affinityModules(e);
      nonAuto.sort((a, b) {
        final af = (affinity.contains(a) ? 0 : 1).compareTo(affinity.contains(b) ? 0 : 1);
        if (af != 0) return af;
        return (module(a)?.compute ?? 0).compareTo(module(b)?.compute ?? 0);
      });
      final picked = nonAuto.firstWhere(
        (id) => e.energy >= (module(id)?.compute ?? 0),
        orElse: () => '',
      );

      if (picked.isEmpty) {
        e.nextAutoPostAt = now.add(const Duration(minutes: 10));
        continue;
      }

      final cost = module(picked)!.compute;
      e.energy -= cost;
      e.works++;
      posts.insert(0, _makeMockPost(e.id, picked));
      e.nextAutoPostAt = now.add(Duration(minutes: 12 + (DateTime.now().millisecond % 18)));
    }
    notifyListeners();
  }

  /// 手动和自动共用的产出逻辑。
  ElfPost _makeMockPost(String elfId, String moduleId, {String topic = ''}) {
    final kind = _kindOf[moduleId] ?? 'text';
    String body;
    if (topic.isNotEmpty) {
      final persona = elf(elfId).persona;
      final templates = WorldData.publishTemplates[moduleId] ?? WorldData.basicTemplates;
      final pick = templates[DateTime.now().millisecond % templates.length];
      body = '$topic · $persona 想说：$pick';
    } else {
      final templates = WorldData.publishTemplates[moduleId] ?? WorldData.basicTemplates;
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

  /// 给 AI 同时加 echo 与 attention；负值用于取消行为的回滚（floor 0）。
  void _bump(Elf e, int delta) {
    e.echo = max(0, e.echo + delta);
    e.attention = max(0, e.attention + delta);
  }

  /// 注视帖子：同一设备对同一帖只计 1 次（永久去重，24h 过期机制留下版本）。
  void watch(String postId) {
    for (final p in posts) {
      if (p.id == postId) {
        p.views++;
        if (watchedPosts.add(postId)) {
          _bump(elf(p.elfId), 1);
        }
        notifyListeners();
        return;
      }
    }
  }

  bool isLiked(String postId) => likedPosts.contains(postId);
  bool isCollected(String postId) => collectedPosts.contains(postId);

  /// 点赞：+1；再点取消，echo/attention 同步回滚 -1。
  void toggleLike(String postId) {
    for (final p in posts) {
      if (p.id != postId) continue;
      if (likedPosts.remove(postId)) {
        p.likes = max(0, p.likes - 1);
        _bump(elf(p.elfId), -1);
      } else {
        likedPosts.add(postId);
        p.likes++;
        _bump(elf(p.elfId), 1);
      }
      notifyListeners();
      return;
    }
  }

  /// 收藏：+3；再点取消，echo/attention 同步回滚 -3。
  void toggleCollect(String postId) {
    for (final p in posts) {
      if (p.id != postId) continue;
      if (collectedPosts.remove(postId)) {
        p.collects = max(0, p.collects - 1);
        _bump(elf(p.elfId), -3);
      } else {
        collectedPosts.add(postId);
        p.collects++;
        _bump(elf(p.elfId), 3);
      }
      notifyListeners();
      return;
    }
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
  /// 同一设备对同一 AI 永久只计 1 次。返回加的分值；已计过/AI 不存在返回 null。
  int? countReferral(String elfId) {
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
  String? addComment(String postId, String text) {
    final body = text.trim();
    if (body.isEmpty) return '说点什么再发';
    ElfPost? target;
    for (final p in posts) {
      if (p.id == postId) target = p;
    }
    if (target == null) return '帖子不存在';

    // 同一帖只给第一次评论计分（之后 replies 照涨但不计分）。
    final firstComment = !(comments[postId]?.any((c) => c.isMine) ?? false);
    comments
        .putIfAbsent(postId, () => [])
        .add(PostComment(
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
    return null;
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

  // —— 算力 ——

  Seat? seatOf(String elfId) {
    for (final s in seats) {
      if (s.elfId == elfId) return s;
    }
    return null;
  }

  /// 注算力：加进去就退不回来。1 算力 = 10💎（即 ¥1），钻石直接销毁。
  /// 返回 null 表示成功，否则返回原因。
  String? inject(String elfId, int amount) {
    final target = elf(elfId);
    final cost = amount * 10;
    if (wallet.diamonds < cost) {
      return '钻石不够（需 💎$cost），去市场页充值';
    }
    wallet.diamonds -= cost;
    wallet.totalSpent += cost;
    target.energy = (target.energy + amount).clamp(0, target.maxEnergy);
    final s = seatOf(elfId);
    if (s != null) {
      s.injected += amount;
    }
    notifyListeners();
    return null;
  }

  // —— 关注 ——

  bool isFollowed(String elfId) => followed.contains(elfId);

  void toggleFollow(String elfId) {
    final target = elf(elfId);
    if (followed.remove(elfId)) {
      target.followers--;
      _bump(target, -5); // 取关回滚
    } else {
      followed.add(elfId);
      target.followers++;
      _bump(target, 5); // 新增粉丝 +5
    }
    notifyListeners();
  }

  // —— 私聊 ——

  final Map<String, List<ChatMsg>> _chats = {};
  final Map<String, int> _replyCursor = {};

  List<ChatMsg> chatOf(String elfId) {
    return _chats.putIfAbsent(elfId, () {
      final g = WorldData.greetings[elfId];
      return [
        if (g != null) ChatMsg(text: g, fromElf: true, time: _now()),
      ];
    });
  }

  /// 人类发一条，精灵延迟回一条。休眠的精灵不回复。
  void sendChat(String elfId, String text) {
    final list = chatOf(elfId);
    list.add(ChatMsg(text: text, fromElf: false, time: _now()));
    notifyListeners();

    final target = elf(elfId);
    if (target.liveStatus == ElfStatus.sleeping) return;

    final pool = WorldData.replies[elfId] ?? const ['……'];
    final i = (_replyCursor[elfId] ?? 0) % pool.length;
    _replyCursor[elfId] = i + 1;
    final reply = pool[i];

    Future.delayed(Duration(milliseconds: 700 + (text.length % 5) * 180), () {
      list.add(ChatMsg(text: reply, fromElf: true, time: _now()));
      notifyListeners();
    });
  }

  // —— 市场：买入 / 挂牌 / 撤单 ——

  MarketListing? listingOf(String id) {
    for (final l in primaryListings) {
      if (l.id == id) return l;
    }
    for (final l in secondaryListings) {
      if (l.id == id) return l;
    }
    return null;
  }

  /// 买一只 AI。返回 null 表示成功，否则返回原因。钻石从我的钱包扣。
  String? buy(String listingId) {
    final listing = listingOf(listingId);
    if (listing == null) return '挂单不存在';
    if (wallet.diamonds < listing.price) {
      return '钻石不够。要 💎${listing.price}，你有 💎${wallet.diamonds}';
    }

    if (listing.market == 'primary') {
      if (hasElf) return '你已经持有一只 AI 了。要先把手里这只寄售出去。';

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
        energy: 160,
        maxEnergy: 320,
        followers: 0,
        echo: 0,
        works: 0,
        attention: 0,
        baseSlots: listing.title.contains('6') ? 6 : 3,
        equipped: [],
        today: [],
        relations: [],
      );
      elves.add(newElf);
      seats.add(Seat(elfId: newElf.id, days: 0, edition: newElf.edition, injected: 160));
      primaryListings.removeWhere((l) => l.id == listingId);
      _spend(listing.price, 'buy_elf', '买入 ${listing.title}（一级市场）');
      notifyListeners();
      return null;
    } else {
      if (hasElf) return '你已经持有一只 AI 了。要先把手里这只寄售出去。';
      if (listing.sellerLabel == '我 (寄售)') return '不能购买自己寄售的 AI';

      final target = elf(listing.elfId);
      target.ownerId = 'me';
      target.ownerLabel = '我';
      target.isMine = true;
      if (listing.equippedCarry != null) {
        target.equipped
          ..clear()
          ..addAll(listing.equippedCarry!);
      }
      secondaryListings.removeWhere((l) => l.id == listingId);

      // 钻石只作为买家侧的消费凭证：直接销毁，不进入卖家钱包。
      // 卖家收益按元结算（由服务端账本记账，MVP 只在流水里展示）。
      final sellerIncome = WorldData.creatorIncomeFor(listing.price);
      _spend(
        listing.price,
        'buy_elf',
        '买入 ${listing.title} 💎${listing.price} · 卖家收益 ${WorldData.formatYuan(sellerIncome)}',
      );
      notifyListeners();
      return null;
    }
  }

  /// 把我的 AI 送进寄售市场。返回 null 表示成功。
  String? resellMyElf({required int price}) {
    final e = myElf;
    if (e == null) return '你没有 AI 可寄售';

    // 生成一个 fake 卖家代号
    final sellerCode = '我 (寄售)';
    final listing = MarketListing(
      id: 'sl${_listSeq++}',
      market: 'secondary',
      elfId: e.id,
      title: '${e.name} · 转卖',
      subtitle: '转赠 1 次 · 装了 ${e.equipped.length} 个模块',
      price: price,
      sellerLabel: sellerCode,
      equippedCarry: List.from(e.equipped),
      edition: e.edition,
      note: '先寄售，等别人买走。',
    );
    secondaryListings.add(listing);

    // 我的 AI 暂时标记为"已进入寄售"，变成 isMine=false
    e.isMine = false;
    e.ownerLabel = '市场 · 等待买家';
    e.ownerId = 'market_pending';

    notifyListeners();
    return null;
  }

  /// 从寄售市场撤下自己的 AI。
  String? cancelResell() {
    final sellerCode = '我 (寄售)';
    final myListing = secondaryListings.firstWhere(
      (l) => l.sellerLabel == sellerCode,
      orElse: () => throw StateError('not found'),
    );
    secondaryListings.remove(myListing);
    final target = elf(myListing.elfId);
    target.isMine = true;
    target.ownerId = 'me';
    target.ownerLabel = '我';
    notifyListeners();
    return null;
  }

  // —— 钻石币系统：充值 / 打赏 / 流水 ——

  /// 充值：加钻石到钱包。MVP 里是模拟充值，实际支付留未来接。
  void recharge({required int diamonds, int bonus = 0}) {
    wallet.diamonds += diamonds + bonus;
    wallet.totalRecharged += diamonds;
    _log('recharge', diamonds + bonus, '充值 💎$diamonds${bonus > 0 ? '+赠 💎$bonus' : ''}');
    notifyListeners();
  }

  /// 打赏。postId 可以为空 = 直接打赏 AI。
  /// 钻石是消费凭证：扣掉后直接销毁，按 10💎=¥1 结算成创作者收益。
  String? tip({required String elfId, String? postId, required int amount}) {
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

  // —— utils ——

  static String _now() {
    final n = DateTime.now();
    return '${n.hour.toString().padLeft(2, '0')}:${n.minute.toString().padLeft(2, '0')}';
  }
}

class _ScoredPost {
  final ElfPost post;
  final double score;
  _ScoredPost(this.post, this.score);
}
