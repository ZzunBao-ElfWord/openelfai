# OpenElf iOS 内购与钻石消费测试（2026-10-22）

Bundle ID 固定 `com.ai.openelf`，不使用 Android 包名。App Apple ID `6761752635`。
本轮整合 GitHub `c1e6356`，不合入固定手机号免验证登录和启动免登录调试逻辑。

## 规则

- iOS 六档钻石：7、42、210、476、896、2086，商品 ID 为 `com.ai.openelf.gems数量`。
- 价格显示 App Store 返回值，数量由服务端配置决定；同价发 Android 70% 钻石是产品决定。
- 购买 AI、购买能力包、打赏、注算力均由服务端原子扣款，不能在本地增加余额。
- 能力包先明确确认购买，再装配；随当前 AI 转售，卸下不会丢失已购权益。
- 10 钻石换 1 算力；超过算力上限拒绝整个请求，不扣费。手动/自动创作按能力扣算力。
- 自动运营仅在 App 运行时轮询；不是服务端离线定时发布。服务端检查中枢、能力、算力与下次时间。
- 创作内容仍沿用上游本地示例模板，不代表已经接入真实大模型、图片、语音或视频生成。
- 退款扣回钻石；不足部分记录欠额，消费暂停，后续充值先补足。收益为待结算账目，无提现接口。

## 构建

先按 `server/PAYMENT_RELEASE.md` 更新服务器代码，保持沙盒模式。新客户端要求服务端 protocol=2；
旧服务器不显示可购商品，避免缺少退款和消费支持。旧的源码包和部署包不是本轮版本。

Mac 使用 Flutter 3.47.6 / Dart 3.13.5 或验证兼容的版本；Xcode/iOS SDK 应满足 Apple 上传要求
（此前上传明确提示需要 iOS 26 SDK）。在 `app` 目录执行：

```bash
flutter pub get
flutter build ios --config-only --no-codesign --dart-define=OPENELF_IOS_IAP_TEST=true
open ios/Runner.xcworkspace
```

在 Runner 的 Signing & Capabilities 中选自己的开发团队、确认 `com.ai.openelf`，启用自动签名与内购能力。
连接 iPhone 后执行 `flutter run --dart-define=OPENELF_IOS_IAP_TEST=true`，用 Sandbox Apple Account 测试。
不要在 Windows 尝试构建 IPA。当前目录 pubspec 版本仍为 `1.0.0+1`；上传前按 App Store Connect
实际版本指定 `--build-name` 和一个未使用的递增 `--build-number`，不要重复上传已有构建号。

## 真机验收（不可用单元测试代替）

1. 真正短信登录；打开钱包应显示“沙盒测试”，六档数量正确，价格来自 App Store。
2. 最小档购买后余额增加 7；取消不加钻；重复回调不重复发钻。
3. 断网/杀进程后重新打开，确认未结束订单；重试不重复扣费或发钻，换账号不串号。
4. 沙盒购买较大档测试注算力：例如 1 算力扣 10 钻；上限不足、余额不足均不扣。
5. 手动创作只扣对应算力；购买一个未拥有能力包扣正确钻石，重复购买不二次扣费，装配校验接口数。
6. 两个真实测试账号验证打赏与寄售转移；种子/演示 AI 不允许付费打赏，不能给自己打赏。
7. 用 StoreKit 沙盒退款工具/Apple 通知验证 REFUND、REFUND_REVERSED，覆盖已花完钻石的欠额与补欠。
8. 检查正式钱包与沙盒钱包独立；沙盒权益和收益不会进入正式环境。

普通 iOS 构建已具备内购入口，按原生 StoreKit 环境选择独立钱包。TestFlight/沙盒不应被当作真实收入。
`OPENELF_IOS_IAP_TEST=true` 强制只接受沙盒；正式上传构建不加此参数。
服务端尚未开放正式环境时，即使普通客户端也不能真实充值。

## 尚未验证

本轮 Windows 环境无法验证 Swift 编译、签名、iPhone 真实 StoreKit 回调和 Apple 实际验单；必须在 Mac/iPhone 完成。
本地服务端测试注入 Apple/MySQL 替身，不代表生产 MySQL 并发或 Apple 网络已经验证。
私钥、短信密钥和服务器 env 均不随源码包分发。
