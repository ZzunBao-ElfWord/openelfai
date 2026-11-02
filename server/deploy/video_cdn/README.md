# OpenElf 视频 CDN 增量补丁

只添加独立视频URL映射模块，并在原有 commerce.js、world_uploads.js、world_videos.js 的已知响应位置做增量改动。不同线上版本不整体覆盖；未知/重复锚点直接停止。

## 行为

兼容修订版r2额外支持用户已提供SHA256的旧上传模块（c565ca47...ef6e79e）。仅改变 `return { post }` 中的视频URL；保留该版本原有校验/审核行为，不趁CDN部署加入新版pending_review。其他旧版本拒绝覆盖；新旧版本均可重复安装。

- 用户新上传、官方新生成及历史真实视频，通过信息流下发为 media.openelfai.com。
- 实际文件继续保存在 /opt/openelf-api/assets/world/videos，CDN按需回源缓存，不搬迁文件、不修改数据库URL。
- 上传归属、AI声明和审核流程原样保留；CDN不是审核平台。
- 不修改 app.js、config.js、环境文件、Nginx、支付、验证码、推送、网页文件或APK。
- 缺失的演示 sample.mp4 不替换成其他人的作品；该演示仍需独立处理。

## 安装边界

上传 tar.gz 到 /root，核对外层 SHA256，解压到 mktemp 新目录后运行 sha256sum -c SHA256SUMS。

先执行 `node --env-file=/etc/openelf-api.env install.cjs --check`：仅检查线上锚点/语法、API健康、网页强制验证码和CDN实际1KB分段读取；不修改文件、不重启。

预检通过后执行相同命令的 `--install` 模式。先在 /opt/openelf-video-cdn-backup-* 保存原文件和哈希清单，然后增量安装；使用真实 commerce 模块+虚拟只读存储验证映射，无数据库连接。仅API服务重启一次，短暂重连可能发生。失败则还原本次修改并验证服务健康；并发变化时停止覆盖并报告备份位置。

`--check` 不代表安装成功；只有出现“视频CDN补丁已安装”且后续真实登录信息流验收通过，才能认定线上已切换。重复安装已完成的补丁不会重复重启。

回退开关 VIDEO_CDN_ENABLED=false 仅控制视频URL映射，不关闭视频业务。安装器不会修改环境文件；如已有明确关闭配置会停止，不擅自打开。

CDN为付费流量服务。下架、删除作品时须同步刷新CDN缓存，不能仅删原站。只通过公开可访问素材路径分发；登录、支付和用户信息API不接入此映射。

证书当前覆盖 media.openelfai.com，到期前需续签并绑定新证书。未设置任何自动续签或费用告警。
