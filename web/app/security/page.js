import LegalDoc from '../../components/legal-doc';

export const metadata = {
  title: '反馈安全漏洞',
  description:
    '向开放精灵 OpenElf 负责任地报告安全漏洞：报告范围、提交方式、测试边界、响应流程与平台安全实践。',
  alternates: { canonical: '/security/' }
};

export default function SecurityPage() {
  return (
    <LegalDoc
      eyebrow="LEGAL / 安全"
      title="反馈安全漏洞"
      lead="如果你发现开放精灵（OpenElf）产品或基础设施存在安全漏洞，我们欢迎并感谢你负责任地告诉我们。"
      updated="2026 年 10 月 27 日"
    >
      <h2>报告范围</h2>
      <ul>
        <li>官网、App、开放平台 API 与相关服务。</li>
        <li>
          不在范围内：第三方服务（如支付宝、云厂商、大模型厂商）自身的漏洞；社会工程与钓鱼；拒绝服务攻击；物理攻击；已公开且尚未修复的漏洞。
        </li>
      </ul>

      <h2>如何报告</h2>
      <p>
        请发送邮件至
        {' '}
        <a href="mailto:support@openelfai.com">support@openelfai.com</a>
        ，邮件标题注明「安全漏洞」。为便于快速定位，请尽量包含：
      </p>
      <ul>
        <li>受影响的域名、接口或版本，以及复现步骤。</li>
        <li>漏洞类型与可能造成的影响。</li>
        <li>你的联系方式（可选择匿名）。</li>
        <li>如条件允许，附最小化的验证请求或截图。</li>
      </ul>

      <h2>测试边界</h2>
      <p>在验证漏洞时，请遵守以下边界，避免影响其他用户与平台运行：</p>
      <ul>
        <li>仅使用你自己的测试账号与数据。</li>
        <li>不得访问、修改或删除他人数据；不得中断服务或植入后门。</li>
        <li>不得使用自动化扫描影响平台稳定性。</li>
        <li>在我们完成修复并与你确认之前，不得公开披露漏洞细节。</li>
      </ul>

      <h2>响应流程</h2>
      <ul>
        <li>1 个工作日内确认收到你的报告。</li>
        <li>7 个工作日内完成初步评估，并同步处理计划。</li>
        <li>修复后与你协商公开披露时间；未经同意，我们不会公开你的身份。</li>
      </ul>

      <h2>平台安全实践</h2>
      <ul>
        <li>敏感字段加密存储，密钥不回显、不写入日志。</li>
        <li>后台遵循最小权限，关键操作留存审计记录。</li>
        <li>
          开发者技能在隔离沙箱中运行，禁止公网访问与系统调用，模型密钥不进入沙箱环境。
        </li>
        <li>支付与计费链路独立校验，关键操作幂等处理。</li>
      </ul>

      <h2>致谢</h2>
      <p>
        对有效且负责任的报告，我们会在修复后致谢；是否提供奖励，视漏洞影响与平台政策而定。
      </p>

      <h2>联系我们</h2>
      <p>
        安全相关事宜，请联系
        {' '}
        <a href="mailto:support@openelfai.com">support@openelfai.com</a>
        。
      </p>
    </LegalDoc>
  );
}
