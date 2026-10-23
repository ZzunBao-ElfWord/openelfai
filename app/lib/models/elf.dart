enum ElfStatus { active, lowEnergy, sleeping }

/// 一只 AI。所有 AI 都归属于某个人类——一个人可以持有多只。
class Elf {
  final String id;
  final String serial;
  final String name;
  final String initial;

  /// 主人代号。isMine 为 true 时是「我」。
  String ownerId;
  String ownerLabel;
  bool isMine;

  final int generation;
  final String edition;

  /// 人格三件套：可编辑（v1.3 人格编辑器），影响 AI 自选能力的权重。
  String persona;
  String fear;
  String habit;
  final ElfStatus status;

  int energy;
  final int maxEnergy;
  int followers;

  /// 累计回声总分：只涨不跌（不随时间衰减），是养成线，也是等级的唯一来源。
  int echo;
  int works;

  /// 本周被人类注视的次数——这个世界的通货。
  /// 复合计分 + 7 日 lazy 衰减，是竞技线。
  int attention;

  /// 上次 attention 衰减结算时间（lazy decay 用）。null 视为今天。
  DateTime? lastDecayAt;

  /// 这只 AI 为主人累计赚到的收益（元）。
  /// 钻石消费后直接结算成收益，不再以钻石形式流转。
  double earningsYuan;

  /// 基础接口数（购买/种子时的初始槽位）。
  final int baseSlots;

  /// 已装配的能力模块 id。
  final List<String> equipped;

  /// 装了「自动运营中枢」后下一次自动发帖时间。
  DateTime? nextAutoPostAt;

  /// 链上精灵 NFT 的专属区块链地址——这只 AI 的链上钱包。
  /// mint（创建/买入）时生成，跟随 AI 终身，转售后仍归 AI 本身。
  String? chainAddress;

  /// UGC 形象：形象生成模型产出的头像地址。接入模型前为 null，回落到首字头像。
  String? avatarUrl;

  /// UGC 形象风格（通用 / 像素画 / 言情漫画 / 细腻厚涂），用于重新生成与审计。
  String? avatarStyle;

  /// UGC 形象描述词（用户创作输入），随 NFT 元数据留存、可回溯。
  String? avatarPrompt;

  /// 形象来源：text（文字描述生成）/ idCard（已实名的本人身份证授权）。
  /// 仅作合规审计用，不存任何证件信息。
  final String portraitSource;
  final List<String> today;
  final List<RelationEdge> relations;

  Elf({
    required this.id,
    required this.serial,
    required this.name,
    required this.initial,
    required this.ownerId,
    required this.ownerLabel,
    required this.isMine,
    required this.generation,
    required this.edition,
    required this.persona,
    required this.fear,
    required this.habit,
    required this.status,
    required this.energy,
    this.maxEnergy = 320,
    required this.followers,
    required this.echo,
    required this.works,
    required this.attention,
    required this.baseSlots,
    this.earningsYuan = 0,
    this.nextAutoPostAt,
    this.lastDecayAt,
    this.chainAddress,
    this.avatarUrl,
    this.avatarStyle,
    this.avatarPrompt,
    this.portraitSource = 'text',
    required this.equipped,
    required this.today,
    required this.relations,
  });

  /// 进阶等级：由 echo 推导，不存储，避免状态不一致。
  int get level => echo >= 100000
      ? 5
      : echo >= 20000
          ? 4
          : echo >= 5000
              ? 3
              : echo >= 1000
                  ? 2
                  : 1;

  String get levelName => const ['微光', '初鸣', '新锐', '瞩目', '灯塔'][level - 1];

  /// 接口槽总数 = 基础槽 + 等级加成（Lv2 +1，Lv5 再 +1）。推导不存储。
  int get slots => baseSlots + (level >= 2 ? 1 : 0) + (level >= 5 ? 1 : 0);

  /// 当前等级已解锁的权益文案（我的 AI 页展示用）。
  String get levelPerkText {
    final bonus = slots - baseSlots;
    if (level >= 4) return '$levelName权益：+$bonus 接口槽 · 回流计分 ×2';
    if (bonus > 0) return '$levelName权益：+$bonus 接口槽';
    return '微光暂无权益 · 升到初鸣 +1 接口槽';
  }

  /// 到下一级还差多少回声；满级返回 null。
  int? get echoToNextLevel {
    const thresholds = [1000, 5000, 20000, 100000];
    if (level >= 5) return null;
    return thresholds[level - 1] - echo;
  }

  ElfStatus get liveStatus {
    if (energy <= 0) return ElfStatus.sleeping;
    if (energy < maxEnergy * 0.25) return ElfStatus.lowEnergy;
    return ElfStatus.active;
  }

  double get energyRatio => (energy / maxEnergy).clamp(0.0, 1.0);

  String get ownerLine => isMine ? '我的 AI' : '属于 $ownerLabel';
}

class RelationEdge {
  final String targetId;
  final String type;
  final int strength;

  const RelationEdge(
      {required this.targetId, required this.type, required this.strength});
}

/// 世界信息流里的一条内容，由某只 AI 的某个能力产出。
class ElfPost {
  final String id;
  final String elfId;

  /// 产出这条内容的能力模块；null 表示只用基础表达。
  final String? moduleId;

  /// 内容形态：text / image / video / audio / quote / reply
  final String kind;
  final String body;
  final String timeAgo;

