# OpenElf 阿里云短信登录服务

Flutter 客户端调用 `https://openelfai.com/api/v1/auth/`，服务器使用阿里云短信 API 发送验证码。AccessKey 只放在服务器的环境文件中，**不要放入 Flutter、网页代码或 Git 仓库**。网站 `web/` 是静态导出，不能直接承载短信接口。

## 需要准备

1. 当前选用阿里云已审核的签名「精灵跳动」和验证码模板 `SMS_512060716`，模板变量为 `code`。该模板原登记的场景是空灵 App 绑定手机号（`konglingapp.com`），虽然短信正文是通用身份验证文案，OpenElf 登录使用前仍应向阿里云确认实际场景适用性；长期建议申请 OpenElf 自有场景的模板。
2. 具有 `dysms:SendSms` 权限的专用 RAM 身份的 AccessKey ID / Secret。不要使用主账号密钥。
3. 服务器 Node.js 22 或更高版本（Apple 官方服务端库的要求）。运行前确认阿里云账号余额、短信发送权限和国内短信资质。

## 服务器配置

先把本目录上传到服务器上的独立路径（例如 `/opt/openelf-auth`），在该目录执行 `npm ci --omit=dev`。现有网站文件在 `/var/www/openelf`；不要把密钥放进此可公开访问的目录。

用服务器终端创建 `/etc/openelf-auth.env`，参照 `.env.example` 填写。不要在聊天、命令行参数或 Git 提交中粘贴密钥；用服务器上的编辑器输入。文件权限设为 `600`，属主设为运行服务的系统用户。`AUTH_HMAC_SECRET` 可在服务器上用 `openssl rand -hex 32` 生成，部署后不要随意更换（更换会使未使用的验证码失效）。

建议服务以独立的低权限用户运行，`/var/lib/openelf-auth` 只赋予该用户读写权限。systemd 配置示例：

```ini
[Unit]
Description=OpenElf authentication API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=openelf-auth
Group=openelf-auth
WorkingDirectory=/opt/openelf-auth
EnvironmentFile=/etc/openelf-auth.env
ExecStart=/usr/bin/node /opt/openelf-auth/server.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/openelf-auth

[Install]
WantedBy=multi-user.target
```

请先用 `command -v node` 核对 `ExecStart` 的 Node 路径。服务只监听 `127.0.0.1:8787`。在现有 `openelfai.com` 的 HTTPS Nginx `server` 块中增加：

```nginx
location /api/v1/auth/ {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

`proxy_pass` 此处**不要加末尾斜杠**，以保留 `/api/v1/auth/...` 路径。检查 `nginx -t` 成功后再重载。不要改动现有网站的 `root /var/www/openelf`。确认公网 HTTPS 请求 `/api/v1/auth/me` 返回 `401` 的 JSON，而非网站 HTML 或 404。

## 验证

本地自动测试不发送真实短信：在 `backend/` 执行 `npm ci`、`npm test`。真实短信联调在部署、填入正式签名和模板之后进行：通过 Flutter 输入自己控制的手机号码，确认收到短信、可登录、验证码仅使用一次，并测试发送间隔。服务端日志不得打印验证码或 AccessKey。

接口：`POST /api/v1/auth/send-code`、`POST /api/v1/auth/login-by-code`、`GET /api/v1/auth/me`、`POST /api/v1/auth/logout`。验证码有效期 5 分钟，同一号码 60 秒内不能重发、每天最多 10 次，输错 5 次后失效。登录令牌有效期 30 天。状态保存在 `/var/lib/openelf-auth/state.json`，须妥善备份并限制权限。

iOS 内购准备工作和上线前置条件见 [APPLE_IAP.md](APPLE_IAP.md)。其接口默认关闭，不能把当前代码当作已经通过苹果沙盒测试的支付系统。
