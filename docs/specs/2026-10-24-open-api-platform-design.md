# OpenElf 开放 API 平台 — 设计文档

> 2026-10-24 · 方案 A（开源网关做数据面 + 自建控制面）
> 定位：**内部优先，对外顺带**。先让自家 AI 精灵统一走自建网关（拿到真实用量与降级能力），再把同一套网关开放给第三方开发者。
> 对标：OpenRouter（统一路由 + 公开模型榜单）。
> 不动现有钻石/词元经济账本，不动 App 内创作与分发主链路。

---

## 一、定位与目标

### 1.1 一句话

一个 OpenAI 兼容的中转网关：客户端只改 `base_url` 与 `api_key`，就能调用国内主流大模型；平台上同时挂「真实调用榜」与「能力评测榜」，用数据回答"现在该用哪个模型"。

### 1.2 三条产品主张

| 主张 | 落地 |
|---|---|
| 一个接口聚合所有模型 | `POST /v1/chat/completions`，模型名用统一别名（`openelf/auto`、`deepseek/deepseek-chat`） |
| 用真实数据做选择 | 双榜：平台真实用量榜（自有流量，数据真实）+ 能力评测榜（引用公开基准，可溯源） |
| 内部先跑通，再对外 | 第一阶段仅内部 AI 精灵调用；外部开发者白名单灰度，稳定后公开 |

### 1.3 成功标准（MVP）

- 内部 AI 精灵 100% 走网关，线上无 P0 故障；模型调用失败自动降级成功率 ≥ 99%
- 外部开发者接入 ≤ 3 分钟：注册 → 建 Key → 跑通第一个请求
- 计费误差 0：网关账单与上游厂商账单月度对账差异 ≤ 0.5%
- 榜单每周一自动更新，冷启动阶段样本不足的模型有明确标注，不伪造数据

### 1.4 明确不做（MVP 边界）

- 不做团队 / 子账号 / 多成员协作
- 不做图像、视频、语音生成网关（v2，先做文本 + 向量）
- 不做自有模型训练与托管
- 不做 SLA 承诺、发票系统、对公合同流程（人工处理）
- 不做精细化毛利报表（只看月度汇总）
- 不改动钻石→词元的兑换与扣减逻辑

---

## 二、总体架构

```
                    ┌──────────────────────────────┐
   外部开发者 ─────▶│  api.openelfai.com           │
   OpenAI SDK       │  Fastify 5（现有 server 扩展）│
                    │  ┌────────────────────────┐  │
   内部 AI 精灵 ───▶│  │ /v1/*  网关层           │  │
   （服务间签名）    │  │ 鉴权 → 限流 → 预授权     │  │
                    │  │ → 转发 → 结算 → 落日志   │  │
                    │  └──────────┬─────────────┘  │
                    │  ┌──────────▼─────────────┐  │
                    │  │ 控制面 API /api/platform│  │
                    │  └────────────────────────┘  │
                    └───────┬──────────────┬───────┘
                            │ 内网 HTTP     │ MySQL（现有库）
                            ▼              ▼
                    ┌───────────────┐  ┌──────────────┐
                    │ LiteLLM Proxy │  │ platform_*   │
                    │ 127.0.0.1:4000│  │ 表族          │
                    │ 无 DB，仅路由  │  └──────────────┘
                    └───────┬───────┘
                            ▼
              OpenAI / DeepSeek / 通义 / 豆包 / 智谱 / Kimi ...
```

### 2.1 关键决策（ADR）

**ADR-1｜数据面用 LiteLLM Proxy，且以无数据库模式运行。**
LiteLLM 负责厂商适配、OpenAI 格式转换、流式、重试、降级、密钥池负载均衡，这些是最脏的活。但我们**不使用**它的虚拟 Key 与预算体系（那会引入第二套数据库与第二套余额口径），改为只给它一个 `LITELLM_MASTER_KEY`，由 Node 网关独占鉴权与计费。
- 收益：只有一个账本（MySQL）、一个真相源、运维面最小
- 代价：失去 LiteLLM 内置的 spend log，需自己记（本就需要，用于榜单）

**ADR-2｜客户端只访问 Node，不直连 LiteLLM。**
Node 是所有请求的唯一入口。所有带商业逻辑的东西——Key、余额、冻结、限流、日志、榜单归集——都在这里，换掉上游网关不影响客户端契约。

