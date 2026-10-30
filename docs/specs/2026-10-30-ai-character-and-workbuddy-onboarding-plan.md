# OpenElf × WorkBuddy 入驻 与 AI 角色创作 — 开发计划

> 2026-10-30 · 方向修正版（取代同日 `open-resource-platform-plan`）
> 主线：先优化 AI 创建路径 → 定义配件组合规则 → 用生成器产出唯一形象 → 以四类资源入驻 WorkBuddy。
> 已确认：四类资源都做；形象采用「分层合成 + 大模型精修」；生成器为前端原型，链上铸造在 linksprite-backend。

---

## 〇、方向修正说明

原方案是「OpenElf 自建一套 WorkBuddy 式资源市场」，资源留在自家生态消费。本次改为**做客方**：

- WorkBuddy 的四类资源（Buddy 应用 / 专家 / 技能 / 连接器）是**我们的上架形态**，不是我们要自建的平台。
- 入驻的竞争力来自创作内核，所以顺序是「创作内核 → 形象生成 → 入驻包装」，不是先做包格式。
- 原方案里的统一资源注册表、审核队列、资源市场等全部后移，不阻塞入驻。

一句话：**先把「造角色」这件事做成可被外部调用的标准能力，再把它包成 WorkBuddy 能装的东西。**

三条主线：

| 主线 | 内容 | 铸造方式 |
|---|---|---|
| A. UGC 单角色 | 文字描述 / 身份证授权 → 一只 AI NFT | `POST /copyright/register-ugc` → `POST /nft/mint/ugc` |
| B. 千人千面 | 运营批量生产角色系列 | `POST /auth/register` → `POST /nft/mint/b2b` |
| C. 精修工坊 | AI 精修配件 → 可用的千人千面角色；后台运营工具 + WorkBuddy 上架产品，后续站内开放 | 不直接铸造，产出供 A/B 使用 |

---

## 一、目标与成功标准

| 目标 | 验收 |
|---|---|
| 创建路径重构 | 文字模板 / 身份证授权两条线都能产出「角色卡」；草稿不扣钻石，生成走用户 API Key，铸造才扣钻石 |
| 配件组合 | 9 类 slot 可组合，结果可预览、可重掷；铸造后形象固定不可变 |
| 千人千面 | 同一套部件组合，不同 seed 产出不重复形象；每只 AI 有独立立绘 |
| 形象生成 | 链接精灵生成器合成图 + 大模型精修，失败自动降级为纯合成图 |
| WorkBuddy 入驻 | 四类资源包齐备并通过审核；连接器可让外部用户完成「描述 → 预览 → 铸造」 |

---

## 二、现状盘点

