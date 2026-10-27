# 普通分享（2026-10-27，未打包）

## 入口和体验

- 保留世界、聊天、视频流现有 `ShareHelper.shareElf` 入口，不移动到设置的第三方账号/舞台，不改变一键分发业务。
- 底部“分享至”面板：微信、抖音、小红书、哔哩哔哩；复制链接、生成分享图、更多系统分享。
- 无虚构好友列表。第三方好友选择由对应 App 提供，不读取本机通讯录。
- 当前素材是 AI 信息卡及所选内容摘要，不是原始视频上传、账号绑定或后台自动投稿。
- 分享图可预览、关闭或明确选择系统分享/保存。等待实际绘制帧再截图，释放图片内存；iPad 提供弹出位置，防重复点击。
- 未配置/未安装/待接入有明确状态；需用户再次选择才能改用系统分享或复制，不伪称平台发送成功。

## 抖音原生接入

用户确认 Client Key：`awf8w18qtnqq1kum`。Dart、Android、iOS AppID/回调 scheme 保持一致，不能只改一个构建参数。

- 本地插件 `third_party/openelf_douyin_share`，仅 Android/iOS；网页端明确待接入。
- 用户选择抖音后，先说明素材与 SDK，再选择好友/群或日常并同意；取消不初始化 SDK、不申请相册权限、不发送。
- Android 官方 SDK 0.2.0.10，包含网络/图片适配器。0.2.0.11 的官方 POM 依赖 `polaris:1.1.9.0.1-bugfix`，当前公开仓库返回 404，所以使用前一官方稳定版，不排除安全组件。此插件不使用 0.2.0.11 新增的 H5 授权功能。
- Android 首次同意后初始化，关闭自动埋点；只共享随机文件名的独立缓存 PNG，FileProvider 只开放 `douyin-share/`，授权只读，完成/超时撤销权限、清理本次缓存。
- Android 私信使用 `shareToContacts`，日常使用 `shareToType=1`；检查安装、场景能力、请求类型和随机 state，忽略旧/不匹配回调。
- iOS 官方 CocoaPods `DouyinOpenSDK 4.2.5`（已核对官方 Specs），声明 URL scheme、查询 scheme、Photos 权限和 SceneDelegate 回调。
- iOS SDK 需相册 localIdentifier：先明确告知并取得同意，再请求相册权限，仅保存本次卡片。该图片留在用户相册，可自行删除；不遍历或上传其他相册内容。
- iOS 私信使用 ShareContentToIM，日常使用 PublishMedia + publishStory/useNewShareAbility；匹配回调 state，取消/失败/超时不计成功。
- 抖音素材不附营销短链或品牌水印，仍保留“内容由 AI 生成”。不发送未经审核的链接卡片，不调用普通投稿权限。
- `ready` 仅表示本地插件配置及安装检测满足尝试条件，不证明后台权限审核或真机发送成功；结果 handedOff 也不是发布凭据，不记收益/计分。

## 另外三个渠道

微信、小红书、哔哩哔哩尚无生产 SDK 适配器及完整获批配置，不能直接定向发送。当前仅保留入口和显式确认后的系统分享/复制；系统能否显示目标 App 取决于已安装 App 和素材支持。

公开 ID 预留：`OPENELF_SHARE_WECHAT_APP_ID`、`OPENELF_SHARE_XIAOHONGSHU_APP_ID`、`OPENELF_SHARE_BILIBILI_APP_ID`。仅填 ID 仍是待接入，不代表开通。

后续分别核对微信移动分享/Universal Links、小红书正式内容分享 SDK、哔哩哔哩获批开放能力。不能用随意构造 scheme 或打开系统面板冒充官方投稿。

## 隐私和验收边界

- 不传登录 token、AppSecret、手机号、身份证或 API Key；不自动导出完整聊天记录，不改登录/支付/提现/服务端或签名。
- 上线前须同步网站与 App 隐私政策的抖音 SDK 披露：开发者、用途、信息范围、权限、官方政策链接；现有政策文字不自动代表已覆盖新增 SDK。
- Android 插件 Java 编译已通过；Flutter 逻辑/面板/预览/取消/异常路径有自动化测试。
- Windows 不能完成 iOS Xcode 编译；尚未进行 Android/iOS 真机拉起、取消、回调、权限拒绝和分享内容验收。
- 真机须核对平台登记包名 `com.openelf.app`、正式 APK 签名、iOS Bundle ID `com.ai.openelf` 及测试应用白名单/正式状态。所有渠道未验收前不宣称全部可用。
- 按用户要求不生成 APK/IPA、不部署、不触发 CI；现有 build14 不含本次改动。

## 官方资料

- [Android 接入](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/sdk/mobile-app/access/android)
- [Android 下载与更新记录](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/sdk/mobile-app/sdk-download/android)
- [iOS 接入](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/sdk/mobile-app/access/ios)
- [Android 私信分享](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/sdk/mobile-app/douyin-share/android-share-with-douyin)
- [iOS 私信分享](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/sdk/mobile-app/douyin-share/ios-share-with-douyin)
- [转发日常](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/sdk/mobile-app/douyin-share/forward)
