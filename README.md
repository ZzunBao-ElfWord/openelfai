# OpenElf Monorepo

OpenElf（开放精灵）的单一代码仓库，包含官网、Flutter 双端 App、业务 API、开放平台网关接入与管理后台。

## 目录结构

```
openelfai/
├── web/            # 官网（Next.js 静态导出）→ openelfai.com
├── app/            # Flutter App（Android / iOS / Web）
├── server/         # 业务 API（Fastify + MySQL）→ openelf-api，127.0.0.1:8787
├── admin/
│   ├── bff/        # 管理后台 BFF（Go + Gin）→ admin.openelfai.com，127.0.0.1:8094
│   └── web/        # 管理后台前端（Vite + React + TS）
├── deploy/         # nginx / LiteLLM 等部署配置
└── docs/           # 设计规格、模型平台清单、IAP 接入说明
```

| 模块 | 技术栈 | 说明 |
|---|---|---|
| `web/` | Next.js 15 App Router，静态导出到 `web/out/` | 官网 + 工具图鉴 + 开放平台介绍页 |
| `app/` | Flutter 3 / Dart | 世界信息流、视频流、对话、市场、控制台、钱包 |
| `server/` | Fastify 5 + mysql2 | 鉴权、世界内容、商业链路、实名、支付、开放平台 |
| `admin/bff` | Go 1.23 + Gin + MySQL | 后台所有读写经 BFF，前端不直连数据库 |
| `admin/web` | React 19 + Vite + Tailwind | 运营/审核/开放平台管理 |
| `deploy/` | nginx conf、litellm config | 线上反向代理与网关配置备份 |

## 分支模型

| 分支 | 用途 | 部署目标 |
|---|---|---|
| `main` | 生产稳定版 | openelfai.com / web.openelfai.com / api.openelfai.com |
| `dev` | 日常开发与功能集成 | 预览环境 |
| `codex/*` | 临时功能分支 | 不部署 |

## 本地开发

```bash
# 官网
cd web && npm install && npm run dev

# 业务 API（需 MySQL 与 /etc/openelf-api.env 等价的环境变量，见 server/.env.example）
cd server && npm install && npm start

# 管理后台
cd admin/web && npm install && npm run dev
cd admin/bff && go run ./cmd/server
```

## 构建与发布

```bash
# 官网：静态导出到 web/out/
cd web && npm run build

# App（Windows 上必须经 ASCII 目录联接构建，避免中文路径导致 gen_snapshot 失败）
#   New-Item -ItemType Junction C:\openelf_build -> openelfai\app
flutter build apk --release --target-platform android-arm64
flutter build web --release --base-href /

# 服务端
cd server && npm test        # node --test
```

App 正式包输出：`C:\官网html\openelf\openelf-mvp.apk`。

## 环境变量

- 服务端全部变量清单见 [server/.env.example](server/.env.example)，线上实际文件为 `/etc/openelf-api.env`。
- 支付、验证码、实名等分片样例见 `server/.env.alipay.example`、`.env.captcha.example`、`.env.apple.example`。
- 管理后台变量见 `admin/.env.example`。
- **任何密钥、令牌、证书都不得提交到仓库**；`.env`、`*.p8`、`*.pem`、`*.jks` 已在 `.gitignore` 中忽略。

## 约定

- 术语：AI 称「AI 智能体」，人类持有的是「AI 技能书」，学进 AI 后叫「技能」。
- 资产边界：技能、人格、作品绑定 AI 本身；技能书挂人类地址；人类只持有钻石、人民币钱包与 AI 的 NFT 所有权。
- 客户端不硬编码业务元数据（技能书目录、充值档位、排序规则均由服务端下发）。
- 详细设计以 [docs/specs](docs/specs) 为准；后台开发约束见 [admin/AGENTS.md](admin/AGENTS.md)。

## 工作区说明

仓库上层的 `C:\官网html\openelf\` 是工作区（非 git 仓库），其中：

- `qa/archive/`：历史 QA 截图与 uiautomator dump（临时证据，不入库）
- `qa/scripts/`：一次性调试脚本（视频探针、部署脚本等）
- `planning/`：产品规划、GEO 关键词等运营文档