**ADR-3｜复用现有 Fastify + MySQL，不新建服务。**
新增路由挂在现有 `server` 上，复用 `users` / `user_wallets` / 支付宝链路 / JWT。新表统一前缀 `platform_`，不污染现有表。

**ADR-4｜外部计费独立人民币余额，与钻石/词元完全隔离。**
钻石是"用户消费 AI 的凭证、消费即销毁"，语义无法承载开发者预付金。开放 API 用独立的 `platform_wallets`（微元整数记账），不参与创作者分成。

**ADR-5｜对外只开放已完成备案的国产模型，海外模型仅内部可用。**
合规红线。海外模型（OpenAI/Anthropic/Google 等）对境内公众提供服务存在备案与跨境数据风险，MVP 阶段只作为内部调用与境外主体白名单开放。

---

## 三、模型接入与路由

### 3.1 模型命名

对外模型名采用「厂商/模型」二级命名，另有三个聚合别名：

| 别名 | 语义 |
|---|---|
| `openelf/auto` | 成本优先，质量兜底（默认） |
| `openelf/fast` | 低延迟优先，用于实时对话 |
| `openelf/best` | 质量优先，取能力评测榜同分类 Top1 |
| `deepseek/deepseek-chat` | 直指具体模型 |

LiteLLM `config.yaml` 片段：

```yaml
model_list:
  - model_name: deepseek/deepseek-chat
    litellm_params:
      model: deepseek/deepseek-chat
      api_key: os.environ/DEEPSEEK_KEY_1
      rpm: 500
  - model_name: deepseek/deepseek-chat
    litellm_params:
      model: deepseek/deepseek-chat
      api_key: os.environ/DEEPSEEK_KEY_2   # 同模型多 Key，自动轮询
      rpm: 500

router_settings:
  routing_strategy: usage-based-routing-v2
  num_retries: 1
  timeout: 60
  allowed_fails: 2
  cooldown_time: 60
```

同模型挂多 Key 由 LiteLLM 轮询；单 Key 额度耗尽或限流自动切换。

### 3.2 路由策略（`openelf/auto`）

请求进入后依次执行：

1. **归一化**：识别能力需求——带 `tools` → 需 function calling；带 `image_url` → 需多模态；`response_format=json_object` → 需 JSON 模式
2. **过滤**：地域许可（外部用户仅国产）、上下文长度足够、能力标签匹配、模型状态 `active`、上游 Key 池可用
3. **打分排序**：
   ```
   score = quality_norm − λ × cost_norm
   ```
   - `quality_norm`：能力评测榜同分类分数归一化到 0–1
   - `cost_norm`：该模型售价归一化到 0–1
   - `λ` 按用户档位：免费 0.8（省钱）、标准 0.4、专业 0.15（质量优先）
4. **降级链**：主模型返回 5xx / 超时 / 内容审核失败 → 按排序取下一个；同一模型连续失败 3 次熔断 60 秒

路由结果写入响应头 `x-openelf-model`，便于排查。

### 3.3 首批接入（M1，10 家）

DeepSeek、豆包（火山方舟）、通义千问、智谱 GLM、Kimi（Moonshot）、文心一言、混元、阶跃星辰、MiniMax、百川。均为国内已备案厂商，覆盖对话、代码、长上下文三类主力场景。

---

## 四、鉴权与密钥

### 4.1 API Key

- 格式：`oe-sk-<8位标识>.<40位随机>`，仅在创建时明文返回一次
- 存储：`key_hash = SHA-256(明文 + PEPPER)`，同时存 `key_prefix`（前 12 位）用于列表展示
- 校验：`Authorization: Bearer oe-sk-...` → 取前缀查索引 → 哈希比对（`crypto.timingSafeEqual`）
- 作用域：`allowed_models`（空=全量）、`monthly_budget_micro`、`ip_allowlist`、`qps_limit`
- 吊销：软删除 `revoked_at`，缓存（进程内 LRU，TTL 60s）失效

### 4.2 内部调用

内部 AI 精灵走 `/internal/v1/chat/completions`，不带 API Key，改用服务间签名：

```
X-OE-Service: app-server
X-OE-Timestamp: 1792773996
X-OE-Signature: HMAC-SHA256(ts + path + body_sha256, INTERNAL_CALLBACK_SECRET)
```

签名窗口 300 秒，超时拒绝。内网地址绑定，nginx 层面不把 `/internal/*` 暴露公网。

### 4.3 控制台登录

复用现有手机号 + 短信验证码登录，JWT 与 App 同一套（`server/src/security.js`）。开发者首次开通平台时补充：实名信息、用途说明、联系方式——存 `platform_developers`。