| 能力 | 现状 | 位置 |
|---|---|---|
| 创建流程 | 三步：形象来源（文字/身份证）→ 人格 → 合规提交 | [create_elf_page.dart](file:///c:/官网html/openelf/openelfai/app/lib/pages/create_elf_page.dart#L11-L14) |
| 形象预览 | 站内程序化绘制，仅作占位；生成接口已预留 | 同上 `_generate` |
| 创建落库 | 一步完成：扣 `CREATE_ELF_COST` 钻石 + 建 AI + 设 activeElf | [commerce.js](file:///c:/官网html/openelf/openelfai/server/src/commerce.js#L875-L901) |
| 实名与身份证授权 | 已有：正反面上传 + 阿里云 OCR + 二要素 + 授权声明 | [identity_verify_page.dart](file:///c:/官网html/openelf/openelfai/app/lib/pages/identity_verify_page.dart#L274-L370) |
| 形象资产管线 | 已有 SVG 矢量源 → PNG 栅格化，含尺寸与用途规范 | [visual-spec.md](file:///c:/官网html/openelf/whale-ling-asset-pack/docs/visual-spec.md#L6-L41) |
| 着装配件 | **无**：没有部件目录、装配、稀有度概念 | — |
| 链接精灵确权/铸造 | 已有：`POST /copyright/register-ugc`（存证+DCI）、`POST /copyright/deposit`、`POST /auth/register`（授权登记）、`POST /nft/mint/ugc`、`POST /nft/mint/b2b`、`POST /nft/transfer` | [CopyrightController.java](file:///c:/官网html/KOKO/linksprite-backend/src/main/java/com/linksprite/controller/CopyrightController.java#L29-L45)、[AuthorizationController.java](file:///c:/官网html/KOKO/linksprite-backend/src/main/java/com/linksprite/controller/AuthorizationController.java#L26-L43)、[NftController.java](file:///c:/官网html/KOKO/linksprite-backend/src/main/java/com/linksprite/controller/NftController.java#L27-L58) |
| 链环境 | `antchain.quezao` 与 `fisco` 当前均为关闭状态，写接口返回「未启用」 | [AntChainGatewayClient.java](file:///c:/官网html/KOKO/linksprite-backend/src/main/java/com/linksprite/service/AntChainGatewayClient.java#L47-L61) |
| WorkBuddy 包格式 | 无：连接器/技能/专家/应用包均未制作 | — |
| 大模型可用性 | 仅 DeepSeek 配置了真实 Key，无图像模型 | [config](file:///c:/官网html/openelf/openelfai/server/src/config.js) |

---

## 三、创作内核：角色卡（Character）

### 3.1 为什么要拆

现在「创建」一步把**形象、人格、资产铸造、扣费**全做完，导致：生成后无法重掷、配件组合无法反复调整、外部调用（WorkBuddy）没法只做预览。改为三段：

```
角色卡（草稿，免费） → 配件选择与预览（免费） → 形象生成（走用户 API Key，扣人民币）
  → 形象存草稿 → 用户自行决定 → 铸造（扣钻石 + 确权上链 + 成为 AI 智能体）
```

### 3.2 数据模型

复用现有实体存储（与 `elf` / `book` 同库，新增 `character` 实体）：

| 字段 | 说明 |
|---|---|
| `id` | 角色卡 ID |
| `ownerId` | 归属用户 |
| `name` | 角色名 |
| `source` | `text` / `idCard` |
| `style` | 通用 / 像素画 / 言情漫画 / 细腻厚涂 |
| `prompt` | 自由描述（文字线）或固定为「实名本人形象」 |
| `traits` | `{slot: partId}` 装配结果 |
| `seed` | 千人千面随机种子（创建时生成，可重掷） |
| `persona` / `fear` / `habit` | 人格三字段 |
| `status` | `draft` / `minted` |
| `elfId` | 铸造后对应的 AI ID |
| `image` | 合成图 / 精修图 / 缩略图 URL 与版本号 |
| `createdAt` / `updatedAt` | 时间戳 |

### 3.3 两条创建入口

**文字模板线（对内外都开放）**

- 结构化表单：风格 + 体型 + 发型/发色 + 服装基调 + 场景 + 气质，加一句自由描述
- 预设模板：沿用现有 4 种风格，扩到 8 个模板（含示例文案），降低「不知道写什么」的流失
- 输出：带 `prompt + style` 的角色卡草稿

**身份证授权线（仅 OpenElf 端开放）**

- 复用现有实名：服务端校验 `identity.status === 'verified'`，客户端标记不采信
- 人像面作为精修阶段的面部参考输入；**不公开、不进入信息流、不传出平台**
- 对外入驻版本不暴露该路径，避免在第三方生态处理敏感身份信息

### 3.4 合规闸门

保留现有三条声明校验（形象原创/肖像授权、内容合规、AI 生成标识），在**铸造**前再校验一次；草稿可存但不可对外展示。

---

## 四、配件与唯一形象组合（Parts → 1 of N）

### 4.1 Slot 定义

| Slot | 内容 | 是否影响稀有度 |
|---|---|---|
| `hair` | 发型 | 是 |
| `hairColor` | 发色/渐变 | 是 |
| `outfit` | 上装 | 是 |
| `outer` | 外套 | 是 |
| `bottom` | 下装 | 是 |
| `shoes` | 鞋 | 否 |
| `accessory` | 配饰（耳机/眼镜/围巾/发夹） | 是 |
| `expression` | 表情 | 否 |
| `background` | 背景氛围 | 是 |

风格滤镜（`style`）保持创建时选定，不占 slot，只影响渲染与精修提示词。

### 4.2 部件数据

```
{ id, slot, name, style[]（适配哪些风格）, rarity（common/rare/epic/legendary）,
  priceDiamonds, source（official/event/gacha）, layerUrl（SVG 图层）,
  anchor（锚点/图层顺序）, status }
```

- 层级顺序由 slot 固定（背景 → 身体 → 下装 → 上装 → 外套 → 头发 → 配饰 → 表情），避免组合穿模
- 配件是**生成输入**，不是用户资产：不可单独购买、不可转售、不可换装，仅在生成阶段参与组合
- 稀有度只影响获取与展示，不影响能力数值，避免「氪金即强」

### 4.3 组装与预览

- App 端：Flutter Canvas 按层叠加预览（沿用现有程序化绘制思路，扩成图层栈），支持实时组合与重掷
- 服务端：保存 `traits + seed`，生成稳定 `compositionHash`，作为生成器输入与防重复依据
- 预览不调用生成器、不扣费；只有「生成形象」或「导出立绘」才触发渲染与计费

### 4.4 千人千面

```
variationSeed = hash(characterId + seed + traitsSignature)
```

- 同部件组合在不同 seed 下产生不同的构图微差（配色偏移、光位、背景粒子）
- 稀有部件参与时标记 `rareHit`，用于展示与后续活动
- 生成器必须保证 `compositionHash` 唯一，重复时自动换 seed 重试

---

## 五、形象生成链路（链接精灵生成器 + 大模型精修）

### 5.1 生成器现状（已找到）

实际在 `KOKO` 仓库，不是一个可调用的外部服务：

| 项 | 内容 |
|---|---|
| 生成器页面 | [nft-generator-prototype](file:///c:/官网html/KOKO/nft-generator-prototype)（HashLips 风格 layer/trait 生成器原型） |
| 图层模型 | 5 层：`background` / `body` / `eyes` / `mouth` / `accessory`；每个 trait 带 `weight`（稀有度权重）、`color`、`shape` |
| 渲染 | 浏览器 Canvas 逐层绘制，支持 2D 与 GIF 帧动画，可批量出图并计算稀有度 |
| MCP 工具 | [mcp-bridge.js](file:///c:/官网html/KOKO/nft-generator-prototype/mcp-bridge.js#L17-L120) 注册 7 个工具：`fetch_layers`、`update_weight`、`generate_preview`、`generate_batch`、`download_nft`、`download_batch`、`submit_work_submission` |
| 后端接口 | **未实现**：[api.js](file:///c:/官网html/KOKO/nft-generator-prototype/api.js#L8-L72) 全是 stub，TODO 指向 `GET /api/wallet/layers`、`PATCH /api/wallet/layers/{layerId}/traits/{traitId}`、`POST /api/nft/preview`、`POST /api/nft/generate`、`GET /api/nft/{id}/download`、`POST /api/nft/download-batch` |
| 收单 | 宿主桥 `callHandler('kokoBusiness')` → linksprite-backend `POST /work-submissions`（X-API-Key） |
| 素材 | 无真实图片，全部由 Canvas 绘制几何形状（靠 `color` / `shape` 参数） |

结论：它是**前端原型 + MCP 工具声明**，渲染与出图能力未服务化；真正的链上能力在 `linksprite-backend`。

### 5.2 链上确权能力（已有）

`linksprite-backend`（Java Spring Boot，`context-path=/api`，X-API-Key，线上 `nft.kokokongkong.com`）：

| 接口 | 说明 |
|---|---|
| `POST /nft/mint/ugc` | UGC 铸造，前置需蚂蚁链确权（`dciId` + `antTxHash`）与 `tokenURI` |
| `POST /nft/mint/b2b` | B 端授权铸造，需 `authId` |
| `POST /nft/transfer` | 转移 |
| `GET /nft/owner/{tokenId}` / `/uri/{tokenId}` / `/proof/{tokenId}` | 归属、元数据、存证 |
| `POST /nft/pause/{tokenId}`、`GET /nft/totalSupply` | 暂停与总量 |

注意：当前部署为 `fisco.enabled=false` 开发模式，链上写接口统一返回「未启用」，上线前需先确认生产链环境。

### 5.3 两条铸造路径（已确认）

**A. UGC 单角色铸造（文字 / 身份证授权）**

```
角色卡(traits + seed + style)
  → 渲染出图（character/render）
  → 大模型精修（可选，失败回退）
  → workHash = 图片 SHA-256
  → POST /copyright/register-ugc { workHash, ownerInfo } → { dciId, antTxHash }
  → POST /nft/mint/ugc { to, tokenId, tokenURI, dciId, antTxHash, ipfsHash, workHash }
  → 回写 AI 的 tokenId 与链地址
```

- 前置：`antchain.quezao.enabled=true` 且配好 app-key/app-secret/methods；当前关闭，未开通时铸造必须明确失败，**不得伪造 DCI**
- `to` 用用户的人类链地址；`tokenURI` 指向我方元数据（traits / seed / rarity / image）
- 单角色 = 1 张图 = 1 次确权 = 1 次铸造；身份证授权线只在站内使用，人脸参考图不进公开存储

**B. 千人千面批量发行（B2B）**

```
运营在精修工坊生产系列（N 组 traits + 精修图 + 稀有度）
  → POST /auth/register { 授权方信息 } → authId
  → 逐版 POST /nft/mint/b2b { to, tokenId, tokenURI, authId, ... }
  → 批次写入系列表，tokenId 段连续
```

- 适合官方系列、活动空投、平台自营发行；不走 DCI，成本与流程更轻
- 批量铸造需限流与失败重试；单批建议 ≤ 200，失败可续铸（记录已成功的 tokenId）

两条路径共用渲染、精修、元数据、钱包与日志；差异只在确权方式（DCI 存证 vs 授权登记）。

### 5.4 大模型精修

- 输入：合成图 + 结构化提示词（风格 + 角色特征 + 禁止项），避免精修改脸改结构
- 要求：保持部件特征（发色、配饰、服装）不变，仅提升质感与光影
- 机型：优先图生图/风格迁移类模型；调用走**用户自己的 OpenElf API Key**，按模型单价从该用户人民币钱包扣，记录 `cost_micro`
- 失败或不通过内容审核 → 回退合成图（不消耗精修费用），草稿照常保留
- 当前仅 DeepSeek 有真实 Key，图像模型需新增厂商配置；未配置时跳过精修，直接输出合成图

### 5.5 形象锁定与唯一性

- 形象由配件一次性组合生成，**铸造后即锁定**：不可换装、不可重绘、不可替换配件
- 铸造前可无限重掷（换 seed / 换配件组合），每次生成按 token 计费
- `compositionHash` 全平台唯一：同一组合不得产出第二份；冲突时自动换 seed 重试
- 组合空间 = 各 slot 可选配件数的乘积（例：8 slot × 每 slot 10 件 = 10^8，足以支撑万级系列）
- 稀有度由配件权重推导（Bored Ape 式 rarity tier），铸造时写入元数据并随确权上链
- 已铸造形象仅允许展示尺寸/缩略图变化，主体像素不得修改

### 5.6 精修工坊（运营后台 + WorkBuddy 上架产品）

这是 UGC 与 B2B 之间必须先建的能力：把「配件 + AI 精修」做成可反复使用的生产工具。

| 项 | 设计 |
|---|---|
| 使用顺序 | ① 运营后台使用 → ② 打包上架 WorkBuddy → ③ 站内对普通用户开放 |
| 权限 | 后台 `super_admin` 写、`moderator` 只读；WorkBuddy 按 API Key 与额度；站内按用户额度与钻石 |
| 输入 | 配件包（分层素材 + slot + 稀有度权重）、风格、精修强度、批量数量、seed 策略 |
| 处理 | 组合 → 分层合成 → 大模型精修 → 质检（部件特征保持/清晰度/违规）→ 稀有度计算 → 生成版本 |
| 输出 | 单张与批量 PNG/GIF、`metadata.json`、系列清单、ContactSheet 预览 |
| 界面 | 图层管理、权重滑杆、精修前后对比、批量进度、失败重试、导出、操作留痕 |
| 上架形态 | 连接器（`fetch_layers` / `update_weight` / `generate_preview` / `generate_batch` / `download_*`）+ 技能（引导词）+ 专家（形象设计师）+ Buddy 应用（H5 工坊） |
| 与铸造关系 | 工坊只产角色资产，不铸造；产物供 A（UGC 单角色）与 B（B2B 系列）使用 |

关键约束：

- 精修必须「保结构」：发色、服装、配饰、轮廓不得改变，只提升质感与光影
- 每个产物记录 `traits + seed + compositionHash + 精修耗时与成本`，便于对账与复现
- 质检不通过自动回退合成图，不阻断批量任务

### 5.7 生成与铸造的计费边界（已确认）

| 环节 | 费用 | 支付方式 | 记账 |
|---|---|---|---|
| 形象生成 / 精修 | 按实际 token 消耗 | **用户自己的 OpenElf API Key**，网关按模型单价从该用户人民币钱包扣 | `platform_ledger` + `openelf_run` |
| 批量生成（运营 / 外部分发） | 同上 | 运营用平台运营 Key；WorkBuddy 用户用自己的 Key | 同上 |
| 铸造 AI 智能体 | 固定钻石 | 钻石（仅消费、销毁） | 钻石流水 + 铸造记录 |

硬性规则：

- 形象产出后**存草稿**，是否铸造完全由用户决定；草稿不对外展示、不进信息流，铸造后才成为可见 AI
- 无可用 API Key 或人民币余额不足 → 生成直接失败并提示充值，**不做免费降级生成**
- 生成失败不扣钻石；已生成的形象与草稿保留，可稍后重试
- 铸造失败（确权或链异常）→ 退还钻石，草稿保留
- 用户可反复重生成（每次按 token 计费，可换 seed / 换配件）
- 钻石与人民币互不相通：生成成本只走人民币，铸造费用只走钻石
- 铸造定价沿用现有 `CREATE_ELF_COST = 200` 钻石（[commerce.js](file:///c:/官网html/openelf/openelfai/server/src/commerce.js#L41)），如需按稀有度浮动另行定义
- 图像模型多为按张计费，`platform_model_price` 需新增「按次」计价模式（`per_image_micro`），否则 token 计费在图像链路上不成立

---

## 六、WorkBuddy 入驻（四类资源）

### 6.1 能力映射：OpenElf API → MCP 工具

| MCP Tool | 作用 | 对应内部接口 |
|---|---|---|
| `fetch_layers` | 获取图层与配件配置（沿用生成器语义） | `GET /api/v1/character/layers` |
| `generate_preview` | 随机/按配置生成预览组合（不扣费） | `POST /api/v1/character/preview` |
| `generate_batch` | 批量生成一组形象（运营/系列场景） | `POST /api/v1/character/batch` |
| `openelf_create_character` | 创建角色卡草稿 | `POST /api/v1/character/draft` |
| `openelf_list_parts` | 查询可选部件与价格 | `GET /api/v1/character/parts` |
| `openelf_generate_character` | 选配件并生成唯一形象（铸造前可重掷） | `POST /api/v1/character/{id}/generate` |
| `openelf_preview_character` | 生成预览图（不扣费） | `POST /api/v1/character/{id}/preview` |
| `openelf_mint_character` | 铸造 AI（扣钻石 + 生成形象） | `POST /api/v1/character/{id}/mint` |
| `openelf_get_character` | 查询角色卡与形象 | `GET /api/v1/character/{id}` |
| `openelf_chat` | 与铸造后的 AI 对话 | 现有 `/api/v1/elf-chat` |

### 6.2 连接器包

```
workbuddy-connector/
├── connector-meta.json     # source: openelf-character, type: mcp, auth_mode: token
├── mcp.json                # streamableHttp → https://api.openelfai.com/mcp
├── token-schema.json       # API_KEY（用户在 OpenElf 控制台生成）
├── icon.svg
└── skills/openelf-character/SKILL.md
```

- 鉴权先做 `token` 模式：用户填 OpenElf API Key，凭证只存 WorkBuddy 本地，调用回传至我方网关校验
- OAuth 2.1 + PKCE 后置（需我方实现授权服务器，成本较高）
- 服务端新增 `server/src/mcp/`：streamableHttp 端点 `/mcp`，工具调用全部走内部 API 与现有计费链路

### 6.3 技能包

- `SKILL.md` 主线：用户描述想要的角色 → 引导补齐风格/服装/气质 → 调连接器创建 → 展示预览 → 确认铸造
- `x-openelf` 扩展标注依赖连接器 `openelf-character`，避免用户单独安装技能后无法工作
- 附 3 条 `examples_zh`：原创角色、像素风、身份证授权（仅提「本人形象」不暴露流程）

### 6.4 专家包

```
openelf-character-designer/
├── plugin.json      # expertType: agent, categoryId: 06-ContentCreative
├── agents/designer.md
└── avatars/expert.png   # 512×512，漫画/插画风，不得用真人肖像
```

- 人格：虚拟角色设计师，负责把模糊想法拆成可执行的部件方案
- `dependencies.connectors: ["openelf-character"]`，召唤前引导授权
- 3 条 quickPrompts，与 defaultInitPrompt 第一条一致

### 6.5 Buddy 应用

- 形态：H5 角色工坊（`apps.openelfai.com/studio`），可独立分发与 iframe 嵌入
- 界面可直接复用生成器原型（图层选择 + 预览 + 批量 + 下载），补账户与铸造入口
- 包结构按 WorkBuddy「外部应用接入」规则；该页文档当前不可访问，需先确认是否要求客户端应用包
- 若必须桌面客户端：降级为「技能 + 连接器 + H5 链接」组合，不硬做应用

### 6.6 对外边界

- 不暴露身份证授权路径、不出现「NFT / 区块链 / 链上铸造」字样，统一表述为「AI 形象」
- 所有产出带「内容由 AI 生成」标识
- 外部调用只能创建、生成与预览；铸造与结算仍以 OpenElf 账户与钻石为准

---

## 七、分期计划

### P0 形象生产内核

- 交付：角色卡实体、图层/配件目录（9 slot）、服务端渲染（PNG/GIF）、精修链路、`compositionHash` 防重、生成任务与版本
- 文件：`server/src/character/{store,parts,render,refine,compose}.js`、复用 `whale-ling` 素材管线
- 验收：给定 traits + seed 稳定出图；同 hash 不重复；精修失败自动降级

### P1 运营精修工坊（后台）

- 交付：后台「形象工坊」——配件上传与分层、权重/稀有度、精修参数、单张精修、批量生成（2D/GIF）、预览导出、任务进度与失败重试
- 文件：`admin/web/src/pages/CharacterStudio.tsx`、`admin/bff/internal/handler/character.go`、`server/src/character/routes.js`
- 权限：`super_admin` 写、`moderator` 只读
- 验收：运营可独立完成一个 100 版系列的生产与导出，全过程留痕

### P2 WorkBuddy 产品化（精修能力上架）

- 交付：把工坊能力包成四类资源：连接器（`fetch_layers` / `update_weight` / `generate_preview` / `generate_batch` / `download_*`）+ 技能（引导提示词）+ 专家（形象设计师）+ Buddy 应用（H5 工坊）
- 文件：`server/src/mcp/{server,tools}.js`、`integrations/workbuddy/{connector,skill,expert,app}/`
- 验收：外部 Agent 可完成「选配件 → 生成 → 批量 → 下载」；与运营工作台共用同一套接口

### P3 UGC 单角色铸造

- 交付：创建流程重构（草稿/预览免费、铸造扣费）、文字模板线、身份证授权线、`/copyright/register-ugc` + `/nft/mint/ugc` 对接、AI NFT 回写
- 文件：`app/lib/pages/{create_elf,character_editor,parts_picker}_page.dart`、`server/src/character/mint.js`
- 验收：两条线都能产出 AI NFT；鹊凿未开通时明确报错且不伪造

### P4 B2B 千人千面发行

- 交付：`/auth/register` 授权登记、批量铸造、系列与 tokenId 段管理、失败续铸、官方首发系列上架
- 文件：`server/src/character/{series,mint}.js`
- 验收：100 版系列可一键发行，tokenId 连续且归属正确

### P5 站内开放

- 交付：工坊能力开放给普通用户（自助选配件 + AI 精修 + 生成唯一形象 + 铸造）、形象库与稀有度展示
- 验收：用户自助产出并铸造；与运营共用同一套能力

### P6 数据与运营

- 交付：生产漏斗（草稿→生成→铸造）、组合产出量、生成成功率、精修成本、WorkBuddy 侧调用量；后台看板
- 验收：运营可定位「卡在哪一步」与「单角色生成成本」

依赖：P0 → P1；P0/P1 → P2；P0 → P3；P0 → P4；P2 → P5。

---

## 八、风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 生成器仅为前端原型 | 渲染无法被服务端与 Agent 调用 | 在 OpenElf 侧服务化（`character/render.js`），复用其 layer/trait 模型与工具语义 |
| 图像模型未接入 | 千人千面质感不足 | 精修可跳过，先分层合成上线，Key 到位后灰度开启 |
| 部件美术产能不足 | 组合空间小，千人千面名不副实 | 复用鲸凌 SVG 管线，先做每 slot 3–5 件，按稀有度分批上线 |
| 身份证授权数据外流 | 合规风险 | 该路径仅站内可用，生成器只接收人脸参考图，不入第三方生态 |
| WorkBuddy 应用接入规则未知 | 应用类无法上架 | 先确认规则；不行就降级为技能+连接器+H5 |
| 组合重复导致非唯一 | 系列价值受损 | `compositionHash` 全平台唯一索引 + 铸造前预占，冲突自动换 seed |

---

## 九、需要你提供 / 拍板

1. **链环境与开通**：`antchain.quezao.enabled` 是否已开通（UGC 依赖）；`fisco.enabled` 生产链是否可用（两条路径都依赖）；未开通时先做渲染与工坊，铸造顺延。
2. **授权登记主体**：B2B `POST /auth/register` 的授权方填什么（平台自营 / IP 权利人），由谁签署。
3. **精修模型选型**：用哪家图生图服务（火山/阿里/腾讯或海外），谁来开通 Key 与预算。
4. **配件美术来源**：是否复用鲸凌 SVG 管线扩部件，还是另建美术规范与外包。
5. **WorkBuddy 应用接入规则**：确认「外部应用接入」是否必须客户端应用包，否则 H5 工坊改为链接分发。
6. **对外是否提「身份证授权」**：我默认不提（仅站内可用），如要露出需要额外的合规与审核准备。
7. **铸造钻石定价**：沿用现有 200 钻石，还是按稀有度/部件浮动定价。
