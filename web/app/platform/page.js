/* 开放平台介绍页（OpenRouter 风格）：一个接口调用全部模型。
 * 纯静态生成，不发起任何请求；获取 Key 与用量查询统一跳转 /console/。 */
import Link from 'next/link';

export const metadata = {
  title: '模型聚合 · 一个 OpenAI 兼容接口调用 DeepSeek、豆包、通义千问',
  description:
    'OpenElf 模型聚合：OpenAI Chat Completions 兼容接口，一个 API Key 调用 DeepSeek、豆包、通义千问等模型。按 token 计费，余额预充值，无需订阅。',
  alternates: { canonical: '/platform/' },
  openGraph: {
    title: '模型聚合 · 一个接口调用全部模型 | 开放精灵 OpenElf',
    description:
      'OpenAI Chat Completions 兼容 · 按 token 计费 · 无需订阅。一个接口，调用 OpenElf 的所有模型。',
    url: '/platform/'
  }
};

const METRICS = [
  { value: '3', label: '可用模型' },
  { value: '3', label: '上游厂商' },
  { value: '65536', label: '最大上下文' },
  { value: 'OpenAI', label: '接口兼容' }
];

const MODELS = [
  {
    id: 'deepseek/deepseek-chat',
    name: 'DeepSeek Chat',
    provider: 'DeepSeek',
    context: '65,536',
    caps: ['chat', 'tools', 'json'],
    input: '¥1.12',
    output: '¥2.23'
  },
  {
    id: 'doubao/llama-3-70b',
    name: '豆包 Llama 3 70B',
    provider: '火山引擎',
    context: '32,768',
    caps: ['chat', 'tools'],
    input: '¥0.89',
    output: '¥2.23'
  },
  {
    id: 'qwen/qwen-turbo',
    name: '通义千问 Turbo',
    provider: '阿里云百炼',
    context: '32,768',
    caps: ['chat', 'tools', 'json'],
    input: '¥0.89',
    output: '¥2.23'
  }
];

const CAPABILITIES = [
  {
    index: '01',
    title: 'OpenAI 兼容',
    lead: '只改 base_url 与 key',
    desc: '已有 OpenAI SDK 或客户端无需改代码，把 base_url 指向 https://api.openelfai.com/v1，换成 OpenElf 的 Key 即可。'
  },
  {
    index: '02',
    title: '按量计费',
    lead: '余额预充值，用多少扣多少',
    desc: '每次请求按输入 / 输出 token 从余额扣减；余额不足时接口返回 402，不会自动扣款或订阅。'
  },
  {
    index: '03',
    title: '一个 Key 通用',
    lead: '同一把 Key 调用全部模型',
    desc: '无需为每个模型单独申请密钥，切换请求体里的 model 字段就能在模型之间切换。'
  }
];

const STEPS = [
  {
    index: '1',
    title: '登录控制台',
    desc: '使用手机号 + 验证码登录，与 OpenElf App 同款账号。'
  },
  {
    index: '2',
    title: '充值余额',
    desc: '在控制台「充值」页选择金额并用支付宝支付，实时到账后即可调用。'
  },
  {
    index: '3',
    title: '获取 API Key',
    desc: '在控制台复制默认 Key，按下方示例发起第一次请求。'
  }
];

const CURL_SAMPLE = `curl https://api.openelfai.com/v1/chat/completions \\
  -H "Authorization: Bearer oe-sk-xxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "deepseek/deepseek-chat",
    "messages": [
      {"role": "user", "content": "用一句话介绍 OpenElf"}
    ],
    "stream": true
  }'`;

const PYTHON_SAMPLE = `from openai import OpenAI

client = OpenAI(
    base_url="https://api.openelfai.com/v1",
    api_key="oe-sk-xxxxxxxx"
)

resp = client.chat.completions.create(
    model="deepseek/deepseek-chat",
    messages=[{"role": "user", "content": "用一句话介绍 OpenElf"}]
)
print(resp.choices[0].message.content)`;

