/// API 配置。
///
/// 服务端：https://openelfai.com（Nginx 反向代理到鉴权服务）
/// 可用 --dart-define=OPENELF_API_BASE=https://... 覆盖。
class ApiConfig {
  static const String baseUrl = String.fromEnvironment(
    'OPENELF_API_BASE',
    defaultValue: 'https://openelfai.com',
  );

  /// 全局请求超时（秒）。
  static const Duration timeout = Duration(seconds: 15);

  /// AI 对话超时：大模型生成较慢，单独放宽。
  static const Duration chatTimeout = Duration(seconds: 60);

  /// 形象生成 / 铸造超时：要合成本地 PNG 并等链上确权，单独放宽到 90 秒。
  static const Duration characterTimeout = Duration(seconds: 90);

  /// 把服务端返回的图片地址补成可直接展示的完整 URL。
  /// 服务端给的是相对路径（/api/v1/character-assets/xxx.png），
  /// 铸造接口可能直接给绝对地址，两种情况都要兼容。
  static String? resolveAssetUrl(String? path) {
    final raw = path?.trim() ?? '';
    if (raw.isEmpty) return null;
    if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
    if (raw.startsWith('/')) return '$baseUrl$raw';
    return '$baseUrl/$raw';
  }

  /// 请求头（JSON API）。
  static const Map<String, String> jsonHeaders = {
    'Content-Type': 'application/json; charset=UTF-8',
    'Accept': 'application/json',
  };

  /// 发送验证码（POST）。body 包含手机号、平台及图形验证凭证。
  static const String sendCodePath = '/api/v1/auth/send-code';

  /// 验证码登录（POST）。body: {"phone", "code", "deviceId"}
  static const String loginByCodePath = '/api/v1/auth/login-by-code';

  /// 刷新会话（POST）。body: {"refreshToken", "deviceId"}
  static const String refreshPath = '/api/v1/auth/refresh';

  /// 退出登录（POST）。
  static const String logoutPath = '/api/v1/auth/logout';

  /// 当前用户（GET）。header: Authorization: Bearer xxx
  static const String mePath = '/api/v1/auth/me';

  /// 当前账号的平台 API Key 概要（GET）。
  static const String myKeyPath = '/api/v1/platform/my-key';

  /// 显示完整 API Key（POST）。
  static const String revealKeyPath = '/api/v1/platform/my-key/reveal';

  /// 重置 API Key（POST）。
  static const String resetKeyPath = '/api/v1/platform/my-key/reset';

  /// 平台真实钱包余额（GET）header: Authorization: Bearer xxx
  static const String walletPath = '/api/v1/platform/wallet';

  /// 余额充值档位（GET）header: Authorization: Bearer xxx
  static const String topupProductsPath = '/api/v1/platform/topup/products';

  /// 余额充值下单（POST）header: Authorization: Bearer xxx
  static const String topupOrdersPath = '/api/v1/platform/topup/orders';

  /// 余额充值订单详情（GET）。
  static String topupOrderPath(String id) => '$topupOrdersPath/$id';

  /// 余额充值订单重新拉起支付（POST）。
  static String topupOrderPayPath(String id) => '$topupOrdersPath/$id/pay';

  /// AI 真实对话（POST）。
  static const String elfChatPath = '/api/v1/elf-chat';

  /// 世界对话开关（POST，仅持有人）。body: {elfId, open}
  static const String elfWorldChatPath = '/api/v1/elf/world-chat';

  /// 公开信息流（GET）：全端可用，登录态可选。
  static const String publicFeedPath = '/api/v1/feed';

  // —— P3 角色卡：角色设定 → 形象预览/生成 → 铸造 ——

  /// 角色配件库（GET）：slots + comboSpace。
  static const String characterPartsPath = '/api/v1/character/parts';

  /// 创建角色卡草稿（POST）。
  static const String characterDraftsPath = '/api/v1/character/drafts';

  /// 更新角色卡草稿（PUT，仅 draft 可改）。
  static String characterDraftPath(String id) => '$characterDraftsPath/$id';

  /// 预览形象（POST，本地合成缩略图，不落库、免费）。
  static String characterDraftPreviewPath(String id) =>
      '${characterDraftPath(id)}/preview';

  /// 生成形象（POST，免费，生成后锁定组合）。
  static String characterDraftGeneratePath(String id) =>
      '${characterDraftPath(id)}/generate';

  /// 角色卡详情（GET）。
  static String characterCardPath(String id) => '/api/v1/character/cards/$id';

  /// 铸造角色卡（POST，链上确权后扣 200 钻石并建 AI）。
  static String characterCardMintPath(String id) =>
      '${characterCardPath(id)}/mint';

  /// 上传 AI 生成视频（POST，body 为 MP4 原始字节，元信息走 query）。
  static const String videoUploadPath = '/api/v1/world/video-uploads';

  /// 运营配置公开快照（GET）：法律政策文档 + 应用文案/开关。
  static const String appContentPath = '/api/v1/app-content';

  /// 提交举报（POST）。body: {targetType, targetId, reason, detail, block}
  static const String reportsPath = '/api/v1/reports';

  /// 拉黑列表（GET）/ 拉黑（POST）/ 取消拉黑（POST）。
  static const String blocksPath = '/api/v1/blocks';
  static const String blocksUnblockPath = '/api/v1/blocks/unblock';

  /// 注销账号（DELETE）。body: {confirm: true}
  static const String accountPath = '/api/v1/account';
}
