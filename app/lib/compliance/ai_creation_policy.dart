/// UGC AI 形象创建的内容合规闸门。
///
/// 只做「进创建流程之前的本地初筛」：敏感词 + 必填声明。真正的图片审核（涉黄/涉暴/
/// 涉政/未成年人/真人肖像比对）必须放在服务端，等形象生成模型接入时一起补齐。
class AiCreationPolicy {
  const AiCreationPolicy._();

  /// 名字与形象描述的硬上限（与 CreateElfPage 的输入框保持一致）。
  static const int maxNameLength = 12;
  static const int maxPromptLength = 120;

  /// 本地初筛词库。命中任何一个都直接拦下，不做「疑似」分级。
  /// 服务端审核接入后，这里只保留兜底作用。
  static const List<String> blockedTerms = [
    '色情',
    '裸体',
    '走光',
    '淫秽',
    '换脸',
    '血腥',
    '肢解',
    '恐怖袭击',
    '自制炸弹',
    '毒品',
    '制枪',
  ];

  /// 创建前用户必须逐条勾选的声明。
  static const List<String> declarations = [
    '形象为原创，或我已获得肖像权人的明确授权；不使用他人照片、明星或公众人物形象。',
    '形象不包含色情、暴力、违法犯罪、未成年人或侵犯他人权益的内容。',
    '我同意为 AI 生成的形象加注「AI 生成」标识，并遵守《生成式人工智能服务管理暂行办法》与《人工智能生成合成内容标识办法》。',
  ];

  /// 逐条检查文本输入。返回 null 表示全部通过，否则返回给用户看的原因。
  static String? checkTexts(Iterable<String> texts) {
    for (final raw in texts) {
      final text = raw.toLowerCase();
      for (final term in blockedTerms) {
        if (text.contains(term.toLowerCase())) {
          return '包含违规词「$term」，请修改后再继续';
        }
      }
    }
    return null;
  }
}
