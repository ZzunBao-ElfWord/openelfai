# 网页充值恢复 2026-11-02

仅更新 /var/www/openelf-webapp 静态站点，不改API、Nginx、订单、支付配置、密钥、环境文件或数据库。旧站点整目录备份，关键公网文件哈希核对失败自动回滚。不会下单或付款。

线上2026-10-30主包SHA256为084126d6884536e31338e8ab17581c74cb7739f9da63247a1586e0efbec795a0，含关闭充值的兜底文案，不含网页钻石充值接口与面板；与此前有充值的2026-10-29布局包主包不一致。这能确认构建功能回退，不能仅据此认定操作人或具体覆盖命令。

恢复版采用当前集成源码，版本1.0.4 Build22不变，保留网页钻石充值、API余额充值、扫码订单校验、旧订单处理、验证码桥接、CDN映射及已有其他功能。静态API必须显式指定https://openelfai.com：web.openelfai.com的/api请求目前回落到HTML首页，不是充值接口正常。

防回退：打包和安装都检查实际JS内的两类充值接口、正确API域名、充值面板和验证码入口；主包及bootstrap带发布查询标识，减少旧缓存混用。不会清除localStorage、登录或订单数据。此包没有盲目清除整个域名缓存。

先执行 bash install.sh --check，只读预检成功后再 bash install.sh --install。需要root及node/curl/sha256sum。API鉴权路由必须返回401 JSON，验证码须enabled=true、mode=enforce；不通过即停止。不修改开关来强行通过。

注意：匿名401只能证明路由存在，不证明真实账号的商品、支付配置与付款已通过。部署后必须登录确认钻石档位、API余额、扫码入口及钱包状态；不自动执行真实付款。

手工回滚：安装会打印备份路径；仅在核对真实备份和当前站点路径后，将当前站点移到另一个新备份目录，再将原备份的site移回/var/www/openelf-webapp。不要删除任何备份。

源码构建：在app目录执行 flutter build web --release --no-pub --pwa-strategy=none --dart-define=OPENELF_API_BASE=https://openelfai.com --dart-define=VIDEO_CDN_ENABLED=true，再用node server/deploy/web_recovery/package.cjs 指定一个新的输出tar.gz路径。无需修改安卓/苹果版本或重新打移动包。
