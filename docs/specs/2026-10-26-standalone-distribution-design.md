# OpenElf 站外分发技术设计（抖音 / B站 / 小红书 / 微信）

> 2026-10-26 · 状态：规划（v2 前置）
> 关联：[2026-10-22-v1.3-growth-distribution-design.md](2026-10-22-v1.3-growth-distribution-design.md)、[2026-10-22-echo-attention-design.md](2026-10-22-echo-attention-design.md)

## 一、目标与判断

把 App 内 AI 产出的内容（9:16 视频 / 3:4 图文 / 音频）一键分发到站外，并把站外流量回流成 echo / attention。

三条硬判断：

1. **只做「发布自己的内容」，不做互动自动化**。不自动评论、不自动关注、不私信、不模拟登录。大肥鱼那波刷评论区已被 B 站风控限流，属于负面玩法，不做。
2. **能自动的走官方 OpenAPI，不能自动的走「半自动 + 人按发布」**。不为不可用的平台去写浏览器自动化。
3. **每个平台账号必须由用户本人 OAuth 授权**，平台不代持账号、不共用登录态。

## 二、平台能力矩阵（2026-10 现状）

| 平台 | 官方内容发布 API | 结论 | 备注 |
|---|---|---|---|
| 抖音 | 有。OAuth2.0 → access_token（15 天）/ refresh_token（30 天），上传视频后创建作品，scope `video.create.bind` | **可自动发布** | 需企业主体 + 控制台申请「代替用户发布内容到抖音」能力；视频 ≤300MB、≤15 分钟；带品牌水印大概率降权 |
| 抖音（App 内） | `aweme.share` / `aweme.forward` 分享 SDK | **半自动（Phase 1）** | 拉起抖音编辑页/发布页，只支持本地图片或视频，人按发布 |
| B站 | 有。OAuth + scope `ARC_BASE`；上传预处理 → 小文件/分片上传 → 合片 → 封面上传 → 稿件提交 | **可自动发布** | 需入驻开放平台、权限白名单；非正式会员单日最多 5 稿；请求需 HMAC-SHA256 v2.0 签名；视频 ≤4GB、<5h，封面 jpeg/png ≤5MB |
| 小红书 | **无内容笔记发布 API**。开放平台类目只有一键搬家/商品优化/打单/订单/ERP 等电商能力 | **半自动** | 走 App 分享 SDK 或「存相册 + 复制文案 + 引导去发」；第三方浏览器脚本不纳入产品 |
| 微信视频号 | **无第三方发布 API**（官方社区明确答复） | **半自动** | 官方仅「视频号助手」后台与定时发布（需实名 + 近 30 天 3 条原创，仅未来 7 天整点） |
| 微信公众号（服务号） | 有。`draft/add` 建草稿 → `freepublish/submit` 提交发布，异步事件 `PUBLISHJOBFINISH` 回执 | **可自动发布** | 2025-07 起个人主体、未认证企业主体被回收该接口权限，必须企业认证服务号 |
| 微信会话 / 朋友圈 | 微信开放平台 App 分享 SDK（`sendReq`） | **半自动（Phase 1）** | 只能拉起微信分享面板，不能直接代发朋友圈 |

推论：自动发布只做 **抖音 + B站 + 公众号**；小红书、视频号、朋友圈做半自动引导。这样既拿到最大覆盖，又不碰违规自动化。

## 三、总体架构

```
Flutter App
  ├─ 分发面板（勾选平台 / 预览规格 / 一键发布）
  ├─ 半自动引导（保存相册 / 复制文案 / 拉起目标 App）
  └─ 结果页（作品链接回填 / 回流数据）
        │
        ▼
Node 业务服务（server/src/distribution/）
  ├─ accounts      账号绑定与 token 托管
  ├─ jobs          分发任务、状态机、重试
  ├─ specs         平台规格适配（尺寸/时长/文案/话题）
  ├─ adapters      douyin / bilibili / wechat_mp / xhs_manual / channels_manual
  └─ metrics       作品链接回填 + UTM 归因
        │
        ├── 抖音开放平台
        ├── B站开放平台
        ├── 微信公众号
        └── Admin BFF（任务看板 + 应用凭证配置）
```

职责边界：

- App 只负责选择平台、预览、触发；不做任何平台签名与密钥持有。
- Node 服务持有平台应用凭证与用户 token（加密），执行上传与提交。
- Admin BFF 只做运营视角的配置与看板，不参与发布执行。
- 素材仍由 App 侧生成后上传（复用现有作品附件链路），分发服务只做规格转码与提交。

## 四、数据模型

新增 5 张表（MySQL，`openelf` 库）：

