/* 开发者门户（静态页）：介绍技能运行形态、分成与入驻流程。
 * 所有操作入口都跳到控制台的开发者视图，页面本身不发请求。 */
import Link from 'next/link';

export const metadata = {
  title: '开发者 · 用 OpenAI 兼容接口把技能发布给全站 AI 智能体',
  description:
    'OpenElf 开发者生态：上传单文件技能源码，平台在隔离沙箱中运行；技能书按钻石一次性售卖给人类，AI 调用按 token 从持有者余额扣费。开发者拿技能书销售 70% 分成。',
  alternates: { canonical: '/developers/' },
  openGraph: {
    title: '开发者 · 把技能发布给全站 AI 智能体 | 开放精灵 OpenElf',
    description: '单文件技能 + 隔离沙箱 · 技能书一次性售卖 · 销售分成 70%',
    url: '/developers/'
  }
};

const METRICS = [
  { value: '70%', label: '技能书销售分成' },
  { value: '18-999', label: '自主定价区间（钻石）' },
  { value: 'node20', label: '运行时' },
  { value: '按 token', label: '调用计费' }
];

const CAPABILITIES = [
  {
    index: '01',
    title: '上传代码，不是填提示词',
    lead: '一个文件、一个导出函数',
    desc: '技能是单文件 node20 源码，导出 exports.handler(event, ctx)。需要大模型时调用 ctx.llm.chat，平台负责转发与计费，密钥不会出现在沙箱里。'
  },
  {
    index: '02',
    title: '隔离沙箱执行',
    lead: '看不到密钥，读不到文件',
    desc: '技能运行在独立环境，禁止加载 fs / net / child_process 等宿主模块，禁止读取 process.env，超出超时或调用次数直接终止。'
  },
  {
    index: '03',
    title: '一次售卖，长期调用',
    lead: '技能书卖给人类，调用费归平台',
    desc: '人类用钻石一次性购买技能书，学进自己的 AI；之后每次调用按 token 从该 AI 持有者的余额扣费，调用费 100% 归平台。'
  }
];

const STEPS = [
  {
    index: '1',
    title: '入驻',
    desc: '用 App 手机号账号登录控制台，填写姓名与开发方向，首版自动通过。'
  },
  {
    index: '2',
    title: '创建技能',
    desc: '填写名称、赛道、技能书价格与源码，保存即生成第一个版本。'
  },
  {
    index: '3',
    title: '沙箱调试',
    desc: '在控制台填入 JSON 输入并运行，实时看到返回值、耗时与大模型调用次数。'
  },
  {
    index: '4',
    title: '提交审核',
    desc: '至少一次成功调试后才能提交，平台审核通过后进入技能书发售目录。'
  }
];

const RULES = [
  '技能书价格区间 18-999 钻石，开发者自主定价，钻石与人民币固定 10:1。',
  '技能书销售分成：开发者 70%、平台 30%。收益走平台劳务/服务协议结算，支持提现。',
  '每只 AI 对同一技能只能学一次，学习即销毁技能书；技能随 AI 转赠一并转移。',
  '单次运行有超时、大模型调用次数与输入长度上限，均由 manifest 声明并在沙箱内强制执行。',
  '技能不得包含色情、暴力、违法内容，不得尝试获取用户隐私或绕过平台计费。',
  '平台保留下架违规技能的权限；下架后已售出的技能书不退款。'
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
        <h1 className="platform-title">把你的技能，发布给全站 AI 智能体</h1>
        <p className="platform-sub">单文件技能 · 隔离沙箱 · 技能书一次性售卖</p>
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

      <section className="platform-section">
        <div className="sec-head">
          <div>
            <p className="sec-eyebrow">HOW IT WORKS / 技能形态</p>
            <h2 className="sec-title">代码在沙箱里跑，密钥留在平台。</h2>
          </div>
          <span className="sec-note">首版仅支持 node20 单文件</span>
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
          <h2>入驻、写代码、跑一次调试。</h2>
          <p>与 App 同一手机号账号，无需注册第二套账号。</p>
        </div>
        <Link className="platform-btn platform-btn--primary" href="/console/?view=developer">
          开始入驻
        </Link>
      </section>
    </div>
  );
}
