/// Published operator text, checked 2026-10-27; only list/layout formatting changed.
/// This snapshot does not approve the business model or implement withdrawal rules.
class UserAgreement {
  static const sourceUrl = 'https://openelfai.com/terms/';
  static const updatedAt = '2026 年 10 月 27 日';
  static const introduction =
      '本协议是你与开放精灵（OpenElf）之间关于使用官网、App、开放平台及相关服务的约定。请在使用前完整阅读。';

  static const sections = <UserAgreementSection>[
    UserAgreementSection('协议的接受', [
      '你注册、登录或使用服务，即表示你已阅读并同意本协议与《隐私政策》。若你不同意其中任何内容，请停止使用服务。',
    ]),
    UserAgreementSection('账号', [
      '• 手机号为唯一账号，官网、App 与开放平台共用同一账号与同一套资产数据。',
      '• 你应确保手机号真实有效，并妥善保管验证码；因保管不善造成的损失由你承担。',
      '• 账号仅限本人使用，不得出借、出租或出售。',
      '• 实名认证由服务端统一完成；未完成实名可能无法使用提现等功能。',
    ]),
    UserAgreementSection('AI 与内容', [
      '• 你创建 AI 时须保证形象为原创，或已获得肖像权人的明确授权；不得使用他人照片、明星或公众人物形象。',
      '• AI 生成内容须加注「AI 生成」标识，并遵守相关法律法规与平台规则。',
      '• 你不得利用平台生成或传播色情、暴力、违法、侵权、虚假信息，或损害未成年人权益的内容。',
      '• 你对自己输入与发布的内容负责；平台有权对违规内容进行下架、限制展示或删除。',
    ]),
    UserAgreementSection('资产与消费', [
      '• 钻石是充值后的消费凭证，与人民币的固定比例为 10 钻石 = 1 元。',
      '• 钻石仅可用于打赏、购买 AI 智能体、购买技能书等平台内消费，不可兑换为人民币，不可提现，不可转让。',
      '• 技能书学习后即销毁，技能永久写入对应 AI；已学技能可消耗钻石遗忘，技能书不返还。',
      '• AI 所有权仅支持转赠，不提供用户之间的寄售或转卖；AI 的技能、人格与作品随 AI 一并转移。',
    ]),
    UserAgreementSection('创作者收益', [
      '• 用户打赏对应的创作者收益，按平台与创作者签署的劳务/服务协议结算，属于平台支付的服务费，不是将虚拟道具兑换回钱。',
      '• 打赏服务费分成比例为 50%；收益经历 T+7 冷静期后进入可提现额度。',
      '• 提现需完成实名认证、签署创作者服务协议，并满足最低提现额度；未签署协议无法提现。',
      '• 收益不可转让、不可兑换为钻石，仅可按规则提现。',
    ]),
    UserAgreementSection('开放平台', [
      '• 开发者与 App 使用同一手机号账号，共享同一钱包与 API Key。',
      '• API Key 仅限本人使用，不得转售、共享或用于违法用途。',
      '• 调用按实际消耗计费；余额不足时服务将停止。你不得绕过计费、攻击网关或滥用模型服务。',
      '• 开发者技能须遵守技能规范，不得包含违法内容、读取用户隐私或绕过平台计费；平台保留下架违规技能的权限。',
    ]),
    UserAgreementSection('知识产权', [
      '• 你对你上传的原创内容享有权利，并授权平台为提供服务进行必要的存储、展示与分发。',
      '• 官方首发 AI 的角色 IP 归平台或被授权方所有；NFT 持有者获得该 AI 的使用权与内容收益权，不获得角色 IP 本身的所有权。',
      '• 平台界面、文案、商标与代码归平台所有，未经许可不得使用。',
    ]),
    UserAgreementSection('违规处理', [
      '如你违反本协议或法律法规，平台可采取警告、内容下架、限制功能、冻结资产、封禁账号等措施；涉嫌违法的，依法移交有关部门。已售出的技能书不因违规下架而退款。',
    ]),
    UserAgreementSection('免责与责任限制', [
      '• 服务按现状提供；因网络、设备、第三方服务或不可抗力导致的中断，平台将在合理范围内协助恢复。',
      '• AI 生成内容不构成专业建议；请理性判断并自行承担使用后果。',
      '• 在法律允许的范围内，平台对间接损失不承担责任。',
    ]),
    UserAgreementSection('协议变更与争议', [
      '• 平台可基于业务与法律要求更新本协议，并在本页与 App 内公布。',
      '• 本协议适用中华人民共和国法律；争议先友好协商，协商不成提交平台所在地有管辖权的人民法院。',
    ]),
    UserAgreementSection('联系我们', [
      '协议相关事宜，请联系 support@openelfai.com。',
      '本协议与 App 内「设置 - 用户协议」为同一份文本的不同展示端，更新时同步替换；如有差异，以更新日期较新的版本为准。',
    ]),
  ];
}

class UserAgreementSection {
  final String title;
  final List<String> paragraphs;
  const UserAgreementSection(this.title, this.paragraphs);
}
