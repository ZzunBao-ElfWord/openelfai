# OpenElf 阿里云图形认证配置

OpenElf 使用阿里云“号码认证服务”中的 Captcha4 图形认证。控制台路径：

`号码认证服务 > 融合认证（基于原子能力）> 图形认证服务 > 图形认证方案管理`

## 1. 创建方案

OpenElf 已分别创建 Android 和 iOS 图形认证方案。建议各应用独立管理方案，取得各自的 `appId` 与 `appKey`。

- `appId` 是公开标识，OpenElf 的默认值已配置在 `app/lib/config/captcha_config.dart`，也可通过 Flutter 的 `--dart-define` 覆盖。
- `appKey` 只能保存在服务器环境变量中，禁止写入 Flutter、Git 或部署压缩包。

## 2. 服务端环境变量

参照 `server/.env.captcha.example`，将以下变量合并到现有服务端环境文件中，并填入两个方案各自对应的 `appKey`。不要用此片段覆盖数据库、短信等原有配置。两个密钥都填完后，再启用图形验证并重启服务。

```dotenv
ALIYUN_CAPTCHA_ENABLED=true
ALIYUN_CAPTCHA_ALLOW_ON_ERROR=true
ALIYUN_CAPTCHA_ANDROID_APP_ID=2d129e705ac4cd4df085390ec213b492
ALIYUN_CAPTCHA_ANDROID_APP_KEY=控制台中的Android方案appKey
ALIYUN_CAPTCHA_IOS_APP_ID=a6a503af8a6273b0c3842ef3432f08a1
ALIYUN_CAPTCHA_IOS_APP_KEY=控制台中的iOS方案appKey
```

`ALIYUN_CAPTCHA_ALLOW_ON_ERROR=true` 遵循阿里云的可用性建议：只有阿里云接口超时或 5xx 等异常时，使用现有 IP、手机号频控兜底放行；阿里云正常返回验证失败时始终拦截。

## 3. Flutter 构建参数

正常构建会使用已配置的 OpenElf 方案 ID，无需额外参数：

```bash
flutter build apk
```

需要临时切换方案时，可以使用：

```bash
flutter build apk \
  --dart-define=ALIYUN_CAPTCHA_ANDROID_ID=Android方案appId \
  --dart-define=ALIYUN_CAPTCHA_IOS_ID=iOS方案appId
```

iOS 构建使用相同的两个 `dart-define`。这些值是公开的方案 ID，不是服务端 `appKey`。

## 4. 上线检查

1. 未开启 `ALIYUN_CAPTCHA_ENABLED` 时，服务端保持原短信流程，便于分阶段部署。
2. 先部署服务端代码与环境变量，再发布带相同 `appId` 的客户端。
3. 在测试手机上确认取消、失败、成功、重复点击和网络异常行为。
4. 开启后直接调用 `/api/v1/auth/send-code` 而不带四项图形凭证，应返回 `CAPTCHA_REQUIRED`。