---

## 五、计费与余额

### 5.0 结算体系双轨设计（法币 / 链上代币）

平台存在**两套物理隔离的结算账本**，互不互通、互不兑换，网关层根据 Key 的 `region` 字段路由到对应账本。

#### 5.0.1 国内法币账本（region=domestic）

- **记账单位**：微元（micro-RMB），`1 元 = 1,000,000 微元`，BIGINT 整数存储
- **充值**：人民币，走支付宝/微信支付
- **服务对象**：境内用户与开发者
- **入口域名**：`api.openelfai.com`

> 微元的本质是人民币的整数表达（类似微信支付用「分」），不是代币。用整数是为了避免 LLM 细粒度计费长期累计后的浮点误差。
>
> 国内现有的「链接精灵」联盟链体系（AI 精灵 NFT、授权记录、版权存证）与本 API 平台独立运营，互不依赖。AI 精灵的链上身份与归属由链接精灵维护，API 平台不读写链上数据。

#### 5.0.2 香港代币账本（region=overseas，M7 落地）

- **记账单位**：链上原生余额（USDT / ETH / BTC），平台内部做余额快照
- **充值**：境外用户钱包直连，链上转账
- **链上用途**：代币充值、结算、提现；可选发行合规代币或直接用稳定币
- **服务对象**：境外用户与企业（符合香港 SFC VASP 监管）
- **入口域名**：`api.openelf.hk`（独立节点，物理隔离）

#### 5.0.3 隔离与路由原则

| 原则 | 说明 |
|---|---|
| 账本物理隔离 | `platform_wallets`（人民币）与 `platform_wallets_crypto`（代币）分库或分表，无外键关联 |
| 禁止互兑 | 微元 ↔ 代币之间不存在兑换接口，避免跨境资金流动合规风险 |
| 网关层路由 | 同一个 `/v1/chat/completions`，按 Key 的 `region` 走对应账本；上游模型调用逻辑（LiteLLM 路由、降级、日志）完全复用 |
| 国内不碰链 | API 平台不接入任何国内链，AI 精灵的 NFT/授权等链上事务由「链接精灵」独立处理 |

### 5.1 记账口径（国内法币账本）

统一使用**微元**（micro-RMB，整数）：`1 元 = 1_000_000 微元`。全程整数运算，避免浮点误差。

价格存储为「每百万 token 的微元数」：

```
tokens 计费 = round(prompt_tokens × input_price + completion_tokens × output_price) / 1_000_000
```

**示例**：DeepSeek-Chat 输入 1 元/百万、输出 2 元/百万；一次请求 prompt 1200、completion 800：
- 成本 = (1200×1_000_000 + 800×2_000_000) / 1_000_000 = 2,800 微元 = 0.0028 元
- 对外售价（×1.15）= 3,220 微元 = 0.00322 元

### 5.2 加价率

| 对象 | 加价率 | 说明 |
|---|---|---|
| 内部 AI 精灵 | ×1.00 | 零加价，只做成本归集 |
| 外部 · 国产模型 | ×1.15 | 覆盖运维、支付通道、汇率 |
| 外部 · 海外模型 | ×1.30 | 仅白名单，覆盖跨境与汇率波动 |
| 向量 / Embedding | ×1.10 | 成本低但请求密，单独档 |

上游调价后更新 `platform_model_price`（带 `effective_from`），老订单按当时价格结算，不做追溯。

### 5.3 预授权 → 结算

单次请求的余额处理分三步，保证不超支：

1. **预授权冻结**：`freeze = (prompt_tokens_估算 × input_price + max_tokens × output_price) × 加价率`，写入 `frozen_micro`
   - 估算用 `js-tiktoken` 精确计数；tokenizer 缺失时按 `字符数 / 2.2` 兜底
   - `max_tokens` 缺省取模型上限与该档位单请求上限（默认 4096）的较小值
2. **实际结算**：拿到 `usage` 后按实际 token 计费，`frozen` 释放、差额退回
3. **兜底释放**：请求异常且 180 秒内未回填 usage → 释放全部冻结，记 `status=failed`，不计费

余额不足返回 OpenAI 兼容错误，客户端 SDK 无需特殊处理：

```json
{
  "error": {
    "message": "账户余额不足，请前往控制台充值",
    "type": "insufficient_quota",
    "code": "insufficient_balance"
  }
}
```

### 5.4 充值

