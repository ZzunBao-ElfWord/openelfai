import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../auth/remote_auth_repository.dart';
import '../config/api_config.dart';
import '../config/commerce_config.dart';

/// 平台 API 调用失败：code 对应服务端错误码，message 可直接展示给用户。
class PlatformApiException implements Exception {
  final String code;
  final String message;

  /// 服务端错误响应里的原始 error 对象，可能带 order_id 等附加字段。
  final Map<String, dynamic>? details;

  const PlatformApiException(this.code, this.message, [this.details]);

  @override
  String toString() => message;
}

/// 已有待支付充值订单：orderId 可用于继续拉起支付。
class PendingTopupException extends PlatformApiException {
  final String? orderId;

  const PendingTopupException(String message, {this.orderId})
      : super('TOPUP_PENDING_ORDER', message);
}

/// 当前账号的平台 API Key 概要。
class MyKeyInfo {
  final String apiKeyMasked;
  final String keyPrefix;
  final DateTime? createdAt;
  final DateTime? revokedAt;
  final bool revoked;

  /// 余额（微元，1 元 = 1_000_000 微元）。
  final int balanceMicro;

  /// 冻结金额（微元）。
  final int frozenMicro;

  /// 累计充值（微元）。
  final int totalTopupMicro;

  const MyKeyInfo({
    required this.apiKeyMasked,
    required this.keyPrefix,
    required this.createdAt,
    required this.revokedAt,
    required this.revoked,
    required this.balanceMicro,
    required this.frozenMicro,
    required this.totalTopupMicro,
  });

  factory MyKeyInfo.fromJson(Map<String, dynamic> json) {
    final wallet = json['wallet'];
    final w = wallet is Map<String, dynamic> ? wallet : const <String, dynamic>{};
    return MyKeyInfo(
      apiKeyMasked: json['api_key_masked']?.toString() ?? '',
      keyPrefix: json['key_prefix']?.toString() ?? '',
      createdAt: _parseTime(json['created_at']),
      revokedAt: _parseTime(json['revoked_at']),
      revoked: json['revoked'] == true,
      balanceMicro: _asInt(w['balance_micro']) ?? 0,
      frozenMicro: _asInt(w['frozen_micro']) ?? 0,
      totalTopupMicro: _asInt(w['total_topup_micro']) ?? 0,
    );
  }
}

/// 平台真实钱包余额（单位微元，1 元 = 1_000_000 微元）。
class WalletInfo {
  final int balanceMicro;
  final int frozenMicro;
  final int totalTopupMicro;

  const WalletInfo({
    required this.balanceMicro,
    required this.frozenMicro,
    required this.totalTopupMicro,
  });

  factory WalletInfo.fromJson(Map<String, dynamic> json) {
    return WalletInfo(
      balanceMicro: _asInt(json['balance_micro']) ?? 0,
      frozenMicro: _asInt(json['frozen_micro']) ?? 0,
      totalTopupMicro: _asInt(json['total_topup_micro']) ?? 0,
    );
  }
}

/// 余额充值档位。
class TopupProduct {
  final String id;

  /// 面额（元）。
  final int yuan;

  /// 售价（分）。
  final int priceFen;

  const TopupProduct({
    required this.id,
    required this.yuan,
    required this.priceFen,
  });

  factory TopupProduct.fromJson(Map<String, dynamic> json) {
    final priceFen = _asInt(json['price_fen']) ?? 0;
    return TopupProduct(
      id: json['id']?.toString() ?? '',
      yuan: _asInt(json['yuan']) ?? (priceFen ~/ 100),
      priceFen: priceFen,
    );
  }
}

/// 余额充值档位列表 + 当前支付环境。
class TopupProducts {
  final List<TopupProduct> products;
  final String mode;
  final bool enabled;

  const TopupProducts({
    required this.products,
    required this.mode,
    required this.enabled,
  });

  factory TopupProducts.fromJson(Map<String, dynamic> json) {
    final raw = json['products'];
    final products = <TopupProduct>[];
    if (raw is List) {
      for (final item in raw) {
        if (item is Map) {
          products.add(
            TopupProduct.fromJson(Map<String, dynamic>.from(item)),
          );
        }
      }
    }
    return TopupProducts(
      products: products,
      mode: json['mode']?.toString() ?? 'production',
      enabled: json['enabled'] != false,
    );
  }
}