```sql
-- 平台应用凭证（全局一份，AES-256-GCM 加密）
platform_apps (
  platform      VARCHAR(16) PRIMARY KEY,   -- douyin / bilibili / wechat_mp / xhs / channels
  client_id     VARCHAR(128) NOT NULL,
  secret_cipher TEXT NOT NULL,
  extra_json    JSON NULL,                 -- 公众号 appid、能力集 id 等
  enabled       TINYINT NOT NULL DEFAULT 0,
  updated_by    VARCHAR(64) NULL,
  updated_at    DATETIME NOT NULL
);

-- 用户绑定的站外账号
platform_accounts (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id       VARCHAR(64) NOT NULL,
  platform      VARCHAR(16) NOT NULL,
  open_id       VARCHAR(128) NOT NULL,
  union_id      VARCHAR(128) NULL,
  nickname      VARCHAR(64) NULL,
  avatar_url    VARCHAR(512) NULL,
  scopes        VARCHAR(512) NULL,
  status        VARCHAR(16) NOT NULL,      -- active / expired / unlinked
  connected_at  DATETIME NOT NULL,
  UNIQUE KEY uk_user_platform_open (user_id, platform, open_id)
);

-- token 密文（与账号 1:1）
platform_credentials (
  account_id          BIGINT PRIMARY KEY,
  access_cipher       TEXT NOT NULL,
  refresh_cipher      TEXT NULL,
  access_expires_at   DATETIME NOT NULL,
  refresh_expires_at  DATETIME NULL,
  refreshed_at        DATETIME NULL
);

-- 分发任务
distribution_jobs (
  id                BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id           VARCHAR(64) NOT NULL,
  elf_id            VARCHAR(64) NOT NULL,
  post_id           VARCHAR(64) NOT NULL,
  platform          VARCHAR(16) NOT NULL,
  account_id        BIGINT NOT NULL,
  asset_id          BIGINT NOT NULL,
  spec_json         JSON NOT NULL,          -- 标题/话题/简介/封面/时长/尺寸
  status            VARCHAR(16) NOT NULL,   -- queued/uploading/submitted/reviewing/published/rejected/failed/manual_required/needs_relink
  attempts          INT NOT NULL DEFAULT 0,
  platform_work_id  VARCHAR(128) NULL,
  platform_url      VARCHAR(512) NULL,
  error_code        VARCHAR(64) NULL,
  error_msg         VARCHAR(512) NULL,
  idempotency_key   VARCHAR(128) NOT NULL,
  scheduled_at      DATETIME NULL,
  created_at        DATETIME NOT NULL,
  updated_at        DATETIME NOT NULL,
  UNIQUE KEY uk_idem (idempotency_key),
  KEY idx_post (post_id), KEY idx_status (status, scheduled_at)
);

-- 分发素材（转码后的平台规格产物）
distribution_assets (
  id          BIGINT PRIMARY KEY AUTO_INCREMENT,
  post_id     VARCHAR(64) NOT NULL,
  kind        VARCHAR(16) NOT NULL,        -- video / image / text
  path        VARCHAR(512) NOT NULL,
  width       INT NULL, height INT NULL, duration_sec INT NULL,
  bytes       BIGINT NOT NULL,
  sha256      CHAR(64) NOT NULL,
  created_at  DATETIME NOT NULL
);
```

约定：`platform_credentials` 的密文用 `PLATFORM_SECRETS_KEY`（现有 AES-256-GCM 密钥）加密，禁止明文落库与日志打印。

## 五、发布流水线与状态机

```
queued
  ├─ 半自动平台 → manual_required（等用户确认已发布）
  └─ 自动平台 → uploading → submitted → reviewing
                                  ├─ published（回写作品 ID/URL，触发回流计分）
                                  ├─ rejected（审核拒绝，不自动重投，转人工）
                                  └─ failed（可重试，进入退避队列）
```

- 幂等：`idempotency_key = sha256(user_id|post_id|platform|account_id|spec_hash)`，重复请求直接返回已有任务。
- 重试：仅对 5xx / 网络超时 / 上传中断重试，指数退避 1m → 5m → 30m → 2h，最多 4 次；审核拒绝与内容违规不重试。
- token：调用前 5 分钟预刷新；收到 401 / token 过期错误时刷新一次，仍失败则任务置 `needs_relink` 并推送「请重新绑定」。
- 并发：同一 `account_id` 同时只允许 1 个上传任务（Redis 或 MySQL 行锁）。
- 频控：单账号每日 ≤3 条，单用户全平台每日 ≤5 条（与 B站非正式会员 5 稿上限对齐）。

## 六、适配器接口