复用现有支付宝链路（`server/src/alipay.js` + `alipay_gateway.js`），新增商品类型 `api_credit`：

- 最小 10 元，档位 10 / 50 / 200 / 500 / 1000
- 支付成功回调 → 写 `platform_topups` + `platform_ledger(type=topup)` → 加余额
- 未消费余额支持人工退款（MVP 走工单，不自动退）
- 赠送额度不做，避免与「钻石不可回流」的硬约束产生语义混淆

### 5.5 成本失控防护（四道闸）

| 闸门 | 阈值 | 动作 |
|---|---|---|
| 单请求 | `max_tokens` > 8192 或 prompt > 模型上限 | 400 拒绝 |
| 单 Key | `qps_limit`（默认 5） | 429 + `Retry-After` |
| 单用户日 | 日支出 > `daily_cap_micro`（默认 50 元） | 402 拒绝 |
| 全平台日 | 全站日成本 > 熔断值 | 非内部请求全部 503，告警 |

---

## 六、用量计量与日志

每次请求写一行 `platform_requests`（按月分区，保留 13 个月）：

| 字段 | 说明 |
|---|---|
| `id` | 请求 ID（同时回写响应头 `x-request-id`） |
| `user_id` / `key_id` / `source` | `source`：`internal` / `external` |
| `requested_model` / `resolved_model` | 请求别名 vs 实际命中模型 |
| `prompt_tokens` / `completion_tokens` | 来自上游 usage |
| `cost_micro` / `price_micro` | 成本 vs 实收 |
| `latency_ms` / `ttft_ms` | 总耗时 / 首字耗时（流式） |
| `status` / `error_code` | `ok` / `upstream_error` / `timeout` / `rejected` |
| `created_at` | BIGINT 毫秒时间戳（与现有表一致） |

**流式请求的 usage 获取**：转发时自动注入 `stream_options: { include_usage: true }`。上游不支持时，使用最后一个 chunk 的 usage；仍无则用 tokenizer 估算并标记 `estimated=1`。

**日志脱敏**：不记录 Key 明文、不记录完整 prompt（只记 token 数与哈希），仅在 debug 开关下记录前 200 字符。

---

## 七、双榜设计

### 7.1 真实用量榜（自有数据）

**口径**（周榜，周一 00:00 UTC+8 结算）：

- 仅统计 `status=ok`、非测试 Key 的请求
- 指标：总 token、请求数、成功率、P50/P95 延迟、实收单价（元/百万 token）
- 分列「内部 / 外部」占比，避免外部流量小的时候榜单看起来造假
- **防刷**：单账号贡献超过该模型周总量 60% 时标注「单一来源」；测试 Key 与内部白名单 Key 不计入
- **冷启动保护**：模型周 token < 50,000 → 展示但标注「样本不足」

榜单不做累计去重清洗（会失真），只在展示层做比例标注。

### 7.2 能力评测榜（公开数据）

引用公开基准，存储快照 + 来源链接 + 抓取时间：

| 基准 | 用途 | 更新 |
|---|---|---|
| LMArena Elo | 对话通用能力 | 双周 |
| Artificial Analysis 综合分 | 综合 + 速度 + 价格 | 月 |
| SWE-bench Verified | 代码能力 | 季度 |
| LiveBench | 抗污染评测 | 月 |

原则：**只引用，不自研评分**，每个分数都带 `source_url` 与 `fetched_at`，避免"我们的榜我们说了算"的质疑。半自动流程：脚本抓取 → 人工核对 → 入库，抓取失败不覆盖旧数据。

### 7.3 榜单 API 与页面

```
GET /api/platform/rankings?type=usage|benchmark&category=chat|code|vision&period=week
```

官网 `/rankings` 页面双 Tab 并列展示。由于官网是静态导出，采用两级数据源：
- 首屏：构建时读取 `web/data/rankings-snapshot.json`（运维每周更新后重新构建，利于 SEO 与无 JS 场景）
- 交互：客户端请求实时 API，筛选切换走实时数据，5 分钟浏览器缓存

---

## 八、内部 AI 精灵接入

现有 App 的 AI 产出为本地模拟生成（真实大模型接入在 v2）。本设计的内部接入是**为 v2 铺路**，M1 阶段先打通通道并用 feature flag 控制：

