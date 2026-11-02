# 普通分享（2026-10-27，未打包）

## 入口和体验

- 保留世界、聊天、视频流现有 `ShareHelper.shareElf` 入口，不移动到设置的第三方账号/舞台，不改变一键分发业务。
- 底部“分享至”面板：微信、抖音、快手、小红书、哔哩哔哩；复制链接、生成分享图、更多系统分享。快手及B站审核字段暂空。
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

## 微信原生代码（AppID 已填写，未真机验收）

- 本地插件 `third_party/openelf_wechat_share` 使用腾讯官方 Android SDK `6.8.40`、官方 CocoaPods `WechatOpenSDK 2.0.9`；未加入 fluwx 依赖。SDK 本身包含多项能力，本项目只调用图片分享，不实现微信登录、OAuth、支付或自动分发，不代表 SDK 二进制是去支付符号版。
- 用户报告微信移动应用已通过审核，并确认 AppID 为 `wxf3b5d7fbc0abcd37`，已同步到 `lib/sharing/wechat_share_config.dart` 与 `ios/Flutter/WechatShare.xcconfig`；Info.plist 的 URL Types 通过同一 xcconfig 值注册。未采用之前身份尚未确认的其他 AppID，不需要 AppSecret。
- 审核状态来自用户确认，未登录平台独立核实。填入 AppID 不代表 iOS 关联文件已上线或两端实际发送已验收。
- 通过原内容页分享面板选择微信，再明确选择“微信好友”或“朋友圈”、同意说明后才初始化 SDK。取消不初始化、不发送；无配置保持未配置，不自动改用其他渠道。
- Android 仅查询微信是否安装，不在状态探测中创建 SDK；实际分享启用微信签名校验，传随机 transaction 并匹配响应类型和 transaction，180秒超时清理。只传本次 PNG 字节和小缩略图，不申请相册/通讯录/存储权限，不写共享缓存，不增加微信支付回调入口。
- iOS 校验 AppID、URL scheme 与登记 Universal Link 一致；只传图片数据，不保存系统相册。URL 和 Universal Link 由 SceneDelegate 转发；原抖音回调和 Flutter 默认处理保留。插件资源包带入与官方2.0.9一致的 PrivacyInfo 声明，因为其传统 CocoaPods 规格未列出资源；这不替代 App 的完整隐私披露。
- iOS 官方分享响应没有 transaction 字段，因此仅在单次待处理请求内接受分享类型响应，不能提供与 Android 相同的逐请求关联保证。SDK 成功/拉起不是发布证明，也不据此加奖励、收益或权限；冷启动回跳与超时后旧回调仍须真机验证。
- 准备 `applinks:openelfai.com`，保留原推送 entitlement。网站 AASA 文件与部署要求在 `deploy/wechat-universal-links-20261027`，没有部署到线上。
- `iosAssociationReady` 默认 false；关联文件部署、Apple 后台能力/签名描述文件匹配并验证后才打开，不为让按钮显示可用而打开。
- PNG 的8MiB/4096像素边长限制为本项目内存防护预算，不是对微信产品限制的承诺。
- 当前 Android 插件 Java 编译通过，Dart 自动化测试覆盖状态、取消、场景与错误处理、配置一致性。Windows 无 Xcode，iOS 未编译，两端未实际使用生产 AppID 调用 SDK 或真机发送。SDK 官方文档仍需结合实际权限核对。

上线前隐私披露草案（未写入官网现行协议）：SDK 名称“微信 Open SDK”，开发者“深圳市腾讯计算机系统有限公司”，用途“用户主动将当前 AI 分享图片交给微信好友或朋友圈”；信息范围须依据所用官方版本说明披露分享图片、必要的应用/签名、设备系统与网络信息及 SDK 实际处理的数据。仅用户同意后调用，不读取通讯录、不用于账号绑定，不应宣称 SDK 不处理任何设备信息。正式披露应补上平台提供的官方 SDK 隐私说明链接并同步官网与 App，不以本草案替代完整政策。