export default function PlatformPage() {
  return (
    <div className="page-tools platform-page platform-v2">
      <section className="platform-hero">
        <p className="sec-eyebrow">MODEL HUB / 模型聚合</p>
        <h1 className="platform-title">一个接口，调用 OpenElf 的所有模型</h1>
        <p className="platform-sub">OpenAI Chat Completions 兼容 · 按 token 计费 · 无需订阅</p>
        <div className="platform-hero-actions">
          <Link className="platform-btn platform-btn--primary" href="/console/">
            获取 API Key
          </Link>
          <a className="platform-btn platform-btn--ghost" href="#quickstart">
            快速开始
          </a>
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

      <section className="platform-section" id="models">
        <div className="sec-head">
          <div>
            <p className="sec-eyebrow">FEATURED MODELS / 精选模型</p>
            <h2 className="sec-title">三个模型，一个接口。</h2>
          </div>
          <span className="sec-note">价格单位：每百万 tokens</span>
        </div>

        <div className="platform-models">
          {MODELS.map((model) => (
            <article className="platform-model-card" key={model.id}>
              <div className="platform-model-top">
                <code className="platform-model-id">{model.id}</code>
                <span className="platform-model-provider">{model.provider}</span>
              </div>
              <h3 className="platform-model-name">{model.name}</h3>
              <dl className="platform-model-meta">
                <div>
                  <dt>上下文</dt>
                  <dd className="mono">{model.context}</dd>
                </div>
                <div>
                  <dt>能力</dt>
                  <dd>
                    <span className="platform-caps">
                      {model.caps.map((cap) => (
                        <span className="platform-cap" key={cap}>
                          {cap}
                        </span>
                      ))}
                    </span>
                  </dd>
                </div>
              </dl>
              <div className="platform-price">
                <span>
                  输入 <b>{model.input}</b>
                </span>
                <span className="platform-price-dot">·</span>
                <span>
                  输出 <b>{model.output}</b>
                </span>
                <em>每百万 tokens</em>
              </div>
              <Link className="platform-model-cta" href="/console/">
                调用这个模型
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className="platform-section">
        <div className="sec-head">
          <div>
            <p className="sec-eyebrow">WHY OpenElf / 平台能力</p>
            <h2 className="sec-title">接入成本，只有两行配置。</h2>
          </div>
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

      <section className="platform-section">
        <div className="sec-head">
          <div>
            <p className="sec-eyebrow">HOW IT WORKS / 接入流程</p>
            <h2 className="sec-title">三步发起第一次请求。</h2>
          </div>
        </div>

        <div className="platform-steps">
          {STEPS.map((step) => (
            <article className="platform-step" key={step.index}>
              <span className="platform-step-index mono">{step.index}</span>
              <h3>{step.title}</h3>
              <p>{step.desc}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="platform-section" id="quickstart">
        <div className="sec-head">
          <div>
            <p className="sec-eyebrow">QUICK START / 快速开始</p>
            <h2 className="sec-title">只改地址与 Key。</h2>
          </div>
          <span className="sec-note">兼容 OpenAI SDK</span>
        </div>

        <div className="platform-facts">
          <div className="platform-fact">
            <span>BASE URL</span>
            <code>https://api.openelfai.com/v1</code>
          </div>
          <div className="platform-fact">
            <span>AUTHORIZATION</span>
            <code>Bearer oe-sk-xxxxxxxx</code>
          </div>
        </div>
        <p className="platform-note">
          所有请求通过 Bearer Token 鉴权。请把 API Key 保存在服务端，不要写入前端代码或公开仓库。
        </p>

        <div className="platform-codes">
          <div className="platform-code">
            <div className="platform-code-head">
              <span>curl</span>
              <span>Shell</span>
            </div>
            <pre>
              <code>{CURL_SAMPLE}</code>
            </pre>
          </div>
          <div className="platform-code">
            <div className="platform-code-head">
              <span>python</span>
              <span>openai SDK</span>
            </div>
            <pre>
              <code>{PYTHON_SAMPLE}</code>
            </pre>
          </div>
        </div>
      </section>

      <section className="platform-section">
        <div className="sec-head">
          <div>
            <p className="sec-eyebrow">ENDPOINTS / 接口一览</p>
            <h2 className="sec-title">三个接口，够用了。</h2>
          </div>
        </div>

        <div className="platform-table-wrap">
          <table className="platform-table">
            <thead>
              <tr>
                <th>方法</th>
                <th>路径</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <span className="platform-method">POST</span>
                </td>
                <td>
                  <code>/v1/chat/completions</code>
                </td>
                <td>对话补全，支持 stream 流式返回。</td>
              </tr>
              <tr>
                <td>
                  <span className="platform-method">GET</span>
                </td>
                <td>
                  <code>/v1/models</code>
                </td>
                <td>查询当前可用模型列表。</td>
              </tr>
              <tr>
                <td>
                  <span className="platform-method">GET</span>
                </td>
                <td>
                  <code>/health</code>
                </td>
                <td>服务健康检查。</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="platform-cta">
        <div>
          <p className="sec-eyebrow">CONSOLE / 开发者控制台</p>
          <h2>查看余额、用量与 API Key。</h2>
          <p>使用 App 同款账号登录，所有调用记录与账单都在这里。</p>
        </div>
        <Link className="platform-btn platform-btn--primary" href="/console/">
          进入开发者控制台
        </Link>
      </section>
    </div>
  );
}