- App 服务端调用 `/internal/v1/chat/completions`，body 额外带 `elf_id`、`owner_user_id`
- 网关按内部价（×1.00）记成本，归集到 `platform_cost_by_elf` 视图
- **词元账本不变**：扣减仍在现有 AI 运营逻辑中完成，网关不读写词元，避免破坏「词元不可反向兑换」的硬约束
- 收益：统一降级、统一限流、真实用量数据进入榜单、未来换模型只改网关配置

---

## 九、数据模型（MySQL）

全部新表前缀 `platform_`，与现有 `users` / `user_wallets` / `payment_*` 并存。
建表方式沿用现有约定：新建 `server/src/platform/tables.js` 导出 `PLATFORM_TABLES`，由 `server/src/db.js` 的 `TABLES` 数组合并，启动时 `CREATE TABLE IF NOT EXISTS`，不引入迁移框架。

```sql
-- 开发者档案（复用 users.id，一对零或一）
CREATE TABLE platform_developers (
  user_id      VARCHAR(40) PRIMARY KEY,
  real_name    VARCHAR(64) NOT NULL,
  purpose      VARCHAR(255) NOT NULL,      -- 用途说明，合规留档
  status       VARCHAR(16) NOT NULL DEFAULT 'pending',  -- pending|active|suspended
  tier         VARCHAR(16) NOT NULL DEFAULT 'standard', -- free|standard|pro
  created_at   BIGINT NOT NULL,
  approved_at  BIGINT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE platform_api_keys (
  id           CHAR(36) PRIMARY KEY,
  user_id      VARCHAR(40) NOT NULL,
  name         VARCHAR(64) NOT NULL,
  key_prefix   VARCHAR(16) NOT NULL,
  key_hash     CHAR(64) NOT NULL UNIQUE,
  allowed_models VARCHAR(512) NULL,        -- 逗号分隔，空=全量
  monthly_budget_micro BIGINT UNSIGNED NOT NULL DEFAULT 0,
  qps_limit    INT NOT NULL DEFAULT 5,
  ip_allowlist VARCHAR(512) NULL,
  created_at   BIGINT NOT NULL,
  last_used_at BIGINT NULL,
  revoked_at   BIGINT NULL,
  INDEX idx_keys_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE platform_wallets (
  user_id        VARCHAR(40) PRIMARY KEY,
  balance_micro  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  frozen_micro   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  total_topup_micro BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at     BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE platform_ledger (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id    VARCHAR(40) NOT NULL,
  key_id     CHAR(36) NULL,
  request_id CHAR(36) NULL,
  type       VARCHAR(16) NOT NULL,         -- topup|charge|refund|adjust
  delta_micro BIGINT NOT NULL,             -- 正入负出
  balance_after BIGINT UNSIGNED NOT NULL,
  note       VARCHAR(255) NULL,
  created_at BIGINT NOT NULL,
  INDEX idx_ledger_user_time (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE platform_model_catalog (
  model_id       VARCHAR(64) PRIMARY KEY,  -- 对外别名，如 deepseek/deepseek-chat
  vendor         VARCHAR(64) NOT NULL,
  display_name   VARCHAR(64) NOT NULL,
  region         VARCHAR(16) NOT NULL,     -- domestic|overseas
  capabilities   VARCHAR(128) NOT NULL,    -- chat,vision,tools,json,embedding
  context_tokens INT NOT NULL,
  status         VARCHAR(16) NOT NULL DEFAULT 'active',
  external_only  TINYINT(1) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE platform_model_price (
  model_id      VARCHAR(64) NOT NULL,
  input_micro_per_1m  BIGINT UNSIGNED NOT NULL,
  output_micro_per_1m BIGINT UNSIGNED NOT NULL,
  markup_bp     INT NOT NULL DEFAULT 1150, -- 千分比基点，1150=×1.15
  effective_from BIGINT NOT NULL,
  PRIMARY KEY (model_id, effective_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE platform_requests (
  id           CHAR(36) NOT NULL,
  user_id      VARCHAR(40) NOT NULL,
  key_id       CHAR(36) NULL,
  source       VARCHAR(16) NOT NULL,
  requested_model VARCHAR(64) NOT NULL,
  resolved_model  VARCHAR(64) NOT NULL,
  prompt_tokens     INT UNSIGNED NOT NULL DEFAULT 0,
  completion_tokens INT UNSIGNED NOT NULL DEFAULT 0,
  cost_micro   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  price_micro  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  latency_ms   INT UNSIGNED NOT NULL DEFAULT 0,
  ttft_ms      INT UNSIGNED NOT NULL DEFAULT 0,
  status       VARCHAR(16) NOT NULL,
  error_code   VARCHAR(32) NULL,
  estimated    TINYINT(1) NOT NULL DEFAULT 0,
  created_at   BIGINT NOT NULL,
  PRIMARY KEY (id, created_at),
  INDEX idx_req_model_time (resolved_model, created_at),
  INDEX idx_req_user_time (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE platform_rank_weekly (
  week_start   DATE NOT NULL,
  model_id     VARCHAR(64) NOT NULL,
  total_tokens BIGINT UNSIGNED NOT NULL,
  requests     INT UNSIGNED NOT NULL,
  success_rate DECIMAL(5,4) NOT NULL,
  p50_latency_ms INT UNSIGNED NOT NULL,
  p95_latency_ms INT UNSIGNED NOT NULL,
  unit_price_micro BIGINT UNSIGNED NOT NULL,
  internal_ratio DECIMAL(5,4) NOT NULL,
  single_source TINYINT(1) NOT NULL DEFAULT 0,
  low_sample   TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (week_start, model_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE platform_benchmarks (
  model_id    VARCHAR(64) NOT NULL,
  benchmark   VARCHAR(64) NOT NULL,
  category    VARCHAR(32) NOT NULL,
  score       DECIMAL(10,4) NOT NULL,
  source_url  VARCHAR(512) NOT NULL,
  fetched_at  BIGINT NOT NULL,
  PRIMARY KEY (model_id, benchmark, fetched_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE platform_topups (
  id          CHAR(36) PRIMARY KEY,
  user_id     VARCHAR(40) NOT NULL,
  amount_micro BIGINT UNSIGNED NOT NULL,
  channel     VARCHAR(16) NOT NULL,   -- alipay|apple
  trade_no    VARCHAR(64) NULL,
  status      VARCHAR(16) NOT NULL,   -- pending|paid|failed|refunded
  created_at  BIGINT NOT NULL,
  paid_at     BIGINT NULL,
  INDEX idx_topup_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 香港代币账本（region=overseas，M8 落地） ──────────────
CREATE TABLE platform_wallets_crypto (
  user_id      VARCHAR(40) NOT NULL,
  chain        VARCHAR(16) NOT NULL,   -- eth|tron|btc
  asset        VARCHAR(16) NOT NULL,   -- USDT|ETH|BTC
  address      VARCHAR(128) NOT NULL,  -- 平台托管地址或用户自托管地址哈希
  balance_raw  DECIMAL(36,8) NOT NULL DEFAULT 0,  -- 链上原始余额
  balance_usd  DECIMAL(36,8) NOT NULL DEFAULT 0,  -- 折算 USD 快照
  frozen_usd   DECIMAL(36,8) NOT NULL DEFAULT 0,
  last_sync_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, chain, asset)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE platform_crypto_tx (
  id           CHAR(36) PRIMARY KEY,
  user_id      VARCHAR(40) NOT NULL,
  chain        VARCHAR(16) NOT NULL,
  asset        VARCHAR(16) NOT NULL,
  tx_hash      VARCHAR(128) NOT NULL UNIQUE,
  direction    VARCHAR(8) NOT NULL,    -- deposit|withdraw
  amount_raw   DECIMAL(36,8) NOT NULL,
  amount_usd   DECIMAL(36,8) NOT NULL,
  status       VARCHAR(16) NOT NULL,   -- pending|confirmed|failed
  created_at   BIGINT NOT NULL,
  confirmed_at BIGINT NULL,
  INDEX idx_ct_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

`platform_requests` 按 `created_at` 月分区；MVP 数据量小，先不分区，超过 500 万行再分区。

---

## 十、接口清单

### 10.1 对外（OpenAI 兼容，域名 `api.openelfai.com`）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/v1/chat/completions` | 对话，支持 `stream` |
| POST | `/v1/embeddings` | 向量 |
| POST | `/v1/images/generations` | v2 预留，MVP 返回 501 |
| GET | `/v1/models` | 可用模型列表（按 Key 作用域过滤） |
| GET | `/v1/models/{id}` | 单模型详情（上下文、能力、价格） |
| GET | `/health` | 存活探针，无需鉴权 |