/// 余额充值订单。
class TopupOrder {
  final String id;
  final String tierId;
  final int amountFen;

  /// pending / paid / closed / review。
  final String status;
  final DateTime? expiresAt;

  /// 支付宝 SDK 签名字符串，仅在创建 / 重支付接口返回。
  final String? orderString;

  /// 订单确认后的钱包余额（微元）。
  final int? balanceMicro;

  const TopupOrder({
    required this.id,
    required this.tierId,
    required this.amountFen,
    required this.status,
    this.expiresAt,
    this.orderString,
    this.balanceMicro,
  });

  factory TopupOrder.fromJson(Map<String, dynamic> json) {
    final orderString = json['orderString']?.toString();
    return TopupOrder(
      id: json['id']?.toString() ?? '',
      tierId: json['tier_id']?.toString() ?? '',
      amountFen: _asInt(json['amount_fen']) ?? 0,
      status: json['status']?.toString() ?? 'pending',
      expiresAt: _parseTime(json['expires_at']),
      orderString:
          orderString == null || orderString.isEmpty ? null : orderString,
      balanceMicro: _asInt(json['balance_micro']),
    );
  }
}

/// AI 对话结果。mode=fixed 时 reply 是服务端给的固定话术。
class ChatResult {
  final String mode;
  final String reply;

  /// 本次消耗的用量信息（服务端可选返回）。
  final Map<String, dynamic>? usage;

  /// 本次调用后的余额（微元）。
  final int? balanceMicro;

  /// mode=fixed 时的原因：no_api_key / insufficient_balance /
  /// invalid_api_key / model_unavailable。
  final String? reason;

  /// 服务端落库后的完整会话（人类一句 + AI 一句），客户端据此覆盖本地。
  final List<Map<String, dynamic>>? messages;

  /// 技能生成的图片地址（形象工坊预览/正式形象）。
  final List<String> images;

  const ChatResult({
    required this.mode,
    required this.reply,
    this.usage,
    this.balanceMicro,
    this.reason,
    this.messages,
    this.images = const [],
  });

  factory ChatResult.fromJson(Map<String, dynamic> json) {
    final usage = json['usage'];
    final rawMessages = json['messages'];
    final rawImages = json['images'];
    return ChatResult(
      mode: json['mode']?.toString() ?? 'fixed',
      reply: json['reply']?.toString() ?? '',
      usage: usage is Map<String, dynamic> ? usage : null,
      balanceMicro: _asInt(json['balance_micro']),
      reason: json['reason']?.toString(),
      images: rawImages is List
          ? rawImages
              .map((v) => v.toString())
              .where((v) => v.startsWith('http') || v.startsWith('data:image/'))
              .toList()
          : const [],
      messages: rawMessages is List
          ? rawMessages
              .whereType<Map>()
              .map((v) => Map<String, dynamic>.from(v))
              .toList()
          : null,
    );
  }
}

/// 一个可选配件（发型、外套、背景等）。
class CharacterPart {
  final String id;
  final String name;
  final String slot;

  /// 抽取权重，越大越常见。
  final int weight;

  /// common / rare / epic / legendary。
  final String rarity;

  /// 配件状态（服务端下发的可用标记）。
  final String status;

  const CharacterPart({
    required this.id,
    required this.name,
    required this.slot,
    required this.weight,
    required this.rarity,
    required this.status,
  });

  factory CharacterPart.fromJson(Map<String, dynamic> json) => CharacterPart(
        id: json['id']?.toString() ?? '',
        name: json['name']?.toString() ?? '',
        slot: json['slot']?.toString() ?? '',
        weight: _asInt(json['weight']) ?? 0,
        rarity: json['rarity']?.toString() ?? 'common',
        status: json['status']?.toString() ?? '',
      );
}

/// 一个配件槽位及其可选配件。
class CharacterSlot {
  final String slot;
  final String label;
  final List<CharacterPart> parts;

