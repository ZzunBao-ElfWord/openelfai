# 支付与钻石用途升级（2026-10-22）

## 当前边界

已整合上游 `c1e6356` 的手动创作、自动运营及算力消耗规则，保留短信/图形验证码和 iOS 70% 发钻。
已购能力包绑定 AI，初始 sharp/rhythm 随初始 AI 赠送；其他能力先购买后装配。
上游的纯本地示例 AI/市场/余额不迁成付费资产；正式权益以服务器登记为准，每个环境首次生成一只初始 AI。
已有旧 Apple 充值订单和钱包保留，首次对账不会重复发钻。历史纯本地创作不自动登记为可付费作品。
安卓微信/支付宝尚未接入，本轮不宣称安卓已获得真实支付能力。

## 服务器升级

先备份 MySQL。把 `OpenElf-apple-commerce-20261022.tar.gz` 上传到服务器 `/root/`。
不需要重新填写已配置好的短信密钥、Apple 私钥和商品信息，不要使用旧部署包。

```bash
apple_commerce_dir=$(mktemp -d /root/openelf-apple-commerce-XXXXXXXX)
tar -xzf /root/OpenElf-apple-commerce-20261022.tar.gz -C "$apple_commerce_dir"
bash "$apple_commerce_dir/deploy/apple/install.sh"
cd /opt/openelf-api
node --env-file=/etc/openelf-api.env deploy/apple/check-runtime.cjs
curl -fSs http://127.0.0.1:8787/api/v1/health
```

安装保留支付开关：当前服务器是沙盒模式，就仍是沙盒。脚本不安装/升级依赖，
已经装过 `@apple/app-store-server-library@3.1.0` 的服务器可复用。
Node.js 20+；`openelf` 用户须可读私钥和根证书。失败时停止，根据备份路径恢复代码，不要清空表。

新增表 `payment_wallet_meta`（消费、欠额、收益、版本）、`payment_objects`（权益、订单状态、通知、请求去重）、
`payment_ledger`（余额变化流水）；旧的正式及沙盒钱包/订单表继续使用。表有环境字段；沙盒和正式不互通。
不得把一次健康检查通过当作 MySQL 并发、退款、权益交易验收通过。

## Apple 通知 V2

在 App Store Connect 对这款 App 配置两条 V2 通知地址：

- 正式：`https://openelfai.com/api/v1/ios/notifications/production`
- 沙盒：`https://openelfai.com/api/v1/ios/notifications/sandbox`

Nginx 必须把这两条 POST 路由转发到 `127.0.0.1:8787`，不应落到前端 HTML，也不能要求网页登录。
处理器只信任 Apple SDK 验证的外层通知和内层交易 JWS，拒绝伪造请求。不要把密钥放进 URL。
使用 Apple 测试通知验证回调到达，并核对数据库中的 TEST 处理记录；HTTP 200 本身不能代替签名及账本验证。

REFUND/REVOKE 扣回对应订单钻石，余额不足记欠额并冻结消费；后续充值先还欠额。
REFUND_REVERSED 恢复对应额度，但不会重复增加累计充值。
通知 UUID 去重、签名时间防乱序、原始交易账号绑定和原钻石数量在服务端校验。
CONSUMPTION_REQUEST / 未匹配通知保存在 `payment_objects` 的 notification/needs_review，必须建立人工查看流程；
没有获得用户同意前不会自动向 Apple 提交消费数据。当前不包含提现、自动税务结算或离线 AI 运营。

## 人工对账

部署后使用服务器本地工具；不要复制私钥到命令行。该命令会向 Apple 核实订单并按同一幂等规则更新账本：

```bash
cd /opt/openelf-api
node --env-file=/etc/openelf-api.env deploy/apple/reconcile.cjs 用户ID Apple交易ID
```

此工具不是定时对账/漏通知历史回放任务。上线运营必须监控 needs_review、失败回调和订单差异，
发生漏通知时人工对账；需要无人值守时另行配置持久化任务及告警。不要用日志重放或手动 SQL 直接加钻石。

## 正式开放前验收

1. 独立 MySQL 测试库演练升级、重复请求与并发购买、回滚；备份恢复可用。
2. Mac 编译通过，iPhone/Sandbox 走完 `app/IOS_IAP_TESTING.md` 的购买、消费、退款、补欠、账号切换和失败恢复。
3. 两个真实账号验证打赏/转售，不能给演示账号发收益；当前收益仅为待结算记录，没有提现。
4. Apple 两个回调入口和测试通知核实；退款/撤销已实际送达并对账。
5. App Store Connect 商品实际价格/地区/文案、协议税务银行资料、审核截图与审核版本齐备。

全部通过后，由操作者备份 env，只把以下三个开关调整为：

```text
APPLE_IAP_ENABLED=true
APPLE_IAP_SANDBOX_ONLY=false
APPLE_IAP_ALLOW_SANDBOX=true
```

然后重启 `openelf-api` 并逐项验收。保留 ALLOW_SANDBOX 是为了 Apple 审核，测试仍进入独立账本。
本轮不会自动运行此开放步骤；生产开关、真实订单或退款不能用本地模拟测试证明已经有效。

## 本地验证

`npm run test:payments` 运行模拟领域/HTTP/部署/验证码测试，不连接生产数据库或发送短信。
本地领域存储和 HTTP 的 Apple/MySQL 适配器被替换；这不是实际 MySQL 并发锁或 Apple 验签联网测试。
`npm test` 为旧鉴权数据库测试，会清理测试数据；必须显式使用独立 `DB_NAME=openelf_*test`，不用于生产。
