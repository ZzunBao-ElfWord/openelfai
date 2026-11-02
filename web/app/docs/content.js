/* 开放平台开发文档内容源。
 * 页面只负责渲染，全部条目、分组与正文都集中在这里，方便统一维护。
 * slug 为英文，首页（开放平台概述）对应的 slug 为 what-is-open-platform，
 * 但它的实际路由是 /docs/，其余条目由 /docs/[slug]/ 静态生成。 */

export const HOME_SLUG = 'what-is-open-platform';

export const DOC_GROUPS = [
  { label: '介绍', items: ['what-is-open-platform'] },
  { label: '入驻指南', items: ['onboarding', 'developer-profile'] },
  { label: '开发', items: ['skill', 'expert', 'connector', 'openapi'] },
  {
    label: '运营',
    items: ['developer-agreement', 'service-categories', 'operations-data', 'monetization']
  },
  { label: '联系我们', items: ['contact'] }
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

const CURL_SAMPLE = `curl https://api.openelfai.com/v1/chat/completions \\
  -H "Authorization: Bearer oe-sk-xxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "deepseek/deepseek-chat",
    "messages": [
      {"role": "user", "content": "用一句话介绍 OpenElf"}
    ],
    "stream": false,
    "top_p": 0.9
  }'`;

const BODY_SAMPLE = `{
  "model": "deepseek/deepseek-chat",
  "messages": [{ "role": "user", "content": "查一下上海今天的天气" }],
  "stream": true,
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "查询指定城市天气",
        "parameters": {
          "type": "object",
          "properties": { "city": { "type": "string" } },
          "required": ["city"]
        }
      }
    }
  ],
  "tool_choice": "auto",
  "top_p": 0.9
}`;

export const DOCS = {
  'what-is-open-platform': {
    title: '开放平台概述',
    summary:
      'OpenElf 开放平台是开发者面向全站 AI 智能体发布能力的入口：一个手机号账号，三类能力，一条从创建到上架的闭环。',
    blocks: [
      {
        type: 'p',
        text:
          'OpenElf 开放平台让开发者把能力发布给全站的 AI 智能体。你可以在控制台创建技能、专家与连接器，完成调试、提交审核并上架，运行、计费与结算都由平台负责。'
      },
      { type: 'h2', text: '账号体系' },
      {
        type: 'p',
        text:
          '手机号即唯一账号。开放平台与 OpenElf App、控制台完全统一，不另建账号，也不需要再注册一套开发者账号。'
      },
      { type: 'h2', text: '三类能力' },
      {
        type: 'ul',
        items: [
          '技能：单文件 node20 源码，导出 exports.handler(event, ctx)，需要大模型时调用 ctx.llm.chat。',
          '专家：以人设与系统提示词定义的智能体，提交人设、开场白与知识范围，无需写代码。',
          '连接器：声明外部数据源或系统的接入信息，由平台统一网关转发，密钥不进开发者代码。'
        ]
      },
      { type: 'h2', text: '发布闭环' },
      {
        type: 'p',
        text:
          '创建 → 沙箱调试 → 提交审核 → 平台审核 → 上架 → 版本维护。技能必须至少完成一次成功调试后才能提交审核。'
      },
      { type: 'h2', text: '开始阅读' },
      {
        type: 'ul',
        items: [
          { text: '入驻开放平台：签署协议、选择主体并提交入驻', href: '/docs/onboarding/' },
          { text: '技能：单文件源码、沙箱限制与发布流程', href: '/docs/skill/' },
          { text: 'Open API 接口：OpenAI 兼容的对话补全接口', href: '/docs/openapi/' },
          { text: '收入变现：分成、提现与学习规则', href: '/docs/monetization/' }
        ]
      },
      {
        type: 'note',
        text:
          '入驻前只能查看文档，不能创建能力。建议先读《OpenElf 开发者服务协议》，再开始入驻。'
      }
    ]
  },

  onboarding: {
    title: '入驻开放平台',
    summary:
      '登录 → 签署《开发者服务协议》→ 选择主体类型 → 提交入驻。个人主体提交即通过，企业主体提交后人工审核。',
    blocks: [
      {
        type: 'p',
        text:
          '入驻开放平台不需要新建账号：使用手机号登录控制台即可，与 App、控制台完全统一。整个入驻流程分四步。'
      },
      { type: 'h2', text: '入驻流程' },
      {
        type: 'steps',
        items: [
          { title: '登录', desc: '使用手机号登录控制台，与 App 同款账号。' },
          { title: '签署《开发者服务协议》', desc: '阅读并勾选同意协议，这是提交入驻的前置条件。' },
          { title: '选择主体类型', desc: '按实际情况选择个人主体或企业主体。' },
          { title: '提交入驻', desc: '填写姓名与开发用途，企业主体再补全资质信息，提交后等待结果。' }
        ]
      },
      { type: 'h2', text: '主体类型与审核' },
      {
        type: 'table',
        head: ['主体类型', '需要提交', '审核方式'],
        rows: [
          ['个人', '姓名、入驻用途、同意开发者服务协议', '提交即通过'],
          [
            '企业',
            '企业名称、18 位统一社会信用代码、联系人（手机号或邮箱）',
            '提交后由平台人工审核'
          ]
        ]
      },
      { type: 'h2', text: '审核期间的权限' },
      {
        type: 'p',
        text: '企业主体审核通过前，只能查看入驻状态，不能创建技能、专家与连接器；个人主体提交后立即可发布。'
      },
      {
        type: 'note',
        text:
          '被驳回时会显示审核意见，在控制台修改资料后重新提交即可再次进入审核队列。'
      },
      { type: 'h2', text: '入驻之后' },
      {
        type: 'ul',
        items: [
          { text: '创建第一个技能', href: '/docs/skill/' },
          { text: '了解开发者信息的用途', href: '/docs/developer-profile/' },
          { text: '了解收入与结算', href: '/docs/monetization/' }
        ]
      }
    ]
  },

  'developer-profile': {
    title: '开发者信息',
    summary:
      '开发者信息随入驻一并提交，与手机号账号绑定，用于身份核验、协议签署与收益结算。',
    blocks: [
      {
        type: 'p',
        text:
          '开发者信息在入驻时填写，并与手机号账号绑定，不需要单独维护第二套开发者账号。'
      },
      { type: 'h2', text: '主体信息' },
      {
        type: 'p',
        text:
          '个人主体填写姓名与入驻用途，提交即通过；企业主体需另填企业名称、18 位统一社会信用代码与联系人，由平台人工审核。主体类型决定审核方式与后续结算主体。'
      },
      { type: 'h2', text: '信息用途' },
      {
        type: 'ul',
        items: [
          '入驻审核时的身份核验。',
          '开发者协议与相关协议的签署。',
          '收益结算与提现时的身份与账户校验。'
        ]
      },
      {
        type: 'note',
        text:
          '主体信息需要变更，或入驻时填写有误，可在控制台重新提交入驻申请。'
      },
      { type: 'h2', text: '相关文档' },
      {
        type: 'ul',
        items: [
          { text: '入驻开放平台', href: '/docs/onboarding/' },
          { text: '收入变现', href: '/docs/monetization/' }
        ]
      }
    ]
  },

  skill: {
    title: '技能',
    summary:
      '单文件 node20 源码，导出 exports.handler(event, ctx)。在隔离沙箱中运行，密钥不进入沙箱。',
    blocks: [
      {
        type: 'p',
        text:
          '技能是可被全站 AI 调用的代码能力。上传一个单文件 node20 源码，平台在隔离沙箱中执行，并在需要时转发大模型调用。'
      },
      { type: 'h2', text: '代码规范' },
      {
        type: 'ul',
        items: [
          '运行时：node20 单文件源码。',
          '必须导出 `exports.handler(event, ctx)`。',
          '需要大模型时调用 `ctx.llm.chat(messages, options)`。',
          '源码不超过 64KB。'
        ]
      },
      { type: 'h3', text: 'manifest.json' },
      {
        type: 'code',
        title: 'manifest.json',
        lang: '元数据',
        code: MANIFEST_SAMPLE
      },
      { type: 'h3', text: 'index.js' },
      {
        type: 'code',
        title: 'index.js',
        lang: '运行时入口',
        code: SOURCE_SAMPLE
      },
      {
        type: 'note',
        text:
          '`event.input` 为调用方传入的 JSON；`ctx.llm.chat(messages, options)` 返回 `{ content, usage, model }`。'
      },
      { type: 'h2', text: '沙箱限制' },
      {
        type: 'table',
        head: ['限制项', '规则'],
        rows: [
          ['禁止模块', 'fs / net / child_process / vm'],
          ['环境变量', '禁止读取 process.env'],
          ['超时', '1–15 秒'],
          ['单次大模型调用', '0–3 次'],
          ['输入长度', '不超过 8000 字符'],
          ['源码体积', '不超过 64KB']
        ]
      },
      {
        type: 'p',
        text:
          '密钥不进入沙箱：技能代码看不到平台密钥，大模型调用由平台统一转发，并按 token 计费。'
      },
      { type: 'h2', text: '发布闭环' },
      {
        type: 'p',
        text:
          '创建 → 沙箱调试 → 提交审核 → 平台审核 → 上架 → 版本维护。技能必须至少完成一次成功调试后才能提交审核。'
      },
      { type: 'h2', text: '定价与分成' },
      {
        type: 'p',
        text:
          '技能书价格 18–999 钻石，由开发者自主设定。技能书销售分成：开发者 70%、平台 30%。人类调用技能时的计费方式见收入变现。'
      },
      { type: 'h2', text: '相关文档' },
      {
        type: 'ul',
        items: [
          { text: '收入变现：分成、提现与学习规则', href: '/docs/monetization/' },
          { text: '服务类目', href: '/docs/service-categories/' },
          { text: 'Open API 接口', href: '/docs/openapi/' }
        ]
      }
    ]
  },

  expert: {
    title: '专家',
    summary:
      '以人设与系统提示词定义的智能体，提交人设、开场白与知识范围，无需写代码。',
    blocks: [
      {
        type: 'p',
        text:
          '专家是以人设与系统提示词定义的智能体。它不运行代码，能力边界由你提交的人设与系统提示词决定。'
      },
      { type: 'h2', text: '需要提交的内容' },
      {
        type: 'table',
        head: ['字段', '说明'],
        rows: [
          ['名称 / slug', '控制台与能力目录中展示的名字与唯一标识。'],
          ['赛道', '写作、视觉、视频、语音、知识、社交六选一。'],
          ['定价', '18-999 钻石，上架后由人类一次性购买。'],
          ['角色提示词', '专家套用到 AI 后的人格、专业边界与输出格式要求。'],
          ['开场白', '可选，套用后 AI 对该用户说的第一句话。']
        ]
      },
      {
        type: 'note',
        text: '专家无需写代码，因此不涉及源码体积、沙箱模块限制与调试次数要求。'
      },
      { type: 'h2', text: '发布闭环' },
      {
        type: 'p',
        text:
          '创建 → 提交审核 → 平台审核 → 上架 → 版本维护。专家的发布流程不包含代码调试环节。'
      },
      { type: 'h2', text: '相关文档' },
      {
        type: 'ul',
        items: [
          { text: '连接器', href: '/docs/connector/' },
          { text: '服务类目', href: '/docs/service-categories/' }
        ]
      }
    ]
  },

  connector: {
    title: '连接器',
    summary:
      '声明外部数据源或系统的接入信息，由平台统一网关转发，密钥不进开发者代码。',
    blocks: [
      {
        type: 'p',
        text:
          '连接器用于声明外部数据源或系统的接入信息。开发者只提交声明，实际请求由平台统一网关转发。'
      },
      { type: 'h2', text: '需要声明的信息' },
      {
        type: 'table',
        head: ['字段', '说明'],
        rows: [
          ['名称 / slug', '连接器的名称与唯一标识，用于控制台与能力目录展示。'],
          ['赛道', '写作、视觉、视频、语音、知识、社交六选一。'],
          ['定价', '18-999 钻石，上架后由人类一次性购买。'],
          ['服务地址', '以 https:// 开头的完整接口地址，由平台网关转发。'],
          ['请求方法', 'GET 或 POST。'],
          ['鉴权方式', '无鉴权，或使用由平台统一保管的 API Key。'],
          ['接口说明', '请求参数、返回结构，以及 AI 在什么场景下调用它。']
        ]
      },
      {
        type: 'p',
        text:
          '密钥不进开发者代码：定义中不允许填写真实密钥，鉴权信息由平台统一网关持有并转发。'
      },
      { type: 'h2', text: '发布闭环' },
      {
        type: 'p',
        text:
          '创建 → 提交审核 → 平台审核 → 上架 → 版本维护。连接器的发布流程不包含代码调试环节。'
      },
      { type: 'h2', text: '相关文档' },
      {
        type: 'ul',
        items: [
          { text: '技能', href: '/docs/skill/' },
          { text: '专家', href: '/docs/expert/' }
        ]
      }
    ]
  },

  openapi: {
    title: 'Open API 接口',
    summary:
      'Base URL https://api.openelfai.com，OpenAI 兼容，Bearer 鉴权。对话补全接口为 POST /v1/chat/completions，请求体上限 4MB。',
    blocks: [
      {
        type: 'p',
        text:
          'OpenElf 的 Open API 与 OpenAI Chat Completions 兼容：把 base_url 指向 OpenElf，换成 OpenElf 的 API Key，即可用现有 OpenAI SDK 或客户端调用。'
      },
      { type: 'h2', text: '基本信息' },
      {
        type: 'table',
        head: ['项目', '值'],
        rows: [
          ['Base URL', 'https://api.openelfai.com'],
          ['接口', 'POST /v1/chat/completions'],
          ['兼容性', 'OpenAI 兼容'],
          ['鉴权', 'Bearer 鉴权：Authorization: Bearer <API Key>'],
          ['请求体上限', '4MB']
        ]
      },
      { type: 'h2', text: '请求参数' },
      {
        type: 'table',
        head: ['参数', '说明'],
        rows: [
          ['model', '要调用的模型 ID。'],
          ['messages', '对话消息数组，按 OpenAI 格式传入。'],
          ['stream', 'true 为流式返回，false 或省略为非流式返回。'],
          ['tools', '可选，工具定义列表。'],
          ['tool_choice', '可选，工具选择策略。'],
          ['top_p', '可选，采样参数。']
        ]
      },
      { type: 'h3', text: '请求示例' },
      {
        type: 'code',
        title: 'curl',
        lang: 'Shell',
        code: CURL_SAMPLE
      },
      {
        type: 'code',
        title: 'request body',
        lang: 'JSON',
        code: BODY_SAMPLE
      },
      { type: 'h2', text: '流式与非流式' },
      {
        type: 'p',
        text:
          '`stream: true` 时以流式方式逐段返回结果；`stream: false` 或省略时一次性返回完整响应。两种模式都使用同一个接口与同一把 Key。'
      },
      { type: 'h2', text: '可用模型' },
      {
        type: 'p',
        text:
          '可用模型以 platform_model_catalog 中已登记且配置价格的模型为准。未登记或未配置价格的模型不可调用。'
      },
      { type: 'h2', text: '错误码' },
      {
        type: 'table',
        head: ['状态码', '含义'],
        rows: [
          ['401', '未通过鉴权：API Key 缺失或无效。'],
          ['402', '余额不足：该 AI 持有者的人民币钱包余额不足以支付本次调用。'],
          ['404', '资源不存在：接口路径错误，或请求的模型不可用。'],
          ['413', '请求体超过 4MB 上限。'],
          ['429', '请求过于频繁，触发限流。']
        ]
      },
      {
        type: 'note',
        text:
          '请把 API Key 保存在服务端，不要写入前端代码或公开仓库。'
      },
      { type: 'h2', text: '相关文档' },
      {
        type: 'ul',
        items: [
          { text: '调用计费与收入变现', href: '/docs/monetization/' },
          { text: '开放平台概述', href: '/docs/' }
        ]
      }
    ]
  },

  'developer-agreement': {
    title: '开发者服务协议',
    summary:
      '《OpenElf 开发者服务协议》是入驻的前置条件；勾选同意后方可提交入驻，并在审核通过后创建能力。',
    blocks: [
      {
        type: 'p',
        text:
          '《OpenElf 开发者服务协议》约束开发者在开放平台上的行为。它不是一个可选的补充协议，而是入驻流程中的固定步骤。'
      },
      { type: 'h2', text: '签署时机' },
      {
        type: 'p',
        text:
          '入驻流程为：登录 → 签署《OpenElf 开发者服务协议》→ 选择主体类型 → 提交入驻。未签署协议不能提交入驻。'
      },
      { type: 'h2', text: '协议约束的范围' },
      {
        type: 'ul',
        items: [
          '能力的类型、内容与服务类目。',
          '能力定价、销售分成与收益结算。',
          '调用计费与平台运行规则。'
        ]
      },
      {
        type: 'note',
        text:
          '协议条款以控制台入驻页面展示的版本为准（当前版本 2026-10-30）；签署前请完整阅读。'
      },
      { type: 'h2', text: '相关文档' },
      {
        type: 'ul',
        items: [
          { text: '入驻开放平台', href: '/docs/onboarding/' },
          { text: '收入变现', href: '/docs/monetization/' }
        ]
      }
    ]
  },

  'service-categories': {
    title: '服务类目',
    summary:
      '服务类目用于描述能力所属的领域，在创建能力时选择，供审核与目录展示使用。',
    blocks: [
      {
        type: 'p',
        text:
          '创建技能、专家或连接器时，需要为能力选择服务类目。类目决定能力在目录中的归类，也是审核时的参考信息。'
      },
      { type: 'h2', text: '如何选择' },
      {
        type: 'ul',
        items: [
          '类目应与能力的实际用途一致，而不是与能力的名称一致。',
          '同一能力只选择一个主要类目。',
          '具体可选类目以控制台创建页展示的列表为准。'
        ]
      },
      {
        type: 'note',
        text: '对类目选择有疑问时，可通过控制台提交工单咨询。'
      },
      { type: 'h2', text: '相关文档' },
      {
        type: 'ul',
        items: [
          { text: '技能', href: '/docs/skill/' },
          { text: '专家', href: '/docs/expert/' },
          { text: '连接器', href: '/docs/connector/' }
        ]
      }
    ]
  },

  'operations-data': {
    title: '运营数据',
    summary:
      '已上架能力数、累计安装、累计售出、累计调用与累计收益，以及每个能力的明细。数据按 UTC+8 统计，约 5 分钟延迟。',
    blocks: [
      {
        type: 'p',
        text:
          '控制台的运营数据面板汇总开发者的能力表现，用于判断哪些能力值得继续迭代和投入。'
      },
      { type: 'h2', text: '指标说明' },
      {
        type: 'table',
        head: ['指标', '说明'],
        rows: [
          ['已上架能力', '当前状态为「已上架」的能力数量。'],
          ['累计安装', '能力被学习到 AI 上的累计次数。'],
          ['累计售出', '能力被人类购买的累计次数。'],
          ['累计调用', '能力在被 AI 使用中产生的累计调用次数。'],
          ['累计收益', '已计入的开发者分成总额（人民币）。']
        ]
      },
      {
        type: 'p',
        text:
          '面板下方按能力逐行列出安装、售出、调用与收益，用于对比单个能力的表现。'
      },
      { type: 'h2', text: '统计口径' },
      {
        type: 'p',
        text: '运营数据按 UTC+8 统计，约 5 分钟延迟。'
      },
      {
        type: 'note',
        text:
          '由于存在约 5 分钟延迟，面板数据与实时调用量可能有小幅出入，结算以账单为准。'
      },
      { type: 'h2', text: '相关文档' },
      {
        type: 'ul',
        items: [
          { text: '收入变现', href: '/docs/monetization/' },
          { text: '技能', href: '/docs/skill/' }
        ]
      }
    ]
  },

  monetization: {
    title: '收入变现',
    summary:
      '技能书 18–999 钻石自主定价，开发者分成 70%；收益 T+7 冷静期后转为可提现，最低提现 10 元。',
    blocks: [
      {
        type: 'p',
        text:
          '开发者的收入来自技能书销售分成。AI 调用技能产生的调用费归平台，用于覆盖算力成本，不进入开发者收益。'
      },
      { type: 'h2', text: '技能定价' },
      {
        type: 'p',
        text:
          '技能书价格区间 18–999 钻石，由开发者自主设定。钻石与人民币固定 10:1。'
      },
      { type: 'h2', text: '分成比例' },
      {
        type: 'table',
        head: ['收入类型', '归属'],
        rows: [
          ['技能书销售', '开发者 70%、平台 30%'],
          ['AI 调用技能的调用费', '平台 100%，用于覆盖算力成本']
        ]
      },
      { type: 'h2', text: '学习规则' },
      {
        type: 'ul',
        items: [
          '人类用钻石购买技能书，学到自己的 AI 上即销毁。',
          '每只 AI 对同一技能只能学一次。',
          '技能随 AI 转赠一并转移。',
          '技能书不可转售、不可转赠。'
        ]
      },
      { type: 'h2', text: '调用计费' },
      {
        type: 'p',
        text:
          'AI 调用技能时，按 token 从该 AI 持有者的人民币钱包扣费，调用费 100% 归平台，用于覆盖算力成本。'
      },
      { type: 'h2', text: '结算与提现' },
      {
        type: 'p',
        text:
          '技能书销售收益走平台劳务/服务协议结算。收益分为待结算、可提现、已提现三档：销售收益在 T+7 冷静期后转为可提现。'
      },
      {
        type: 'table',
        head: ['项目', '规则'],
        rows: [
          ['收益状态', '待结算（T+7）/ 可提现 / 已提现'],
          ['最低提现', '10 元'],
          ['手续费', '0.6%'],
          ['单日上限', '2000 元'],
          ['提现条件', '完成实名认证并签署相关协议']
        ]
      },
      {
        type: 'note',
        text:
          '调用费与技能书销售分成是两件不同的事：调用费全部归平台，开发者收益只来自技能书销售。'
      },
      { type: 'h2', text: '相关文档' },
      {
        type: 'ul',
        items: [
          { text: '开发者信息', href: '/docs/developer-profile/' },
          { text: '运营数据', href: '/docs/operations-data/' },
          { text: '开发者服务协议', href: '/docs/developer-agreement/' }
        ]
      }
    ]
  },

  contact: {
    title: '联系渠道',
    summary: '通过控制台提交工单，或在官网底部联系方式反馈。',
    blocks: [
      {
        type: 'p',
        text:
          '入驻审核、能力上架、运营数据与收益结算等问题，都可以通过下面的渠道反馈。'
      },
      { type: 'h2', text: '控制台工单' },
      {
        type: 'p',
        text:
          '登录控制台后提交工单，是处理账号、审核与结算类问题的主要渠道。提交时请说明能力名称与具体问题，便于定位。'
      },
      { type: 'h2', text: '官网反馈' },
      {
        type: 'p',
        text: '官网页面底部同样提供了联系方式，可用于反馈问题与建议。'
      },
      {
        type: 'note',
        text:
          '不要在公开渠道提交 API Key、身份信息或企业证照等敏感内容。'
      },
      { type: 'h2', text: '相关文档' },
      {
        type: 'ul',
        items: [
          { text: '入驻开放平台', href: '/docs/onboarding/' },
          { text: '收入变现', href: '/docs/monetization/' }
        ]
      }
    ]
  }
};

/* 全部条目的阅读顺序（含首页条目） */
export const DOC_ORDER = DOC_GROUPS.flatMap((group) => group.items);

/* 由 [slug] 生成的条目：排除首页条目，首页固定为 /docs/ */
export const DOC_PARAM_SLUGS = DOC_ORDER.filter((slug) => slug !== HOME_SLUG);

const GROUP_OF = DOC_GROUPS.reduce((map, group) => {
  group.items.forEach((slug) => {
    map[slug] = group.label;
  });
  return map;
}, {});

export function docGroupLabel(slug) {
  return GROUP_OF[slug] || '';
}

export function docHref(slug) {
  return slug === HOME_SLUG ? '/docs/' : `/docs/${slug}/`;
}
