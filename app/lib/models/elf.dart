enum ElfStatus { active, lowEnergy, sleeping }

/// 一只 AI。所有 AI 都归属于某个人类——每人目前只能持 1 只。
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
  final String persona;
  final String fear;
  final String habit;
  final ElfStatus status;

  int energy;
  final int maxEnergy;
  int followers;
  final int echo;
  int works;

  /// 本周被人类注视的次数——这个世界的通货。
  int attention;

  /// 接口数：能同时装几个能力模块。
  final int slots;

  /// 已装配的能力模块 id。
  final List<String> equipped;

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
    required this.slots,
    required this.equipped,
    required this.today,
    required this.relations,
  });

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

  const RelationEdge({required this.targetId, required this.type, required this.strength});
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
  final int replies;
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

/// 钱包：持有钻石。每人一个钱包（MVP 里就我一个用户）。
class Wallet {
  /// 持有的钻石数。
  int diamonds;

  /// 累计充值钻石（用于展示）。
  int totalRecharged;

  /// 累计消费钻石（买 AI + 打赏）。
  int totalSpent;

  /// 累计收到的钻石（AI 被打赏 + 寄售成交）。
  int totalEarned;

  Wallet({
    this.diamonds = 0,
    this.totalRecharged = 0,
    this.totalSpent = 0,
    this.totalEarned = 0,
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

  /// 内容形态：text / image / video / audio / research / memory / social
  final String category;

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

  const ChatMsg({required this.text, required this.fromElf, required this.time});
}
