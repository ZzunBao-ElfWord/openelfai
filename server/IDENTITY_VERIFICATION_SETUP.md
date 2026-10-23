# OpenElf 阿里云身份证 OCR 二要素核验

OpenElf 使用阿里云“信息核验”的 `Id2MetaVerifyWithOCR` 接口。Flutter 只把用户主动选择的身份证人像面、国徽面发送到已登录的 OpenElf API；阿里云密钥只存在服务端。

## 1. 阿里云准备

1. 在实人认证控制台确认“信息核验”已经开通。
2. 为服务器创建独立 RAM 身份。信息核验使用系统策略 `AliyunYundunCloudAuthFullAccess`；`AliyunAntCloudAuthFullAccess` 属于金融级实人认证，不适用于本接口。后续可收敛为仅允许 `yundun-cloudauth:Id2MetaVerifyWithOCR` 及官方 Advance 上传所需权限的自定义策略。
3. 配置消费预警和业务调用监控。接口没有自动消费封顶，不应只依赖余额控制风险。

## 2. 服务端配置

把 `.env.identity.example` 中的变量合并到服务器现有环境文件，不要覆盖数据库、短信、验证码和支付配置：

```dotenv
ALIYUN_CLOUDAUTH_ENABLED=true
ALIYUN_CLOUDAUTH_ACCESS_KEY_ID=RAM用户AccessKeyId
ALIYUN_CLOUDAUTH_ACCESS_KEY_SECRET=RAM用户AccessKeySecret
ALIYUN_CLOUDAUTH_ENDPOINT=cloudauth.aliyuncs.com
ALIYUN_CLOUDAUTH_REGION_ID=cn-hangzhou
```

如果服务器已经通过 ECS RAM 角色等无长期密钥方式取得凭据，可后续把 `src/identity.js` 的客户端初始化切换为默认凭据链。禁止把 AccessKey 写进 Flutter、Git、日志或客户端构建参数。

重启 API 时，`src/db.js` 会自动建立 `identity_verifications` 表。表中仅保存状态、脱敏姓名、脱敏身份证号、阿里云请求 ID 和核验时间，不保存证件原图或完整证件信息。

## 3. HTTP 接口

- `GET /api/v1/identity/status`：查询当前登录账号的服务端实名状态。
- `POST /api/v1/identity/verify`：提交正反面 JPG/PNG base64；每张不超过 2 MB，并且必须显式提交 `consent: true`。

服务端每 IP 每小时最多接受三次核验，并在账号已验证时直接返回已保存状态，避免重复计费。

## 4. 上线检查

1. 先在测试账号使用清晰、完整、无遮挡的证件照片联调。
2. 验证未登录、未勾选授权、超大图片、非 JPG/PNG、信息不一致和阿里云不可用场景。
3. 检查 Nginx 请求体限制不低于 6 MB；建议只对 `/api/v1/identity/verify` 放宽。
4. 在隐私政策中说明处理目的、字段、第三方服务商、保存期限及用户权利，并在上传前取得单独同意。
5. 确认应用日志、反向代理访问日志和错误监控不会记录请求体。