```ts
export type Platform = 'douyin' | 'bilibili' | 'wechat_mp' | 'xhs' | 'channels';

export interface PlatformCapability {
  autoPublish: boolean;        // false → 半自动
  supports: ('video' | 'image' | 'text')[];
  maxVideoBytes: number;
  maxDurationSec: number;
  requiresEnterprise: boolean;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  accessExpiresAt: Date;
  refreshExpiresAt?: Date;
}

export interface PublishContext {
  job: DistributionJob;
  account: PlatformAccount;
  tokens: TokenSet;
  asset: DistributionAsset;
  spec: PublishSpec;           // title/tags/desc/cover/text
  onProgress?: (pct: number) => void;
}

export type PublishResult =
  | { state: 'published'; workId: string; url?: string }
  | { state: 'reviewing'; workId: string }
  | { state: 'manual_required'; payload: ManualPayload }
  | { state: 'retryable'; code: string; message: string }
  | { state: 'fatal'; code: string; message: string };

export interface PublishAdapter {
  platform: Platform;
  capability(): PlatformCapability;
  authorizeUrl(state: string): string;
  exchangeCode(code: string): Promise<{ tokens: TokenSet; profile: Profile }>;
  refresh?(refreshToken: string): Promise<TokenSet>;
  publish(ctx: PublishContext): Promise<PublishResult>;
  poll?(job: DistributionJob, tokens: TokenSet): Promise<PublishResult>;
}
```

`ManualPayload` 用于半自动：`{ filePath, title, tags, desc, deepLink?, steps: string[] }`，App 据 steps 引导。

## 七、平台适配细节

### 抖音（自动）

1. 绑定：Web 授权（PC 扫码）或移动端 SDK 授权，回调换 `access_token` + `refresh_token` + `open_id`。
2. 上传：`POST https://open.douyin.com/api/douyin/v1/video/upload_video/?open_id=...`，header `access-token`，multipart 字段 `video`；超过 50MB 走分片。
3. 创建：调用同 scope 的创建视频接口，提交 `video_id`、标题、话题；具体路径以控制台「代替用户发布内容到抖音」文档为准（平台会调整版本号）。
4. 回写：作品 ID 与链接写入 job，作品链接进回流归因。

### B站（自动）

1. 入驻开放平台，应用申请 `ARC_BASE` 权限并通过白名单。
2. `POST /arcopen/fn/archive/video/init`（`utype=1` ≤100MB 单文件，否则分片）→ 上传 → 合片。
3. 封面上传（jpeg/png ≤5MB，建议 ≥1146×717）。
4. `POST /arcopen/fn/archive/add-by-utoken?upload_token=...`，传 `title`（<80）、`tid`（分区，需先查分区）、`tag`、`desc`（<250）、`copyright=1`。
5. 所有请求带 `x-bili-*` 公共头 + `Authorization: HMAC-SHA256` 签名，`access-token` 为用户授权 token。

### 微信公众号（自动，只做长文栏目）

1. 企业认证服务号，获取 `access_token`（7200 秒，稳定版接口）。
2. 图片先走「上传图文消息内图片」换站内 URL，封面走永久素材。
3. `POST /cgi-bin/draft/add` 建草稿拿 `media_id` → `POST /cgi-bin/freepublish/submit` 提交。
4. 等 `PUBLISHJOBFINISH` 事件（或轮询 `freepublish/get`）确认 `publish_status`，再回写 URL。
5. 注意：个人主体与未认证企业主体自 2025-07 起无该权限。

### 小红书（半自动）

- 无发布 API。App 内生成 3:4 图集或 9:16 视频 → 保存相册 → 复制标题/正文/话题 → 引导打开小红书发布。
- 可接官方分享 SDK（图文/视频），具体能力按官方最新 SDK 文档实现；不写浏览器自动化。

### 视频号（半自动）

- 无第三方发布 API。走「保存相册 + 复制文案 + 引导视频号助手/App 发布」。
- 不做浏览器自动化，不做账号托管。

## 八、服务端接口

```
POST /api/v1/distribution/accounts/:platform/authorize   → { url, state }
GET  /api/v1/distribution/accounts/:platform/callback    → 绑定结果（重定向回 App）
GET  /api/v1/distribution/accounts                        → 已绑定账号列表
POST /api/v1/distribution/accounts/:id/unbind

POST /api/v1/distribution/jobs                            → 批量建任务（平台数组）
GET  /api/v1/distribution/jobs?postId=                    → 单帖分发状态
GET  /api/v1/distribution/jobs/:id
POST /api/v1/distribution/jobs/:id/retry
POST /api/v1/distribution/jobs/:id/manual-done            → 半自动：用户确认已发布
POST /api/v1/distribution/webhooks/:platform              → 公众号事件 / 平台回调
```

后台（BFF）：

```
GET  /api/v1/distribution/apps          modOnly
PUT  /api/v1/distribution/apps/:platform superOnly（凭证加密入库）
GET  /api/v1/distribution/jobs          任务看板（按状态/平台筛选）
GET  /api/v1/distribution/accounts      绑定账号总览
```

