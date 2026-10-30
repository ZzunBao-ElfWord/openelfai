# OpenElf iOS 内购接入状态

已参考空空电竞在 `Z:\gpt资料\apple-vip-work` 的通过测试代码。OpenElf 的客户端是 Flutter/StoreKit，不是 uni-app；这里只借鉴「苹果交易先经服务端验票、交易 ID 幂等发货、成功后才完成交易、失败时保留未完成交易供重试」的业务流程，不复用空空电竞的商品 ID、Bundle ID、API 私钥或后端表。

## 目前完成

- 新增 Flutter iOS 工程，Bundle ID 设置为 `com.ai.openelf`。**尚未在 macOS/Xcode 签名、编译或真机测试**。
- `in_app_purchase` 接收 StoreKit 交易；服务器返回商品目录后查询 App Store 产品、以 Apple 返回的实际价格展示。只有服务端验票和发放成功，客户端才调用 `completePurchase`。本地模拟充值入口已移除。
- 服务端使用 Apple 官方 App Store Server Library：用 App Store Server API 按交易 ID 获取签名交易，再使用 Apple 根证书验签、校验 Bundle ID、商品 ID 和撤销状态。交易 ID 只发放一次，重复提交不会重复加钻石。
- `APPLE_IAP_ENABLED=false` 且 `APPLE_WALLET_AUTHORITY_READY=false` 为默认值；在这两个开关都未开启、且没有正式商品目录时，客户端不会展示可购买商品。

## **不能立刻上架收费的原因**

1. OpenElf 的 App Store Connect 商品 ID、钻石数量和正式价格尚未确认。`Z:\gpt资料` 里空空电竞的 `com.konglingapp.*` 属于另一个 App，不能复用。
2. 当前 OpenElf 的 AI 买卖、打赏和钻石消费仍在 `AppState` 本地计算。**在所有消费与余额都迁到服务端前，不得把 `APPLE_WALLET_AUTHORITY_READY` 设为 `true`**，否则余额可被设备数据篡改或跨设备不同步。
3. 仍需退款/撤销通知处理、对账、真实商品测试、Apple 沙盒真机测试。不能把本地单元测试视为苹果支付测试通过。
4. 这份 iOS 工程由 Flutter 模板新生成，签名、图标资源和 App Store Connect 对应关系要在 Mac 上核验。此 Windows 环境无法构建或上传 IPA。

## 将来上线前在服务器配置（密钥不要提交到 Git）

`/etc/openelf-api.env` 中需设置：

```text
APPLE_IAP_PRODUCTS_JSON='{"在App Store Connect创建的真实商品ID":10}'
APPLE_IAP_BUNDLE_ID=com.ai.openelf
APPLE_IAP_APP_ID=应用的数字 Apple ID
APPLE_IAP_KEY_ID=内购API密钥ID
APPLE_IAP_ISSUER_ID=内购API签发者ID
APPLE_IAP_PRIVATE_KEY_PATH=/etc/openelf-secrets/SubscriptionKey_XXXX.p8
APPLE_IAP_ROOT_CERT_PATHS=/etc/openelf-secrets/AppleRootCA-G3.cer,/etc/openelf-secrets/AppleRootCA-G2.cer,/etc/openelf-secrets/AppleIncRootCertificate.cer
APPLE_IAP_ALLOW_SANDBOX=true
```

`.p8` 与 Apple 根证书文件必须在服务器本地由低权限服务用户读取；不要放在 `/var/www/openelf`、Flutter assets、Git 仓库或聊天中。生产环境将 `APPLE_IAP_ALLOW_SANDBOX=false`。只有在服务端资产结算、退款处理和真机测试完成后，才可将两个启用开关设为 `true`。

Nginx 在 `openelfai.com` 的 HTTPS `server` 块中也需转发 `/api/v1/ios/` 到同一个 127.0.0.1:8787 服务（配置备份见 `deploy/openelf-api.conf`）。不要把密钥文件放在 Nginx 网站根目录。

## 接口

- `GET /api/v1/ios/products`：返回已启用的商品 ID 与钻石数量；默认空列表。
- `GET /api/v1/ios/wallet`：返回服务端钱包；需要登录令牌。
- `POST /api/v1/ios/verify`：`{"productId":"...","transactionId":"..."}`；需要登录令牌。只有服务端苹果验票通过才幂等入账。

此阶段只完成安全的接入基础，不代表支付已可收款。
