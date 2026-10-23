# Apple 内购接入

本轮包含 protocol=2 的客户端/服务端接入、账号绑定、验单幂等入账、服务端钻石消费与权益、
退款欠额、通知去重与乱序保护、人工对账工具。部署和验收见 [PAYMENT_RELEASE.md](PAYMENT_RELEASE.md)。
代码通过本地模拟测试不等于正式收费上线；仍需真实 MySQL、Mac/iPhone 沙盒和 Apple 通知验收。

公开配置模板在 `.env.apple.example`。不要覆盖现有 env，只调整必要的 `APPLE_IAP_*`。
私钥路径为 `/etc/openelf/keys/SubscriptionKey_P245X949C7.p8`，运行用户 `openelf` 必须可读。
私钥内容不能放入 App、源码库或聊天。

| 中国大陆计划价格 | iOS 钻石 | 商品 ID |
| ---: | ---: | --- |
| ¥1 | 7 | com.ai.openelf.gems7 |
| ¥6 | 42 | com.ai.openelf.gems42 |
| ¥30 | 210 | com.ai.openelf.gems210 |
| ¥68 | 476 | com.ai.openelf.gems476 |
| ¥128 | 896 | com.ai.openelf.gems896 |
| ¥298 | 2086 | com.ai.openelf.gems2086 |

所有商品为消耗型；实际付款金额以 App Store 价格配置和返回值为准。
用户决定 iOS 同价发 Android 70% 钻石，不是 Apple 强制比例。

钱包、权益和流水按 `Production` / `Sandbox` 隔离。
正式开放后允许 Apple 审核使用沙盒：`SANDBOX_ONLY=false`、`ALLOW_SANDBOX=true`，
这不会把测试钻石记入正式钱包。严禁把所有交易不分环境记到同一个账本。