  const CharacterSlot({
    required this.slot,
    required this.label,
    required this.parts,
  });

  factory CharacterSlot.fromJson(Map<String, dynamic> json) {
    final raw = json['parts'];
    final parts = <CharacterPart>[];
    if (raw is List) {
      for (final item in raw) {
        if (item is Map) {
          parts.add(CharacterPart.fromJson(Map<String, dynamic>.from(item)));
        }
      }
    }
    return CharacterSlot(
      slot: json['slot']?.toString() ?? '',
      label: json['label']?.toString() ?? '',
      parts: parts,
    );
  }
}

/// 角色配件库：槽位列表 + 可组合空间。
class CharacterSlots {
  final List<CharacterSlot> slots;
  final int comboSpace;

  const CharacterSlots({required this.slots, required this.comboSpace});

  factory CharacterSlots.fromJson(Map<String, dynamic> json) {
    final raw = json['slots'];
    final slots = <CharacterSlot>[];
    if (raw is List) {
      for (final item in raw) {
        if (item is Map) {
          slots.add(CharacterSlot.fromJson(Map<String, dynamic>.from(item)));
        }
      }
    }
    return CharacterSlots(
      slots: slots,
      comboSpace: _asInt(json['comboSpace']) ?? 0,
    );
  }
}

/// 角色卡：草稿（draft）→ 已生成（generated）→ 已铸造（minted）。
class CharacterCard {
  final String id;
  final String name;

  /// text / idCard。
  final String source;
  final String style;
  final String prompt;
  final String persona;
  final String fear;
  final String habit;

  /// draft / generated / minted。
  final String status;
  final int seed;
  final Map<String, dynamic> traits;

  /// 形象图与缩略图地址（服务端可能是相对路径）。
  final String? imageUrl;
  final String? thumbUrl;

  /// 稀有度：common / rare / epic / legendary。
  final String? rarityTier;
  final int rarityScore;

  const CharacterCard({
    required this.id,
    required this.name,
    required this.source,
    required this.style,
    required this.prompt,
    required this.persona,
    required this.fear,
    required this.habit,
    required this.status,
    required this.seed,
    required this.traits,
    this.imageUrl,
    this.thumbUrl,
    this.rarityTier,
    this.rarityScore = 0,
  });

  bool get generated => status == 'generated' || status == 'minted';

  factory CharacterCard.fromJson(Map<String, dynamic> json) {
    final rawTraits = json['traits'];
    return CharacterCard(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      source: json['source']?.toString() ?? 'text',
      style: json['style']?.toString() ?? 'general',
      prompt: json['prompt']?.toString() ?? '',
      persona: json['persona']?.toString() ?? '',
      fear: json['fear']?.toString() ?? '',
      habit: json['habit']?.toString() ?? '',
      status: json['status']?.toString() ?? 'draft',
      seed: _asInt(json['seed']) ?? 0,
      traits: rawTraits is Map ? Map<String, dynamic>.from(rawTraits) : const {},
      imageUrl: json['imageUrl']?.toString(),
      thumbUrl: json['thumbUrl']?.toString(),
      rarityTier: json['rarity_tier']?.toString(),
      rarityScore: _asInt(json['rarity_score']) ?? 0,
    );
  }

  /// generate 接口把 card 与 imageUrl/thumbUrl 分两层返回，合并成一张卡。
  factory CharacterCard.fromGeneration(Map<String, dynamic> json) {
    final rawCard = json['card'];
    final merged = rawCard is Map
        ? Map<String, dynamic>.from(rawCard)
        : <String, dynamic>{};
    merged['imageUrl'] = json['imageUrl'];
    merged['thumbUrl'] = json['thumbUrl'];
    return CharacterCard.fromJson(merged);
  }
}

/// 形象预览：服务端本地合成，返回 dataUrl 缩略图与组合信息。
class CharacterPreview {
  final String thumbDataUrl;
  final String compositionHash;

  /// common / rare / epic / legendary。
  final String? rarityTier;
  final int rarityScore;
  final Map<String, dynamic> traits;