前端页面：`/distribution/apps`（凭证与开关）、`/distribution/jobs`（看板与失败重试）。

## 九、App 端交互

发布成功后底部操作行新增「分发」：

1. 平台勾选（已绑定的可多选；未绑定点「去绑定」）。
2. 规格预览：9:16 视频 / 3:4 图集 / 长文，标注各平台限制（时长、大小、标题字数）。
3. 自动平台点「发布」→ 任务进度（上传 / 审核中 / 已发布 / 需处理）。
4. 半自动平台点「去发布」→ 保存相册 + 复制文案 + 拉起目标 App，返回后点「我发好了」。
5. 结果区展示作品链接与回流数据（UV、回流注视）。

## 十、回流与计分

- 所有站外文案/简介统一带 `https://openelfai.com/e/?id=<elfId>&ref=<platform>`（复用 v1.3 H5 落地页）。
- 作品链接回填后写入 job，作为归因来源；回流计分沿用 v1.3 规则（同设备同 AI 仅计 1 次），Lv4 双倍。
- 若抖音开放平台数据接口可用，再补「站外播放 ×1 / 点赞 ×5」的权重（对应 echo-attention 设计 v2 项）；B站、小红书、视频号暂只做链接回流，不抓取站内数据。

## 十一、失败处理与运维

| 场景 | 处理 |
|---|---|
| token 过期 | 预刷新；401 后刷新一次；仍失败 → `needs_relink` + 推送 |
| 上传超时/中断 | 指数退避重试 4 次，保留断点（B站分片可续传） |
| 审核拒绝 | 不重试，`rejected`，展示平台原因，人工改稿后新建任务 |
| 平台限流/额度 | 任务顺延到下一时段，`scheduled_at` 生效 |
| 平台接口变更 | 适配器隔离，改动只落单文件；每月核对官方变更日志 |
| 密钥泄露 | 凭证仅密文入库、日志脱敏；支持后台轮换并强制重新授权 |

## 十二、合规与红线

1. 不模拟登录、不自动评论/点赞/关注/私信，不做「养号」。
2. 每个账号必须本人授权，授权范围仅发布；用户可随时解绑并删除 token。
3. 全部内容带「内容由 AI 生成」标识：视频片尾角标、图文文末声明、平台 AIGC 声明字段。
4. 不发布未经授权的角色 IP 素材（鲸凌在授权签署前仅内部测试，不进入分发）。
5. 频控与内容自检（敏感词、未成年人、医疗金融）在进入队列前拦截。
6. 平台拒绝后不得换号重投。

## 十三、分阶段落地

| 阶段 | 内容 | 依赖 | 验收 |
|---|---|---|---|
| Phase 0（已完成） | 分享卡片 + H5 落地页 + 回流计分 | 无 | 分享链接可回流计分 |
| Phase 1 | App 内分享 SDK：抖音 `aweme.share`、微信 `sendReq`、小红书 SDK；半自动引导页 | 各平台应用创建 + 权限申请 | 三个平台可拉起对应 App 且文案/话题正确 |
| Phase 2 | 抖音 OAuth + 上传/创建；B站 `ARC_BASE` 投稿 | 企业资质、抖音能力申请、B站白名单 | 绑定→发布→审核→作品链接回写全链路 |
| Phase 3 | 公众号草稿+发布；小红书/视频号半自动打磨 | 企业认证服务号 | 长文自动发布 + 事件回执 |

Phase 2 起需要后台配置项：平台凭证（密文）、能力开关、每日频控阈值、失败告警接收人。

## 十四、前置资料清单（现在就能并行准备）

1. 企业营业执照 + 对公账户（抖音、B站、公众号均需企业主体）。
2. 抖音开放平台：创建「网站应用」，申请「代替用户发布内容到抖音」能力。
3. B站开放平台：入驻 + 创建应用 + 申请 `ARC_BASE` 白名单。
4. 微信公众号：企业认证服务号（个人号和未认证号没有发布接口权限）。
5. 小红书：确认官方分享 SDK 与 App 资质要求；不申请电商类目能力（与内容分发无关）。
6. 统一素材规格：9:16 1080×1920 视频（≤60s，MP4）、3:4 1080×1440 图集、封面 ≥1146×717。

## 十五、风险

- 平台接口与能力审核不可控，Phase 2 存在排期风险；Phase 1 可先上线拿到真实分发量。
- 抖音「代替用户发布」能力审核较严，可能要求内容合规方案与风控说明。
- 公众号仅企业认证服务号可用，个人主体无法自动发布。
- 小红书、视频号长期无发布 API，半自动是常态，产品文案不要承诺「全自动」。
- 授权素材（鲸凌）在授权签署前禁止进入任何站外分发。
