# AGENTS.md — OpenElf 管理后台（openelfai/admin）

> 本文件是所有 AI 员工（Trae / Claude Code / Cursor 等）进入本仓库的**第一份必读文件**。
> 开始任何任务前先通读本文件；不确定时，按本文件的约束执行，不要自由发挥。

## 1. 项目是什么

OpenElf（AI 精灵养成 + 内购/支付宝充值经济系统）的**运营与审核管理后台**，管理对象：
用户、双环境钱包（Production/Sandbox）、支付账本、支付宝/Apple 订单与退款核对单、
精灵（elf）/寄售（listing）/动态（post）对象、能力包目录（catalog）、后台账号与审计。

**架构铁律：前端永远不允许直连 MySQL，所有操作必须经 BFF；BFF 之外没有第二条路。**

业务事实源（规则以这些文件为准，改代码前先读）：
- `../server/src/db.js` — MySQL 业务表结构（users/user_wallets/apple_iap_* 等）
- `../server/src/payment_store.js` — payment_wallet_meta/payment_objects/payment_ledger；
  `changeBalance` 算法；环境路由 `tables()`：Production→user_wallets，Sandbox→apple_iap_sandbox_wallets
- `../server/src/commerce.js` — payment_objects 的 kind（elf/listing/post/profile/order/request/
  alipay_order/alipay_request/alipay_trade/alipay_review/notification/catalog_override）与
  CATALOG/MODULES/MODULE_PRICES 硬编码常量
- `../server/src/alipay.js`、`../server/src/apple_orders.js` — 订单对象字段

## 2. 技术栈（已拍板，不得擅自更换）

| 层 | 选型 |
|---|---|
| 后端 | Go 1.23 + Gin + database/sql + go-sql-driver/mysql + golang-jwt/v5 + bcrypt |
| 数据库 | MySQL（业务表 Node server 已建；后台自有表 BFF 启动时兜底 CREATE IF NOT EXISTS） |
| 部署 | 单二进制（前端产物 `go:embed`）+ systemd + nginx 反代 |
| 接入 | nginx `admin.openelfai.com → 127.0.0.1:8094` |

- 依赖白名单之外的新依赖，必须在任务说明中先提出并说明理由。

## 3. 目录约定

```
admin/
├── AGENTS.md                 # 本文件
├── .env.example              # 环境变量模板（.env 不入库）
├── .gitignore
├── deploy/
│   ├── mysql-admin-init.sql          # MySQL 最小权限账号 + 后台自有表（服务器执行一次）
│   ├── admin.openelfai.com.nginx.conf
│   └── openelf-admin.service         # systemd unit
└── bff/                      # Go BFF（module openelf-admin-bff）
    ├── cmd/server/main.go    # 入口（含管理员种子逻辑）
    └── internal/
        ├── config/           # 环境变量配置
        ├── model/            # 角色常量、环境常量、NewID
        ├── store/            # MySQL 连接 + 后台自有表兜底 DDL
        ├── auth/             # bcrypt、JWT
        ├── middleware/       # JWT 鉴权、RBAC、审计、限流
        ├── ledger/           # changeBalance 逐语义复刻（改前必须对照 Node 原版）
        ├── catalog/          # CATALOG/MODULES/MODULE_PRICES 镜像（Node 改动后必须同步）
        ├── handler/          # HTTP handler
        ├── router/           # 路由表
        └── web/              # //go:embed dist（前端产物）
```

## 4. 权限模型（固定三角色，不引入 Casbin）

| 角色 | 能做什么 |
|---|---|
| `super_admin` | 全部：钱包调账、核对单处理、精灵状态变更、目录覆盖、后台账号管理、审计 |
| `moderator` | 用户查询/封禁、钱包/账本/订单/精灵/挂单/动态查看、动态软删、目录查看 |
| `operator` | 数据看板、系统健康、审计日志查看/导出 |

- 前端菜单与路由按角色过滤只是**体验层**；真正的权限闸门在 BFF 路由中间件，**两边都必须配**。
- 新增写操作时，必须同时：①后端挂 `RequireRole`；②前端路由 meta 标 roles；③审计自动覆盖（无需手写）。

## 5. 数据模型须知（动手前必读）

- 业务表时间列（users.created_at/last_login_at、payment_objects.updated_at、payment_ledger.created_at）
  是 **VARCHAR ISO 字符串（UTC 毫秒）**，统计用字符串范围比较，不要 CAST。