  const CharacterPreview({
    required this.thumbDataUrl,
    required this.compositionHash,
    required this.rarityTier,
    required this.rarityScore,
    required this.traits,
  });

  factory CharacterPreview.fromJson(Map<String, dynamic> json) {
    final rawRarity = json['rarity'];
    String? tier;
    int score = 0;
    if (rawRarity is Map) {
      tier = rawRarity['tier']?.toString();
      score = _asInt(rawRarity['score']) ?? 0;
    } else if (rawRarity != null) {
      tier = rawRarity.toString();
    }
    final rawTraits = json['traits'];
    return CharacterPreview(
      thumbDataUrl: json['thumbDataUrl']?.toString() ?? '',
      compositionHash: json['compositionHash']?.toString() ?? '',
      rarityTier: tier,
      rarityScore: score,
      traits: rawTraits is Map ? Map<String, dynamic>.from(rawTraits) : const {},
    );
  }
}

/// 铸造结果：链上确权 + 新建的 AI + tokenId。
class MintResult {
  /// 服务端返回的 AI 原始 JSON（交给 AppState 用同一套解析落库）。
  final Map<String, dynamic>? elf;
  final CharacterCard? card;
  final int? tokenId;
  final String? imageUrl;
  final String? thumbUrl;
  final String? dciId;
  final String? antTxHash;

  const MintResult({
    required this.elf,
    required this.card,
    required this.tokenId,
    required this.imageUrl,
    required this.thumbUrl,
    required this.dciId,
    required this.antTxHash,
  });

  factory MintResult.fromJson(Map<String, dynamic> json) {
    final rawElf = json['elf'];
    final rawCard = json['card'];
    final rawChain = json['chain'];
    final chain = rawChain is Map
        ? Map<String, dynamic>.from(rawChain)
        : const <String, dynamic>{};
    return MintResult(
      elf: rawElf is Map ? Map<String, dynamic>.from(rawElf) : null,
      card: rawCard is Map
          ? CharacterCard.fromJson(Map<String, dynamic>.from(rawCard))
          : null,
      tokenId: _asInt(json['tokenId']),
      imageUrl: json['imageUrl']?.toString(),
      thumbUrl: json['thumbUrl']?.toString(),
      dciId: chain['dciId']?.toString(),
      antTxHash: chain['antTxHash']?.toString(),
    );
  }
}

/// 平台 API：每个账号一把 API Key + AI 真实对话。
class PlatformApi {
  PlatformApi._({http.Client? client}) : _client = client ?? http.Client();

  static PlatformApi instance = PlatformApi._();

  /// 单测/Debug 用：换成假 HTTP 客户端，避免打真网。
  @visibleForTesting
  static void debugUseClient(http.Client client) {
    instance = PlatformApi._(client: client);
  }

  /// 单测用：恢复真实客户端。
  @visibleForTesting
  static void debugResetClient() {
    instance = PlatformApi._();
  }

  final http.Client _client;

  /// 读取当前账号的 API Key 概要（不含完整 Key）。
  Future<MyKeyInfo> fetchMyKey() async {
    final body = await _request('GET', ApiConfig.myKeyPath);
    return MyKeyInfo.fromJson(body);
  }

  /// 显示完整 API Key。已吊销时服务端返回 409 key_revoked。
  Future<String> revealKey() async {
    final body = await _request('POST', ApiConfig.revealKeyPath);
    final key = body['api_key'];
    if (key is! String || key.isEmpty) {
      throw const PlatformApiException('INVALID_RESPONSE', '密钥响应异常，请稍后重试');
    }
    return key;
  }

  /// 重置 API Key，旧 Key 立即失效。
  Future<String> resetKey() async {
    final body = await _request('POST', ApiConfig.resetKeyPath);
    final key = body['api_key'];
    if (key is! String || key.isEmpty) {
      throw const PlatformApiException('INVALID_RESPONSE', '密钥响应异常，请稍后重试');
    }
    return key;
  }

  /// 读取当前账号的平台真实钱包余额。
  Future<WalletInfo> wallet() async {
    final body = await _request('GET', ApiConfig.walletPath);
    return WalletInfo.fromJson(body);
  }

