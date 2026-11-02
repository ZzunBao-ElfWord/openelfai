# 极光推送恢复合并记录

## 原来的配置保存在哪里

- 旧工作目录：`Z:/openelf`。原推送模块未进入后续iOS/Android构建工作树。
- 原客户端文件：`app/lib/push/push_service.dart`、`push_destination.dart`、
  `app/lib/pages/push_settings_page.dart`、`app/android/app/build.gradle.kts`。
- Android公开AppKey：`3439c18b0c3021ae5e29ba92`，包名`com.openelf.app`。
- iOS公开AppKey：`26cb5da674a8da5e9aa0128d`，Bundle ID `com.ai.openelf`。
- 当前iOS工程原本就有APNs entitlement及分发签名的production检查，本次未移除。
- 服务器由`/etc/openelf-api.env`提供JPUSH_*开关和凭据，但尚未读取服务器实际配置。
  Master Secret只应留在服务器；APNs凭据需在极光后台核查，不能从源码推断已完成。

## 合并范围

- 固定使用旧目录的jpush_flutter 3.5.9，并复用原两端AppKey。
- SDK仅在同意并开启消息通知后初始化；已授权用户登录后恢复。
- 设置→消息通知入口、通知权限、设备注册、绑定/解绑、通知点击站内跳转。
- 换号重新绑定；退出/注销解绑并暂停本机推送；令牌失效只本地暂停，避免递归鉴权。
- 去掉旧代码中不存在的ElfDetailPage引用，AI通知指向现有AI作品页。
- 同一通知只跳转一次，不执行通知中任意URL，不允许跨账号跳转。
- 默认不展示Registration ID，用户需要排障时可复制诊断标识。
- 保留支付平台差异、网页充值、P1图标、内容安全和最新iOS价格查询修改。
- 客户端隐私政策补充可选SDK说明，正式发布前仍需同步官网政策；不是法律合规认证。

## 服务端

- `server/src/push.js`：从旧模块恢复，保留定向推送及会话有效性过滤。
- `server/src/push_routes.js`：独立读取原环境变量并注册推送路由。
- `server/deploy/push/install.cjs`：只添加两个模块及一条入口；不替换旧服务器的配置/DB源码。
- 设备表延迟创建；只在已登录并启用功能的绑定/发送调用时创建，不迁移资金或用户资料。
- 发送管理令牌和登录令牌分开；普通用户不能调用发送接口；无广播接口。
- 按ios production/development区分APNs发送；TTL为0，避免过期会话离线排队。
- 退出注销端到端效果仍需在实际服务器及真机核验，历史生产注销实现未被覆盖。

## 尚未完成

1. 服务器运行增量包和只读配置检查。
2. 核对Master Secret、服务端开关及极光后台APNs配置。
3. 使用新正式客户端验证前台、后台、锁屏、点击跳转和换号。
4. Android厂商离线通道凭据未在本轮新增；不能保证所有品牌杀进程后可达。
5. 业务自动触发未新增：本轮恢复基础通道，不会自动向客户推送消息。

旧Build20 APK未被改写，本轮合并不会让已安装客户端自动具备SDK。
不自动调整版本、上传仓库、创建正式安装包或提交商店。
只做本地测试及编译验证，没有发送真实推送。

验证结果：完整客户端147项通过、1项跳过；推送/部署/既有支付收益相关服务端19项通过。
推送模块静态检查无问题。安卓调试APK编译成功，已核验包含极光SDK；不是正式交付包。
