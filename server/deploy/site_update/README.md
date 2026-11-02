# 官网与开放平台控制台更新（2026-11-02）

- 先前 console-auth 仅在 Z 目录的独立部署补丁中；Next 官网源码未集成。已将适配器、真实验证码 SDK 和回归纳入 web/public/console/auth，由根布局 beforeInteractive 加载；首页进入控制台也可用。
- API 仅追加 https://open.openelfai.com 到既有精确 CORS 白名单，不使用星号，不移除既有环境配置或 web 域名。
- 分别构建 site/open 两种静态导出，目标为 /var/www/openelf 和 /var/www/openelf-open。web.openelfai.com 的 Flutter 站已单独验证，不重复覆盖。
- node install.cjs --check 为只读预检；--install 保留两站点及 API 原文件到 /opt/openelf-sites-backup-*，只改 app.js 中一个已核对 CORS 锚点，必要时重启 API。无锚点、验证码非 enforce、付款路由匿名鉴权异常即停止。
- 不替换整个 API、不改 Nginx/密钥/env/数据库，不重打移动包、不启用链服务、不发送短信或创建订单。安装后验证两站点关键资源、白名单正反例、验证码配置和支付鉴权；失败尝试回滚并保留失败产物。
- 上线后需本人完成真实验证码登录，确认控制台账号数据与余额，再退出；不能以模拟测试代替真实验收。
- Next 15.5.4 依赖审计仍报告 1 critical/2 high；本包仅静态文件，不运行 Next 服务端。安全依赖升级尚未完成，不宣称全系统安全核验完成。后台、原生包和完整 API 新功能不在这个登录更新包中。
- 可确认旧站点缺少修复与 CORS 许可，不能仅据此判断哪位操作者/哪次 git pull 或部署导致覆盖。