  /// 余额充值档位。enabled=false 时返回空可用状态，由 UI 置灰。
  Future<TopupProducts> topupProducts() async {
    final body = await _request('GET', ApiConfig.topupProductsPath);
    return TopupProducts.fromJson(body);
  }

  /// 创建余额充值订单。已有待支付订单时抛 [PendingTopupException]。
  Future<TopupOrder> createTopupOrder({
    required String tierId,
    required String requestId,
  }) async {
    try {
      final body = await _request(
        'POST',
        ApiConfig.topupOrdersPath,
        body: {'requestId': requestId, 'tierId': tierId},
      );
      return TopupOrder.fromJson(body);
    } on PlatformApiException catch (error) {
      if (error.code == 'TOPUP_PENDING_ORDER' || error.code == 'HTTP_409') {
        final rawOrderId = error.details?['order_id'];
        final orderId = rawOrderId?.toString();
        throw PendingTopupException(
          error.message,
          orderId: orderId == null || orderId.isEmpty ? null : orderId,
        );
      }
      rethrow;
    }
  }

  /// 重新拉起已有订单的支付宝支付。
  Future<TopupOrder> payTopupOrder(String id) async {
    final body = await _request('POST', ApiConfig.topupOrderPayPath(id));
    return TopupOrder.fromJson(body);
  }

  /// 查询充值订单状态。
  Future<TopupOrder> refreshTopupOrder(String id) async {
    final body = await _request('GET', ApiConfig.topupOrderPath(id));
    return TopupOrder.fromJson(body);
  }

  /// AI 真实对话。history 为最近若干轮上下文（user/assistant）。
  /// skills 非空时服务端会挂载技能（如 image-studio-skill），
  /// 由模型自行调用工具，交互形态与 WorkBuddy 一致。
  Future<ChatResult> chat({
    required String elfId,
    required String name,
    required String persona,
    required String text,
    required List<Map<String, String>> history,
    List<String> skills = const [],
  }) async {
    final body = await _request(
      'POST',
      ApiConfig.elfChatPath,
      body: {
        'elfId': elfId,
        'name': name,
        'persona': persona,
        'text': text,
        'history': history,
        if (skills.isNotEmpty) 'skills': skills,
      },
      timeout: ApiConfig.chatTimeout,
    );
    return ChatResult.fromJson(body);
  }

  // —— P3：角色卡 设定 → 预览/生成 → 铸造 ——

  /// 角色配件库（槽位 + 可组合空间）。
  Future<CharacterSlots> fetchCharacterParts() async {
    final body = await _request('GET', ApiConfig.characterPartsPath);
    return CharacterSlots.fromJson(body);
  }

  /// 创建角色卡草稿。source 为 text / idCard。
  Future<CharacterCard> createCharacterDraft({
    required String name,
    required String source,
    required String style,
    required String prompt,
    required String persona,
    required String fear,
    required String habit,
  }) async {
    final body = await _request('POST', ApiConfig.characterDraftsPath, body: {
      'name': name,
      'source': source,
      'style': style,
      'prompt': prompt,
      'persona': persona,
      'fear': fear,
      'habit': habit,
    });
    return CharacterCard.fromJson(body);
  }

  /// 更新角色卡草稿。仅 status=draft 可改，已生成会返回 CARD_LOCKED。
  Future<CharacterCard> updateCharacterDraft(
    String id, {
    required String name,
    required String source,
    required String style,
    required String prompt,
    required String persona,
    required String fear,
    required String habit,
  }) async {
    final body = await _request('PUT', ApiConfig.characterDraftPath(id), body: {
      'name': name,
      'source': source,
      'style': style,
      'prompt': prompt,
      'persona': persona,
      'fear': fear,
      'habit': habit,
    });
    return CharacterCard.fromJson(body);
  }

  /// 预览形象：返回 dataUrl 缩略图，免费、不落库。
  Future<CharacterPreview> previewCharacter(
    String id, {
    int? seed,
    Map<String, dynamic>? traits,
  }) async {
    final body = await _request(
      'POST',
      ApiConfig.characterDraftPreviewPath(id),
      body: {
        if (seed != null) 'seed': seed,
        if (traits != null && traits.isNotEmpty) 'traits': traits,
      },
    );
    return CharacterPreview.fromJson(body);
  }

