# 账号注销修复（2026-10-27）

旧版本“删除账号”仅调用 logout，服务端没有删除账号。V2 另外补齐独立 `identity_verifications` 实名结果表的清理。

## 安装

先将 OpenElf-AccountDeletion-20261027.tar.gz 上传到服务器 /root，再在服务器终端执行：

```bash
(
  set -e
  account_deploy=$(mktemp -d /root/openelf-account-deletion-XXXXXXXX)
  tar -xzf /root/OpenElf-AccountDeletion-20261027.tar.gz -C "$account_deploy"
  node "$account_deploy/install.cjs" --check
  node "$account_deploy/install.cjs" --install
)
```

安装会备份 app.js，仅插入注销路由注册并增加独立 account_deletion.js；重启 API 后检查健康接口和未登录注销接口（必须401）。失败自动恢复本次代码。不会调用真实注销、短信或支付接口，不替换登录/验证码/支付/网页，不修改环境文件或数据库结构。

然后安装配套 iOS 1.0.4（9）客户端。若需立即注销，可在安装 V2 后执行 `node delete-account-cli.cjs`，根据提示输入手机号及精确用户 ID 二次确认。若 V1 已经把手机号解绑但遗漏实名资料，可先输入 `LIST` 查看残留账号，再输入准确旧用户 ID，使用 `CLEANUP_DELETED:<用户ID>` 清残留。

## 行为及限制

- POST /api/v1/auth/delete-account，必须已登录，并明确传 confirmation=DELETE_MY_ACCOUNT。不接受客户端指定目标用户。
- 同一数据库事务内清除个人资料、实名资料、AI/内容/聊天等个人业务对象、短信凭证及开发者资料；撤销所有设备会话和 API Key，移除密钥密文，解绑可选的推送设备；原用户记录去标识化并永久禁用。
- 不直接删除支付、提现、钱包和账务历史。历史继续关联旧的不可登录用户ID，避免重复入账或重新注册恢复旧资产。剩余钻石不转移、不自动退款。
- 存在平台余额、冻结资金、未结算收益、退款欠款、待确认订单或未终结提现时拒绝注销并提示先结算；不擅自关闭或删除这些交易。
- 手机号脱离原账号，再次短信登录是新注册，生成新用户ID。注销不是退款，也不会取消外部订阅；如有订阅需用户在相应订阅管理处处理。
- 服务器明确返回 deleted=true 后才清除本地令牌和账号缓存。网络异常、接口未部署、结算未完成均提示失败，不伪装成功。
- 本包未包含网页重编译产物；网页及安卓如需同步按钮行为，需要使用同一修复源码重新构建发布。

## 验收

请用专门测试账号：无余额和未完成订单时注销成功；旧设备的 access/refresh token 和 API Key 不再能访问；相同手机号重新登录得到新ID且无旧内容/资产；有待结算资金时显示明确阻止原因。不要用有真实资金的账号进行破坏性验收。

已提供纯单元测试与 Flutter 回归测试；尚未在生产数据库执行真实注销。账务表和订单表只检查/保留，不做物理删除。
