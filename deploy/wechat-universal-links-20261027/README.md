# 微信 Universal Links 部署准备（未部署）

注册值：`https://openelfai.com/app/`。关联文件使用之前已核对的发行团队 `ZJ3YQXTB93` 和 Bundle ID `com.ai.openelf`；若签名团队或 App Identifier Prefix 变化必须重新核对。

将本目录 `apple-app-site-association` 原样通过官网 HTTPS 提供在 `/.well-known/apple-app-site-association`，要求 200、有效 JSON、Content-Type application/json，无登录、无重定向，不能被 SPA/Next.js 路由覆盖。此文件不是访问 `/app/` 后显示的网页，也不包含微信 AppSecret。

若站点已有其他 App/路径关联，先读取并合并，而非覆盖。本文件仅为部署准备，没有执行远程操作。GitHub 最新 main 中同名文件还含 TEAM_ID 占位符，不能未经替换直接部署。

后续还须：

1. 确认网站直接返回正确内容，并确认 Apple CDN 已获取更新（有缓存延迟）。
2. Apple 开发者后台为该 App ID 启用 Associated Domains，并更新匹配能力的签名描述文件；本地 entitlement 不等于后台能力已开通。
3. Xcode 工程已准备 `applinks:openelfai.com`；保留已有推送 entitlement，未改签名团队或密钥。
4. 收到正确移动 AppID 后，统一填写 Dart 配置、iOS xcconfig 并加入该 AppID 的 URL scheme；不存在 AppID 时不注册空 scheme。
5. 核实部署及签名后再将 Dart `iosAssociationReady` 标志置 true；不可仅为让界面显示可用而打开。
6. 后续 iOS Xcode 编译、真机拉起/取消/回调验收。当前未打包，未验证微信后台权限。