### 10.2 控制台（`/api/platform/*`，JWT 鉴权）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/platform/me` | 开发者档案 + 余额 |
| GET/POST | `/api/platform/keys` | 列表 / 创建（创建时返回明文一次） |
| DELETE | `/api/platform/keys/:id` | 吊销 |
| PATCH | `/api/platform/keys/:id` | 改名、限额、IP 白名单 |
| GET | `/api/platform/usage?from=&to=&group=model\|day` | 用量时序 |
| GET | `/api/platform/ledger?cursor=` | 账本流水 |
| POST | `/api/platform/topup` | 创建充值订单（返回支付参数） |
| GET | `/api/platform/rankings` | 双榜数据 |
| GET | `/api/platform/pricing` | 模型价格表 |

### 10.3 内部（`/internal/*`，仅内网 + 服务签名）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/internal/v1/chat/completions` | 内部 AI 精灵调用 |
| POST | `/internal/rankings/rollup` | 触发周榜聚合（供 cron 调用） |
| POST | `/internal/benchmarks/sync` | 写入评测基准快照 |
| GET | `/internal/metrics` | Prometheus 文本格式指标 |

---

## 十一、工程结构

```
server/src/platform/
  tables.js       # PLATFORM_TABLES 建表语句，由 db.js 合并
  gateway.js      # /v1/* 路由：鉴权 → 限流 → 预授权 → 转发 → 结算
  api_key.js      # Key 生成/哈希/校验/缓存
  billing.js      # 微元记账、冻结、结算、账本（国内法币）
  billing_crypto.js # 香港代币账本、链上充值/提现、余额快照（M7）
  upstream.js     # 转发 LiteLLM，流式透传，usage 提取
  catalog.js      # 模型目录 + 价格 + 路由候选过滤
  rankings.js     # 周榜聚合、评测快照
  internal.js     # 内部调用与服务签名
  admin.js        # 控制台 API
  chain/hk.js     # 香港公链接口（USDT/ETH/BTC 充值提现、余额查询）
server/litellm/config.yaml       # 模型与 Key 池配置（不入库）
server/test/platform_*.test.js   # node --test，与现有测试同风格

web/app/platform/page.js         # 官网开放平台介绍页
web/app/rankings/page.js         # 双榜页面
web/app/console/page.js          # 开发者控制台（纯客户端，调 api 域名）
web/data/rankings-snapshot.json  # 构建时榜单快照
```