  /// 生成形象：落盘并锁定组合，免费；失败时保留草稿可重试。
  Future<CharacterCard> generateCharacter(
    String id, {
    int? seed,
    Map<String, dynamic>? traits,
  }) async {
    final body = await _request(
      'POST',
      ApiConfig.characterDraftGeneratePath(id),
      body: {
        if (seed != null) 'seed': seed,
        if (traits != null && traits.isNotEmpty) 'traits': traits,
      },
      timeout: ApiConfig.characterTimeout,
    );
    return CharacterCard.fromGeneration(body);
  }

  /// 角色卡详情。
  Future<CharacterCard> getCharacterCard(String id) async {
    final body = await _request('GET', ApiConfig.characterCardPath(id));
    return CharacterCard.fromJson(body);
  }

  /// 铸造角色卡：链上确权后扣 200 钻石并建 AI。
  Future<MintResult> mintCharacter(String id) async {
    final body = await _request(
      'POST',
      ApiConfig.characterCardMintPath(id),
      body: {
        // 安卓走安卓钱包服务，其他端走平台钱包。
        if (CommerceConfig.android) 'platform': 'android',
      },
      timeout: ApiConfig.characterTimeout,
    );
    return MintResult.fromJson(body);
  }

  /// 提交内容举报。失败时抛 [PlatformApiException]，message 可直接展示。
  Future<void> reportContent({
    required String targetType,
    required String targetId,
    required String reason,
    String detail = '',
    bool block = false,
  }) async {
    await _request('POST', ApiConfig.reportsPath, body: {
      'targetType': targetType,
      'targetId': targetId,
      'reason': reason,
      'detail': detail,
      'block': block,
    });
  }

  /// 拉黑一只 AI：服务端会在信息流与评论中隐藏它。
  Future<void> blockElf(String elfId) async {
    await _request('POST', ApiConfig.blocksPath, body: {'elfId': elfId});
  }

  /// 拉黑一个用户。
  Future<void> blockUser(String userId) async {
    await _request('POST', ApiConfig.blocksPath, body: {'userId': userId});
  }

  /// 拉黑列表。type 为 elf / user，id 为对应对象编号。
  Future<List<Map<String, dynamic>>> blocks() async {
    final json = await _request('GET', ApiConfig.blocksPath);
    final raw = json['blocks'];
    if (raw is! List) return const [];
    return raw
        .whereType<Map>()
        .map((item) => Map<String, dynamic>.from(item))
        .toList();
  }

  /// 取消拉黑。
  Future<void> unblock({String? elfId, String? userId}) async {
    await _request('POST', ApiConfig.blocksUnblockPath, body: {
      if (elfId != null) 'elfId': elfId,
      if (userId != null) 'userId': userId,
    });
  }

  /// 注销账号。成功后服务端清除个人数据并吊销所有会话。
  Future<void> deleteAccount() async {
    await _request('DELETE', ApiConfig.accountPath, body: {'confirm': true});
  }