参考：[腾讯官方 Android SDK 发布](https://repo.maven.apache.org/maven2/com/tencent/mm/opensdk/wechat-sdk-android/6.8.40/)、[官方 iOS 发布规格](https://github.com/CocoaPods/Specs/blob/master/Specs/f/f/3/WechatOpenSDK/2.0.9/WechatOpenSDK.podspec.json)、[微信 iOS 接入指南](https://developers.weixin.qq.com/doc/oplatform/Mobile_App/Access_Guide/iOS.html)。

## 其他待接入渠道

### 快手 SDK 代码预接入（审核字段为空）

- 新增 `third_party/openelf_kwai_share`，Android 固定官方 SDK `kwai-opensdk-withauth 3.7.6`，iOS 固定官方 `KwaiSDK 3.7.3`。已核对下载的 Android AAR 与官方 iOS 对应 tag 头文件，不填入官方示例的 AppID。
- `lib/sharing/pending_share_config.dart` 集中保留空 `KwaiShareConfig.appId` 和空 `BilibiliShareConfig.clientId`。无标识时状态探测、初始化、相册请求和分享调用全部不触发；不能填入模拟值让界面显示可用。
- 用户主动选择快手并同意后，调用 Android `SinglePictureEdit.Req` / iOS `KSShareMediaFeature_PictureEdit`，只交给图片编辑页，后续由用户在快手内确认发布。不是自动发布，也不是私信授权、好友绑定或视频上传；本次先适配快手主版，不承诺极速版。
- 不调用 KwaiAuthAPI 或 KSAuthRequest，不申请 openID、手机号和关系链，不需要在客户端配置 AppSecret。官方 Android SDK 发包包含 auth 代码，但合并清单移除了其登录 Activity/别名，没有自创无授权二进制或移除安全校验实现。
- Android 主工程 `android/gradle.properties` 中 `OPENELF_KWAI_APP_ID` 为空，Gradle 将其传给 SDK manifestPlaceholders，原生检查它与 Dart AppID 一致。`android/app/build.gradle.kts` 只新增公开 AppID 占位符，不改支付依赖/签名/包名。
- 状态探测仅读取本地安装与 manifest 信息，实际用户同意后才初始化 SDK；禁止自动跳应用市场、清空任务栈、功能降级。使用独立 `KwaiShareFileProvider`，只开放 `kwai-share/` 本次随机 PNG，只读授权给快手主版，完成/超时清理。不能为解决与其他 Provider 的冲突而覆盖它们的 authority 或路径。
- Android 匹配响应类型、随机 transaction 和 sessionId，只将 SDK 成功信号视为交接，不发放奖励、不当作可信发布证据。原生缓存上传外无日志记录图片/账号信息。
- iOS 先说明权限和留图，再请求 Photos 读写权限并创建本次卡片资源；图片会留在相册，可自行删除，不遍历其他照片。SDK 回调匹配响应类型和 state，180秒超时。相册拒绝、回跳冷启动、快手版本差异尚需真机验收。
- `ios/Flutter/KwaiShare.xcconfig` 的 `OPENELF_KWAI_APP_ID` 为空，目前不注册空 URL scheme。审核通过后需同步 Dart/Android/iOS 三处公开 AppID 并新增对应 URL scheme，核对注册的 Universal Link；AppID不是只填Dart就完成原生配置。
- 暂按 `https://openelfai.com/app/` 准备回跳，复用尚未部署的 AASA `/app/*` 关联。若快手后台登记不同路径需先统一；`iosAssociationReady=false` 不能提前打开。保留原微信、抖音和 Flutter 默认回调，不改已填写微信 AppID。
- Android 插件 Java 编译和宿主 `processDebugMainManifest` 合并检查通过；相关 Dart 静态检查、客户端回归通过。iOS 仅完成头文件 API 核对，Windows 无 Xcode，未编译也未真机发送；尚不称已实际接通。
- 上线前须按所用 SDK 的实际信息处理范围补充快手第三方 SDK 隐私披露，核对官方版本隐私清单、使用协议及 App Store 隐私标签；确认页和本说明不能代替正式政策。

官方依据：[Android 接入](https://open.kuaishou.com/platformDocs/develop/mobile-app/android.html)、[iOS 接入](https://open.kuaishou.com/platformDocs/develop/mobile-app/ios.html)、[官方 iOS 示例](https://github.com/KwaiSocial/KwaiSDK-iOS)。

### B站代码预接入

- `lib/sharing/bilibili_share_adapter.dart` 已注册到普通分享入口，预留 `BilibiliShareGateway` 接口；它是内部适配契约，不是已获批的官方 API。
- 待审核 Client ID 现集中留在 `pending_share_config.dart`，默认构造适配器使用它。不再通过未核实的构建参数自动写入标识。既没有普通分享的生产网关，也未擅自改成 SDK 授权、账号绑定、私信接口或稿件投稿。
- 无 Client ID 时“未配置”；仅填 Client ID、没有正式网关时仍“待接入”。默认没有网络、OAuth、原生 SDK 或后台发布调用。
- 准备只读的独立 PNG 字节副本、标题、所选摘要及本站 HTTPS 链接；校验完整 PNG 文件头、本站无凭证/默认端口链接、非空标题和本地 8MiB 内存预算。该预算不是平台官方限制，文件头检查也不等于完整图片解码。
- 不携带抖音场景或登录密钥，不伪造平台协议、投稿地址或 URL scheme；取消/失败不当成功。
- 用户创建应用后需提供公开 Client ID 和获批能力/正式文档，确认支持普通分享后才能实现网关。官方当前公开客户端 SDK 介绍为账号授权，不能据此擅自转成账号绑定或稿件发布；如果只有稿件能力，需要另行确认产品流程。
- 参考：[B站官方文档中心](https://open.bilibili.com/doc)。填入 ID 不是完成接入，仍须实际实现并验收。

小红书、哔哩哔哩尚无生产 SDK 网关及完整获批配置，不能直接定向发送。当前仅保留入口和显式确认后的系统分享/复制；系统能否显示目标 App 取决于已安装 App 和素材支持。

小红书公开 ID 预留为 `OPENELF_SHARE_XIAOHONGSHU_APP_ID`；B站、快手使用上述空配置。仅填 ID 仍不代表权限开通或完成接入。微信使用上述独立配置，避免构建参数与原生 URL scheme 不一致。

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