控制台做成纯客户端页面（静态导出 + 调 API），避免官网从静态导出改成服务端渲染。API 域名开启 CORS，白名单仅 `openelfai.com` 与 `platform.openelfai.com`。

---

## 十二、部署

沿用现有服务器拓扑（`root@180.184.160.179`，系统 nginx + certbot）：

```
api.openelfai.com  → 127.0.0.1:8787（现有 Fastify，新增 /v1 与内部路由）
127.0.0.1:4000     → LiteLLM Proxy（docker compose，仅监听回环，不对外）
```

- LiteLLM 用 docker compose 管理，`config.yaml` 挂载，上游 Key 通过环境变量注入
- nginx 新增 `api.openelfai.com` server block；`/internal/*` 在 nginx 层直接 `return 404`，杜绝公网访问
- 证书复用 certbot，续期钩子沿用 `/etc/letsencrypt/renewal-hooks/deploy/`
- 新增环境变量：`LITELLM_MASTER_KEY`、`LITELLM_BASE_URL`、`PLATFORM_KEY_PEPPER`、`INTERNAL_CALLBACK_SECRET`、各厂商 `*_KEY_*`

### 12.1 香港节点（独立部署，M7）

```
api.openelf.hk     → 香港节点 Fastify（独立进程，region=overseas）
127.0.0.1:4001     → LiteLLM Proxy（香港区模型 Key 池）
公链 RPC            → 以太坊/波场/比特币节点（自有或服务商）
```

- 香港节点与境内节点**物理隔离**，独立数据库实例，不共享账本
- 数据跨境：境内不存储境外用户的链上地址与交易记录；境外不存储境内用户的实名信息
- 合规：按香港 SFC VASP 牌照要求做 KYC/AML、可疑交易上报、资产储备证明

**回滚**：网关以 feature flag（`PLATFORM_ENABLED`）控制，关闭后 `/v1/*` 返回 503，内部调用回落到原路径，不影响 App。

---

## 十三、可观测性

| 维度 | 手段 |
|---|---|
| 请求 | 结构化日志（stdout）含 request_id、模型、状态、耗时 |
| 指标 | `/internal/metrics` 输出 QPS、错误率、P95 延迟、冻结余额总量、各厂商错误计数 |
| 告警 | 5 分钟错误率 > 5%、某厂商连续失败、日成本超阈值、上游 401（Key 失效）→ 企业微信/飞书机器人 |
| 对账 | 每日 job 聚合当日成本，与厂商后台账单人工核对（月度） |

