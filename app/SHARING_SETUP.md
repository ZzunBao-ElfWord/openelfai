# 四渠道分享预接入（2026-10-27）

## 已实现

- 所有现有 ShareHelper.shareElf 入口（世界、聊天、视频信息流）统一打开渠道面板。
- 哔哩哔哩、小红书、抖音、微信，以及系统分享/复制链接。
- 明示将分享AI名称、人设、公开数据及所选摘要；取消不上传，不自动跳第三方。
- 无凭证显示未配置；填ID但没有原生适配器时仍显示待接入。
- 未接通时必须用户再次确认才走系统分享/复制链接，不声称定向分享成功。
- 原AI卡片PNG与落地链接继续复用；这里只分享AI卡片，不是上传原始视频/自动投稿。
- iPad系统分享提供有效弹出位置；生成图片后释放内存，禁止重复点击并行分享。
- 不新增原生SDK依赖、不读取登录token、不改服务端、不记分享收益/计分。

## 当前未实现（不是已完成对接）

四平台官方SDK/API调用、应用注册、安装与能力检测、平台回调、Universal Links/URL Schemes、Android签名与回调Activity、用户授权/稿件发布与发布结果查询等，需取得具体能力说明后实现和真机验收。
目前发布版本中SocialShareService没有生产适配器，因此所有定向渠道均不可直接发送。
不能以随便构造URL Scheme、打开App、打开系统分享面板代替官方分享/发布成功。

## 接口与配置

- `lib/sharing/social_share.dart` 定义四个渠道、配置、素材、SocialShareAdapter、独立路由与状态。
- 实现每个平台适配器，并在share_card.dart的SocialShareService构造中显式注册。
- availability只有在官方SDK初始化、配置与所需能力真实可用后才返回ready。
- share结果为handedOff/cancelled/failed；handedOff只表示交给平台，不能作为发布成功/奖励依据。
- 若以后需要确认投稿成功，必须按平台规范接入可信回调或后端查单，且验证关联请求。

预留Dart define仅用于公开应用标识，不是平台官方参数名，也不是完整配置：

| 渠道 | 内部构建配置名 | 后续需要确认 |
| --- | --- | --- |
| 哔哩哔哩 | OPENELF_SHARE_BILIBILI_APP_ID | 具体开放能力、client_id、授权和服务端稿件接口；不能假设客户端SDK支持通用图文分享 |
| 小红书 | OPENELF_SHARE_XIAOHONGSHU_APP_ID | 获批的是内容分享/发布能力及其正式SDK资料，不是电商订单接口 |
| 抖音 | OPENELF_SHARE_DOUYIN_APP_ID | client_key、获批的投稿/私信能力、包名签名与Bundle ID、回调 |
| 微信 | OPENELF_SHARE_WECHAT_APP_ID | AppID、移动应用分享权限、包名签名、Bundle ID和iOS Universal Links |

凭证未发放时保持空值；不要填占位假Key。AppSecret、access_token、签名私钥不能放进Dart define、App包或公开仓库，需要秘密的操作应走服务端。
Android包名com.openelf.app，iOS Bundle ID com.ai.openelf；应与平台申请信息一致，现有签名不更换。

官方参考：
- https://open.bilibili.com/doc （客户端SDK授权与服务端稿件能力分开）
- https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/sdk/mobile-app/access/
- https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/sdk/mobile-app/access/ios

## 验收

- 默认无配置时四平台均提示未配置，没有SDK调用和自动上传。
- 用户取消不复制、不分享；用户明确选择后才允许系统分享。
- 系统面板是否出现各平台由系统和对应App决定，不承诺四个平台一定都支持此素材。
- 各平台独立测试未安装、无权限、缺配置、用户取消、失败、回调和重复点击。
- 分享内容不得带手机号、身份证、API Key或登录token；普通AI页面分享不会自动导出完整聊天记录。
- 有新SDK时同步核对官网/App隐私政策和第三方SDK披露，不以当前预留接口代表已采集该SDK数据。
- 不重新打包、不部署，保留用户暂停打包的要求。
