# OpenElf 图形验证服务器补丁

目标服务：`openelf-api.service`；源码：`/opt/openelf-api`；环境文件：`/etc/openelf-api.env`。

此包只对已有 `src/app.js`、`src/config.js` 插入图形验证逻辑并安装 `src/captcha.js`。不更新数据库、内购模块或 npm 依赖。无法匹配已有代码时会在更新前停止。

先在服务器环境文件中填好 Android、iOS 方案的 appId 和 appKey（参照包内 `.env.captcha.example`），并设置 `ALIYUN_CAPTCHA_ENABLED=true`。不要将密钥写到此补丁目录或上传到公开网站。

将 `OpenElf-captcha-update-20261022.tar.gz` 上传到服务器 `/root/`，在服务器终端执行：

```bash
mkdir -p /root/openelf-captcha-update-20261022
tar -xzf /root/OpenElf-captcha-update-20261022.tar.gz -C /root/openelf-captcha-update-20261022
bash /root/openelf-captcha-update-20261022/deploy/captcha/install.sh
```

脚本要求 root 权限、Node.js 20.6 或以上（支持 `--env-file`）、curl，且原服务处于运行状态。配置检查不会打印密钥，不发送短信，不改变环境文件。

安装前自动备份源文件到 `/opt/openelf-captcha-backup-XXXXXXXX`，随后重启 `openelf-api` 并检查本机健康接口。失败时恢复原入口和配置并重启原服务；故障原因可用 `journalctl -u openelf-api -n 50 --no-pager` 查看。新增的、未被原入口引用的 `src/captcha.js` 会保留。

看到“图形验证更新成功”仅说明代码更新和健康检查完成；还需安装使用 OpenElf 新 appId 的客户端，在手机上实际完成图形验证和短信登录。