- `payment_ledger` 只增不改：BFF 数据库账号只有 SELECT,INSERT。任何"改账"= 追加一条反向事件。
- `changeBalance` 语义（internal/ledger/ledger.go 与 Node 逐行对齐）：
  event_id 幂等存在即返回；正额先还 refund_debt 再入 diamonds；负额先扣 diamonds 不足记 refund_debt；
  version++；写 balance_after/debt_after；事务内 INSERT IGNORE+FOR UPDATE 双行锁；
  死锁/锁超时（MySQL 1213/1205）重试最多 3 次。
- 精灵（kind='elf'）的 `state` 列恒为空串，真实状态在 payload.status（owned/listed）；
  列表 state 过滤走 JSON_EXTRACT，改状态时列与 payload 同步改。
- 删除一律软删（UPDATE state='deleted'），业务表无 DELETE 权限。

## 6. 接口约定

- 统一前缀 `/api/v1`；统一 JSON；统一返回：
  - 正常：业务 JSON；分页：`{ items, total, page, page_size }`
  - 错误：`{ "error": "机器可读码", "message": "中文说明" }`，HTTP 状态码语义正确
- 鉴权：`Authorization: Bearer <jwt>`（HS256，TTL 默认 12h，改密即失效）
- env 参数全部强校验，只允许 `Production` / `Sandbox`
- 所有变更类请求（POST/PUT/PATCH/DELETE，登录除外）自动写审计日志，
  审计字段：操作人、角色、方法、路径、响应码、IP、UA、时间；**请求体不入库**（避免泄密）

## 7. AI 员工工作纪律

1. **一个任务 = 一个接口 + 一个 TS 类型 + 一个页面**，范围小、可编译验收、可回滚。
2. 改动后必须保证后端两道闸门通过：`go build ./... && go vet ./...`，
   并验证交叉编译 `GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build ./cmd/server`。
   不允许把未验证的代码标记为完成。
3. 高危操作（调账、封禁、处理核对单、删动态）前端必须走确认弹窗，禁止单击直接执行。
4. **密钥默认不入库、不打印**：不打印/不记录 Token、密码、完整 DSN；日志中 DSN 必须脱敏。
   唯一例外是上游厂商 Key：允许以 AES-256-GCM 密文存入 `platform_vendor_credentials`，
   但明文与密文都不得回显、不得写日志，页面只展示掩码（前 4 + 后 4）。
   新增密钥类配置必须沿用该加密与掩码规范。
5. 不新增定时任务、消息队列等常驻组件；统计实时查 MySQL，后续有性能压力再讨论物化表。
6. 配置只走环境变量；禁止把任何密钥、内网地址硬编码进代码或前端。
7. 后端 handler 之间复用 `Deps`，不要新建全局变量或新连接池。
8. 不要动 `../server/`、`../web/`、`../app/` 下任何现有文件；不要访问生产服务器。

## 8. 本地开发

需要 Go 1.23+。

```powershell
# 后端（PowerShell）
$env:MYSQL_DSN="openelf_admin:...@tcp(127.0.0.1:3306)/openelf?charset=utf8mb4&parseTime=true&loc=UTC"
$env:JWT_SECRET="..."; $env:BOOTSTRAP_ADMIN_USERNAME="admin"; $env:BOOTSTRAP_ADMIN_PASSWORD="..."
cd bff; go run ./cmd/server
```

## 9. 部署

```bash
# 1) MySQL 最小权限账号 + 后台自有表（仅一次，先替换脚本里的 <CHANGE_ME>）
mysql -u root -p < deploy/mysql-admin-init.sql

# 2) 部署二进制与配置
useradd -r -s /sbin/nologin openelfadmin
mkdir -p /opt/openelf-admin
# 交叉编译产出 bff/openelf-admin，连同 .env 上传到 /opt/openelf-admin/
cp .env.example /opt/openelf-admin/.env   # 按注释填齐，尤其 JWT_SECRET / MYSQL_DSN
cp deploy/openelf-admin.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now openelf-admin

# 3) 接入 nginx：deploy/admin.openelfai.com.nginx.conf → /etc/nginx/sites-enabled/
certbot --nginx -d admin.openelfai.com
nginx -t && systemctl reload nginx
```

- 首次启动若设置了 `BOOTSTRAP_ADMIN_USERNAME/PASSWORD` 且账号表为空，会自动创建一个 super_admin；
  登录后请立即从 .env 清空这两项。