---

## 十四、安全与合规

- Key 明文仅存于创建时的响应，之后不可再读取；日志与错误信息不含 Key
- 全站 HTTPS；管理接口强制 JWT + 频率限制
- 开发者实名 + 用途留档；内容安全依赖上游厂商审核，网关透传 `content_filter` 错误并降级
- 面向境内公众的服务只使用已备案国产模型（ADR-5）
- 生成内容标识：响应头加 `x-ai-generated: true`，文档中要求接入方在自身产品中明示 AI 生成
- 数据不留存：网关不保存 prompt 正文，仅保存 token 数与哈希，降低数据合规负担
- 滥用防护：新账号首日限额 5 元；异常高频（> 100 QPS）自动暂停并人工复核

---

## 十五、里程碑

| 阶段 | 交付 | 验收 |
|---|---|---|
| **M0 基础设施** | LiteLLM 容器 + 模型配置 + 环境变量 + api 域名与证书 | 用 curl 直连 LiteLLM 打通 10 家模型中至少 5 家 |
| **M1 网关数据面** | `/v1/chat/completions`、Key 校验、预授权结算、请求日志、降级链 | 内部测试 Key 跑 1000 次压测，计费误差 0，错误率 < 1% |
| **M2 控制台** | 开发者档案、Key 管理、余额与用量、账本 | 新建账号 3 分钟内跑通第一个请求 |
| **M3 充值** | 支付宝 `api_credit` 商品、回调入账、退款工单 | 10 元充值到账 ≤ 5 秒，账本可追溯 |
| **M4 榜单** | 周榜聚合 job、评测同步、`/rankings` 页面 | 周一自动出榜，样本不足有标注 |
| **M5 官网与文档** | `/platform` 介绍页、接入文档、SDK 示例 | 复制示例代码可直接跑通 |
| **M6 对外灰度** | 白名单开放 → 公开注册 | 灰度 20 个开发者，无 P0，成本可控 |
| **M7 香港通道** | 香港独立节点、USDT/ETH/BTC 充值提现、`region=overseas` 账本路由、SFC 合规对接 | 境外用户钱包充值 USDT 后可调用，账本与境内物理隔离 |

依赖关系：M1 依赖 M0；M2 依赖 M1；M3 可与 M2 并行；M4 依赖 M1 有真实数据；M6 依赖 M3+M4+M5；M7 依赖 M6 稳定后启动。

---

## 十六、风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 上游厂商封号 / 改价 | 服务中断、成本倒挂 | 每模型 ≥ 2 个 Key 池、季度复核价格、加价率覆盖 15% 波动 |
| 合规（跨境模型） | 下架风险 | 对外仅国产模型；海外模型内部专用 |
| 榜单被质疑公正性 | 品牌受损 | 双榜分离、公开口径、标注来源与样本量 |
| 外部调用量太小 | 榜单冷清 | 内部流量先喂榜，分列展示内部/外部占比 |
| 流式请求用量丢失 | 计费不准 | `include_usage` + tokenizer 兜底 + 每日对账 |
| LiteLLM 版本升级破坏兼容 | 网关异常 | 锁定镜像 tag，升级走独立环境验证 |
| 预授权冻结泄漏 | 余额显示异常 | 180 秒兜底释放 + 每小时对账任务修复孤儿冻结 |
| 香港 VASP 牌照未获批 | 香港通道无法合法运营 | M7 启动前先做牌照可行性评估；备选方案是仅做技术接口预留，不实际运营代币业务 |
| 链上私钥泄露 | 资金损失 | 香港节点用 HSM 或多方签名（MPC）管理热钱包，冷钱包离线存储，提现人工复核 |
| 稳定币脱锚 | 香港账本估值失真 | 主要以 USDT 计价，ETH/BTC 实时折算 USD，余额快照每 10 分钟刷新 |

---

## 十七、待定项（需要你拍板）

1. **控制台域名**：默认 `openelfai.com/console`（本文档按此写）；若改成独立子域 `platform.openelfai.com`，只需迁移页面目录与 CORS 白名单
2. **对外开放节奏**：直接公开注册，还是先邀请制 20 人灰度？
3. **免费额度**：新开发者是否送 1 元体验金？（送钱会引入刷号风险，我倾向不送）
4. **海外模型白名单**：是否需要给境外主体或企业客户开放（会影响合规方案与定价档位）
5. **首批接入模型清单**：上面 10 家是否调整
