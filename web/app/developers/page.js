/* 开发者门户（静态页）：介绍技能运行形态、分成与入驻流程。
 * 所有操作入口都跳到控制台的开发者视图，页面本身不发请求。 */
import Link from 'next/link';

export const metadata = {
  title: '开发者 · 把技能、专家与连接器发布给全站 AI 智能体',
  description:
    'OpenElf 开发者生态：技能在隔离沙箱中运行，专家与连接器为声明式配置；能力按钻石一次性售卖给人类，AI 调用按 token 从持有者余额扣费。开发者拿能力销售 70% 分成。',
  alternates: { canonical: '/developers/' },
  openGraph: {
    title: '开发者 · 把技能、专家与连接器发布给全站 AI 智能体 | 开放精灵 OpenElf',
    description: '技能 + 专家 + 连接器 · 隔离沙箱 · 一次性售卖 · 销售分成 70%',
    url: '/developers/'
  }
};

const METRICS = [
  { value: '70%', label: '能力销售分成' },
  { value: '18-999', label: '自主定价区间（钻石）' },
  { value: '3 类', label: '技能 / 专家 / 连接器' },
  { value: '按 token', label: '调用计费' }
];

const OPEN_ABILITIES = [
  {
    index: '01',
    title: '技能 Skill',
    lead: '单文件 node20 源码，沙箱运行',
    desc: '写一段 exports.handler 代码，让 AI 真的会查数据、算结果、调外部服务。',
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
    desc: '声明一个外部系统入口，由平台统一保管密钥并转发请求，密钥不进代码。',
    href: '/docs/connector/'
  }
];

const CAPABILITIES = [
  {
    index: '01',
    title: '三类能力，同一套上架流程',
    lead: '技能写代码，专家写人格，连接器接服务',
    desc: '技能是单文件 node20 源码，导出 exports.handler(event, ctx)；专家是一套可直接套用到 AI 的提示词人设；连接器登记一个外部 https 服务入口，由平台统一保管密钥。'
  },
  {
    index: '02',
    title: '沙箱隔离执行',
    lead: '看不到密钥，读不到文件',
    desc: '技能运行在独立环境，禁止加载 fs / net / child_process 等宿主模块，禁止读取 process.env，超出超时或调用次数直接终止。'
  },
  {
    index: '03',
    title: '一次售卖，长期调用',
    lead: '能力卖给人类，调用费归平台',
    desc: '人类用钻石一次性购买能力，学进自己的 AI；之后每次调用按 token 从该 AI 持有者的余额扣费，调用费 100% 归平台。'
  }
];

const STEPS = [
  {
    index: '1',
    title: '入驻',
    desc: '用 App 手机号账号登录控制台，选择主体并签署开发者服务协议；个人主体提交即通过，企业主体需人工审核资质。'
  },
  {
    index: '2',
    title: '创建能力',
    desc: '在发布管理里选择技能 / 专家 / 连接器，填写名称、赛道、定价与对应内容，保存即生成第一个版本。'
  },
  {
    index: '3',
    title: '调试',
    desc: '技能可在控制台填入 JSON 输入并运行，实时看到返回值、耗时与大模型调用次数；专家与连接器为声明式配置。'
  },
  {
    index: '4',
    title: '提交审核',
    desc: '技能至少一次成功调试后才能提交，平台审核通过后进入市场与学习入口，并在运营数据与收益里可见。'
  }
];

const RULES = [
  '能力定价区间 18-999 钻石，开发者自主定价，钻石与人民币固定 10:1。',
  '能力销售分成：开发者 70%、平台 30%；收益先进待结算，T+7 后可提现。',
  '每只 AI 对同一技能只能学一次，学习即销毁技能书；技能随 AI 转赠一并转移。',
  '单次运行有超时、大模型调用次数与输入长度上限，均由 manifest 声明并在沙箱内强制执行。',
  '能力不得包含色情、暴力、违法内容，不得尝试获取用户隐私或绕过平台计费。',
  '平台保留下架违规能力的权限；下架后已售出的能力不退款。'
];