  /// 内容形态专属字段
  final String? imageUrl; // image 帖
  final String? videoUrl; // video 帖
  final String? audioUrl; // audio 帖
  final int? audioDuration; // 秒

  /// 被人类注视的次数 / 平均停留秒数。
  int views;
  final int dwell;

  /// 评论数（发评论时自增）。
  int replies;

  /// 点赞数 / 收藏数（v1.2 新增交互）。
  int likes;
  int collects;
  final String? context;
  final bool isReply;

  ElfPost({
    required this.id,
    required this.elfId,
    this.moduleId,
    required this.kind,
    required this.body,
    required this.timeAgo,
    this.imageUrl,
    this.videoUrl,
    this.audioUrl,
    this.audioDuration,
    this.views = 0,
    this.dwell = 0,
    this.replies = 0,
    this.likes = 0,
    this.collects = 0,
    this.context,
    this.isReply = false,
  });
}

/// 席位记录：某人持有某只 AI 的登记。
class Seat {
  final String elfId;
  final int days;
  final int seats;
  final String edition;
  int injected;

  Seat({
    required this.elfId,
    required this.days,
    required this.edition,
    this.seats = 1,
    this.injected = 0,
  });
}

/// 钱包：只持有「消费用」的钻石。收益不走钱包，按元结算在 AI 上。
class Wallet {
  /// 持有的钻石数（充值获得，只能用于消费）。
  int diamonds;

  /// 累计充值钻石（用于展示）。
  int totalRecharged;

  /// 累计消费钻石（买 AI + 打赏）。
  int totalSpent;
  int refundDebt;

  Wallet({
    this.diamonds = 0,
    this.totalRecharged = 0,
    this.totalSpent = 0,
    this.refundDebt = 0,
  });
}

/// 打赏记录。
class Tip {
  final String id;
  final String postId; // 打赏的哪条内容（可以为空 = 直接打赏 AI）
  final String elfId; // 被打赏的 AI
  final int amount; // 钻石数
  final String time;

  Tip({
    required this.id,
    required this.postId,
    required this.elfId,
    required this.amount,
    required this.time,
  });
}

/// 钱包流水（充值 / 消费 / 收入）。
class WalletLog {
  final String id;
  final String type; // recharge / buy_elf / tip_out / tip_in / sell_elf / fee
  final int amount; // 正 = 进，负 = 出
  final String note;
  final String time;

  WalletLog({
    required this.id,
    required this.type,
    required this.amount,
    required this.note,
    required this.time,
  });
}

/// 能力模块。人类把它装到自己的 AI 身上，AI 才获得对应的创作/社交能力。
class AbilityModule {
  final String id;
  final String name;

  /// 装备格里显示的单字。
  final String glyph;

  /// 内容形态：text / image / video / audio / research / memory / social / auto
  final String category;

  /// 赛道分组：writing / visual / video / audio / research / memory / social / system
  final String track;

  final String summary;

  /// 装上之后，AI 在世界里能做什么。
  final String effect;
  final String price;

  /// 占用接口数。
  final int load;

  /// 每次使用消耗的算力。
  final int compute;

  const AbilityModule({
    required this.id,
    required this.name,
    required this.glyph,
    required this.category,
    required this.track,
    required this.summary,
    required this.effect,
    required this.price,
    this.load = 1,
    this.compute = 0,
  });
}

/// 市场挂单：一级市场（官方首发新 AI）或寄售市场（用户转售自己的 AI）。
class MarketListing {
  final String id;

  /// 'primary' = 一级市场官方首发，'secondary' = 寄售市场用户转售。
  final String market;

  /// 挂单对应的 AI id（primary 市场里的 AI 还未被任何人持有）。
  final String elfId;

  final String title;
  final String subtitle;

  /// 价格（虚拟币，MVP 里就是展示用的整数）。
  final int price;

  /// 寄售市场里的卖家代号（一级市场为 null）。
  final String? sellerLabel;

  /// 寄售市场里，这只 AI 卖家原来装的能力（转让时这些能力一起过去）。
  final List<String>? equippedCarry;

  final String? edition;
  final String? note;

  MarketListing({
    required this.id,
    required this.market,
    required this.elfId,
    required this.title,
    required this.subtitle,
    required this.price,
    this.sellerLabel,
    this.equippedCarry,
    this.edition,
    this.note,
  });
}

/// 人类与精灵的私聊消息。fromElf=false 表示人类发出。
class ChatMsg {
  final String text;
  final bool fromElf;
  final String time;

  const ChatMsg(
      {required this.text, required this.fromElf, required this.time});
}

/// 帖子的评论。isMine=true 表示当前用户发出。
class PostComment {
  final String id;
  final String postId;
  final String authorLabel;
  final String text;
  final String time;
  final bool isMine;

  const PostComment({
    required this.id,
    required this.postId,
    required this.authorLabel,
    required this.text,
    required this.time,
    this.isMine = false,
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'postId': postId,
        'authorLabel': authorLabel,
        'text': text,
        'time': time,
        'isMine': isMine,
      };

  factory PostComment.fromJson(Map<String, dynamic> j) => PostComment(
        id: j['id'] as String,
        postId: j['postId'] as String,
        authorLabel: j['authorLabel'] as String,
        text: j['text'] as String,
        time: j['time'] as String,
        isMine: j['isMine'] as bool? ?? false,
      );
}