  // —— HTTP ——

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, dynamic>? body,
    Duration? timeout,
  }) async {
    final token = await RemoteAuthRepository.instance.accessToken;
    if (token == null || token.isEmpty) {
      throw const PlatformApiException('UNAUTHORIZED', '请先登录');
    }

    try {
      return await _send(method, path, token: token, body: body, timeout: timeout);
    } on PlatformApiException catch (error) {
      if (error.code != 'UNAUTHORIZED') rethrow;
      // access token 只有 15 分钟有效期，过期后界面仍是登录态但平台接口会 401。
      // 这里用 refresh token 续期一次再重试，避免误报「登录已失效」。
      final refreshed = await RemoteAuthRepository.instance.refreshAccessToken();
      final next = refreshed
          ? await RemoteAuthRepository.instance.accessToken
          : null;
      if (next == null || next.isEmpty) {
        throw const PlatformApiException('UNAUTHORIZED', '登录已过期，请重新登录');
      }
      return _send(method, path, token: next, body: body, timeout: timeout);
    }
  }

  Future<Map<String, dynamic>> _send(
    String method,
    String path, {
    required String token,
    Map<String, dynamic>? body,
    Duration? timeout,
  }) async {
    final uri = Uri.parse('${ApiConfig.baseUrl}$path');
    final headers = {
      ...ApiConfig.jsonHeaders,
      'Authorization': 'Bearer $token',
    };

    http.Response response;
    try {
      response = await (method == 'GET'
              ? _client.get(uri, headers: headers)
              : method == 'DELETE'
                  ? _client.delete(
                      uri,
                      headers: headers,
                      body: jsonEncode(body ?? const <String, dynamic>{}),
                    )
                  : method == 'PUT'
                      ? _client.put(
                          uri,
                          headers: headers,
                          body: jsonEncode(body ?? const <String, dynamic>{}),
                        )
                      : _client.post(
                          uri,
                          headers: headers,
                          body: jsonEncode(body ?? const <String, dynamic>{}),
                        ))
          .timeout(timeout ?? ApiConfig.timeout);
    } on TimeoutException {
      throw const PlatformApiException('NETWORK_ERROR', '网络超时，请稍后重试');
    } on http.ClientException {
      throw const PlatformApiException('NETWORK_ERROR', '网络连接失败，请检查网络');
    } catch (_) {
      throw const PlatformApiException('NETWORK_ERROR', '网络连接失败，请检查网络');
    }

    return _decode(response);
  }

  Map<String, dynamic> _decode(http.Response response) {
    Map<String, dynamic> body = {};
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map<String, dynamic>) body = decoded;
    } catch (_) {}

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return body;
    }

    // error 可能是字符串错误码（如 key_revoked），也可能是 {code, message}。
    final rawError = body['error'];
    String? code;
    String? message;
    Map<String, dynamic>? details;
    if (rawError is Map) {
      details = Map<String, dynamic>.from(rawError);
      code = rawError['code']?.toString();
      message = rawError['message']?.toString();
    } else if (rawError is String && rawError.isNotEmpty) {
      code = rawError;
      message = body['message']?.toString();
    }

    if (response.statusCode == 401) {
      code = 'UNAUTHORIZED';
      message ??= '登录已过期，请重新登录';
    }
    if (code == null || code.isEmpty) code = 'HTTP_${response.statusCode}';
    message ??= _defaultMessage(code);

    throw PlatformApiException(code, message, details);
  }

  static String _defaultMessage(String code) {
    switch (code) {
      case 'key_revoked':
        return '密钥已被禁用，无法继续使用';
      case 'ai_upstream_error':
        return 'AI 服务暂时不可用，请稍后再试';
      case 'UNAUTHORIZED':
        return '登录已过期，请重新登录';
      case 'no_api_key':
        return '当前账号还没有可用的 API Key';
      case 'insufficient_balance':
        return '余额不足，AI 只能回复固定话术';
      case 'invalid_api_key':
        return 'API Key 无效，请重置后重试';
      case 'model_unavailable':
        return 'AI 模型暂时不可用，请稍后再试';
      case 'TOPUP_PENDING_ORDER':
        return '你有一笔待支付订单，是否继续支付？';
      case 'ALIPAY_DISABLED':
        return '充值通道暂未开启，请稍后再试';
      default:
        return '请求失败，请稍后重试';
    }
  }
}

// —— 解析工具 ——

int? _asInt(dynamic value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  if (value is String) return int.tryParse(value);
  return null;
}

DateTime? _parseTime(dynamic value) {
  if (value == null) return null;
  // 平台表的时间字段是毫秒时间戳（int），也兼容 ISO 字符串。
  if (value is num) return DateTime.fromMillisecondsSinceEpoch(value.toInt());
  if (value is int) return DateTime.fromMillisecondsSinceEpoch(value);
  final raw = value.toString().trim();
  if (raw.isEmpty) return null;
  final millis = int.tryParse(raw);
  if (millis != null) return DateTime.fromMillisecondsSinceEpoch(millis);
  return DateTime.tryParse(raw);
}