const MANIFEST_SAMPLE = `{
  "slug": "weather-brief",
  "name": "天气播报",
  "track": "knowledge",
  "summary": "把城市与日期整理成一段当日天气播报文案",
  "runtime": "node20",
  "models": ["deepseek/deepseek-chat"],
  "pricing": { "book_diamonds": 68 },
  "limits": { "timeout_ms": 8000, "max_llm_calls": 2, "max_input_chars": 2000 }
}`;

const SOURCE_SAMPLE = `// event.input 为调用方传入的 JSON；ctx.llm.chat 调用平台大模型
exports.handler = async function (event, ctx) {
  const city = String((event.input && event.input.city) || '上海');
  const reply = await ctx.llm.chat([
    { role: 'system', content: '你是简洁的天气播报员。' },
    { role: 'user', content: city + ' 今天该怎么穿衣？' }
  ], { max_tokens: 400 });
  return { city, text: reply.content };
};`;

export default function DevelopersPage() {
  return (
    <div className="page-tools platform-page platform-v2">
      <section className="platform-hero">
        <p className="sec-eyebrow">DEVELOPERS / 开发者</p>
        <h1 className="platform-title">把你的技能、专家与连接器，发布给全站 AI 智能体</h1>
        <p className="platform-sub">三类能力 · 隔离沙箱 · 一次性售卖</p>
        <div className="platform-hero-actions">
          <Link className="platform-btn platform-btn--primary" href="/console/?view=developer">
            进入开发者控制台
          </Link>
          <a className="platform-btn platform-btn--ghost" href="#spec">
            查看技能规范
          </a>
        </div>
      </section>

      <section className="platform-metrics" aria-label="开发者概况">
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
          {OPEN_ABILITIES.map((item) => (
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
            <p className="sec-eyebrow">HOW IT WORKS / 能力形态</p>
            <h2 className="sec-title">代码在沙箱里跑，密钥留在平台。</h2>
          </div>
          <span className="sec-note">技能支持 node20 单文件</span>
        </div>

        <div className="platform-capabilities">
          {CAPABILITIES.map((item) => (
            <article className="platform-cap-card" key={item.index}>
              <span className="platform-cap-index mono">{item.index}</span>
              <h3>{item.title}</h3>
              <p className="platform-cap-lead">{item.lead}</p>
              <p className="platform-cap-desc">{item.desc}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="platform-section" id="spec">
        <div className="sec-head">
          <div>
            <p className="sec-eyebrow">SPEC / 技能规范</p>
            <h2 className="sec-title">一个 manifest，一个函数。</h2>
          </div>
          <span className="sec-note">源码不超过 64KB</span>
        </div>

        <div className="platform-codes">
          <div className="platform-code">
            <div className="platform-code-head">
              <span>manifest.json</span>
              <span>元数据</span>
            </div>
            <pre>
              <code>{MANIFEST_SAMPLE}</code>
            </pre>
          </div>
          <div className="platform-code">
            <div className="platform-code-head">
              <span>index.js</span>
              <span>运行时入口</span>
            </div>
            <pre>
              <code>{SOURCE_SAMPLE}</code>
            </pre>
          </div>
        </div>

        <p className="platform-note">
          event.input 为调用方传入的 JSON；ctx.llm.chat(messages, options) 返回
          {' { content, usage, model } '}，每次调用都计入本次运行的大模型调用上限，并按 token 从调用方余额扣费。
        </p>
      </section>

      <section className="platform-section">
        <div className="sec-head">
          <div>
            <p className="sec-eyebrow">WORKFLOW / 发布流程</p>
            <h2 className="sec-title">四步上架。</h2>
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

      <section className="platform-section">
        <div className="sec-head">
          <div>
            <p className="sec-eyebrow">RULES / 分成与规则</p>
            <h2 className="sec-title">先说清楚钱怎么分。</h2>
          </div>
        </div>

        <ul className="dev-rule-list">
          {RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </section>

      <section className="platform-cta">
        <div>
          <p className="sec-eyebrow">CONSOLE / 开发者控制台</p>
          <h2>入驻、创建能力、跑一次调试。</h2>
          <p>与 App 同一手机号账号，无需注册第二套账号。</p>
        </div>
        <Link className="platform-btn platform-btn--primary" href="/console/?view=developer">
          开始入驻
        </Link>
      </section>
    </div>
  );
}
