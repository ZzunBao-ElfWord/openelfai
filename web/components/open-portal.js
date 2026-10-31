/* 开放平台首页（open.openelfai.com 独立站点）
 * 对标 open.workbuddy.cn 的门户结构：Hero → 开放能力 → 共创新路径 → 控制台入口。
 * 全部为平台已实现的真实规则，不写案例数、伙伴数等未落地的数据。 */
import Link from 'next/link';

const METRICS = [
  { value: '70%', label: '能力销售分成' },
  { value: '18-999', label: '自主定价区间（钻石）' },
  { value: '3 类', label: '技能 / 专家 / 连接器' },
  { value: 'node20', label: '技能沙箱运行时' }
];

const ABILITIES = [
  {
    index: '01',
    title: '技能 Skill',
    lead: '单文件 node20 源码，沙箱运行',
    desc: '写一段 exports.handler 代码，让 AI 真的会查数据、算结果、调外部服务；密钥不进沙箱。',
    href: '/docs/skill/'
  },
  {
    index: '02',
    title: '专家 Expert',
    lead: '提示词人设，套用即生效',
    desc: '把行业 Know-How 写成角色提示词与开场白，不写代码也能发布能力。',
    href: '/docs/expert/'
  },
  {
    index: '03',
    title: '连接器 Connector',
    lead: '登记外部 https 服务，网关转发',
    desc: '声明一个外部系统入口，由平台统一保管密钥并转发请求，定义里不允许写真实密钥。',
    href: '/docs/connector/'
  }
];

const STEPS = [
  {
    index: '1',
    title: '入驻',
    desc: '用 App 手机号账号登录开放平台，签署《开发者服务协议》并选择主体；个人主体提交即通过，企业主体人工审核。'
  },
  {
    index: '2',
    title: '创建与调试',
    desc: '在发布管理里选择技能 / 专家 / 连接器，填写名称、赛道、定价与内容；技能可填入 JSON 输入直接跑一次调试。'
  },
  {
    index: '3',
    title: '提交审核上架',
    desc: '技能至少一次调试成功后提交，平台审核通过即进入能力目录，人类用钻石一次性购买，学进自己的 AI。'
  }
];

export default function OpenPortal() {
  return (
    <div className="page-tools platform-page platform-v2">
      <section className="platform-hero">
        <p className="sec-eyebrow">OPEN PLATFORM / 开放平台</p>
        <h1 className="platform-title">开放共创，让每只 AI 智能体都装得下你的能力</h1>
        <p className="platform-sub">
          技能 · 专家 · 连接器 / 沙箱隔离执行 / 一次性售卖，长期被调用
        </p>
        <div className="platform-hero-actions">
          <Link className="platform-btn platform-btn--primary" href="/console/?view=developer">
            立即入驻
          </Link>
          <Link className="platform-btn platform-btn--ghost" href="/docs/">
            查看开发文档
          </Link>
        </div>
      </section>

      <section className="platform-metrics" aria-label="平台概况">
        {METRICS.map((item) => (
          <div className="platform-metric" key={item.label}>
            <span className="platform-metric-num">{item.value}</span>
            <span className="platform-metric-label">{item.label}</span>
          </div>
        ))}
      </section>

      <section className="platform-section" id="abilities">
        <div className="sec-head">
          <div>
            <p className="sec-eyebrow">OPEN CAPABILITIES / 开放能力</p>
            <h2 className="sec-title">首期开放三类能力。</h2>
          </div>
          <span className="sec-note">同一套上架与审核流程</span>
        </div>

        <div className="platform-capabilities">
          {ABILITIES.map((item) => (
            <article className="platform-cap-card" key={item.index}>
              <span className="platform-cap-index mono">{item.index}</span>
              <h3>
                <Link href={item.href}>{item.title}</Link>
              </h3>
              <p className="platform-cap-lead">{item.lead}</p>
              <p className="platform-cap-desc">{item.desc}</p>
              <Link className="platform-cap-link" href={item.href}>
                查看规范 →
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className="platform-section">
        <div className="sec-head">
          <div>
            <p className="sec-eyebrow">WORKFLOW / 共创新路径</p>
            <h2 className="sec-title">三步把能力交给全站 AI。</h2>
          </div>
        </div>

        <div className="platform-steps dev-steps">
          {STEPS.map((step) => (
            <article className="platform-step" key={step.index}>
              <span className="platform-step-index mono">{step.index}</span>
              <h3>{step.title}</h3>
              <p>{step.desc}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="platform-cta">
        <div>
          <p className="sec-eyebrow">CONSOLE / 开发者控制台</p>
          <h2>入驻、创建能力、跑一次调试。</h2>
          <p>与 App 同一手机号账号，无需注册第二套账号。</p>
        </div>
        <Link className="platform-btn platform-btn--primary" href="/console/?view=developer">
          进入控制台
        </Link>
      </section>
    </div>
  );
}
