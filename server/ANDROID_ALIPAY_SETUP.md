# 安卓钱包与支付宝占位接入（2026-10-23）

## 已实现与边界

- 安卓包名 `com.openelf.app`，只接支付宝，不包含微信支付按钮、接口或 SDK。
- 安卓钱包/消费 API 与 Apple 开关分开。购买 AI、能力包、打赏、注算力、创作算力均由服务端校验。
- 正式钱包按 OpenElf 用户共用 `Production`；iOS 支付数量仍为安卓同价 70%，Apple 接口/开关不变。
- 安卓档位：¥1/6/30/68/128/298，分别获得 10/60/300/680/1280/2980 钻石。
- 支付宝商户信息暂时空置，默认 `ALIPAY_ENABLED=false`：没有可点击付款档位，不会读取占位私钥或调用收银台。
- 安卓钱包可先单独启用，不依赖支付宝资料；没有合法充值记录时余额为零，不能使用旧本地模拟余额。
- SDK 的 9000/取消/失败只是界面提示，不能发钻。服务端验证通知签名并主动查询已验签的交易结果，再原子入账。
- 下单和充值到账均幂等，金额/档位/用户/APPID/PID/交易号在服务端核对。未决订单保留编号，可重启恢复或继续原单，不自动重新付费。
- 已确认全额退款按旧规则扣回钻石，不足记欠额，后续充值先补欠。部分退款或异常付款进入人工核对并暂时冻结消费；不是自动部分退款结算系统。
- 用户收益仍为待结算记录，不包含提现。创作内容仍是上游示例模板，不代表真实 AI 多模态生成已接入。

## 先更新服务端，只开钱包

先备份 MySQL。上传 `OpenElf-android-alipay-update-20261023.tar.gz` 到服务器 `/root`，执行：

```bash
android_update_dir=$(mktemp -d /root/openelf-android-update-XXXXXXXX)
tar -xzf /root/OpenElf-android-alipay-update-20261023.tar.gz -C "$android_update_dir"
bash "$android_update_dir/deploy/android/install.sh"
```

增量脚本适用于 `/opt/openelf-api`；先校验已有源码和测试，后备份、替换模块、重启并检查健康。
仅补充共享钱包基础与 Android 支付模块，不覆盖短信/验证码模块，不改 env，也不安装/升级 npm 依赖。
共享后端会升级兼容的 Apple 钱包模块以支持一致记账，但不切换苹果支付环境，不需要本轮重新构建 iOS。
旧的本地示例余额/AI 不作为付费资产导入；旧 Apple 钱包和订单保留，新增表不清空业务数据。
失败恢复原入口和模块，新建表（若有）保留，备份目录为 `/opt/openelf-android-backup-*`。

用 `sudo nano /etc/openelf-api.env` **只补充/更新**下面三项，不替换整个文件，不动原短信/数据库/Apple 项：

```text
ANDROID_COMMERCE_ENABLED=true
ALIPAY_ENABLED=false
ALIPAY_SANDBOX=false
```

```bash
sudo chmod 600 /etc/openelf-api.env
sudo systemctl restart openelf-api
sudo systemctl is-active openelf-api
curl -fSs http://127.0.0.1:8787/api/v1/health
```

安装测试 APK 后真实短信登录，打开钱包。应显示“仅支持支付宝”和“支付宝充值配置中”，
刷新到服务端资产；不能免费装未购买的模块，也不能用本地方法增加钻石。
Nginx 需把 `/api/v1/android/` 转发到现有 `127.0.0.1:8787`，不能返回前端 HTML。
当前没有可连接手机，本轮没有实际发短信、操作生产数据库或唤起真实支付宝。

## 商户资料稍后再配置

模板为 `.env.alipay.example`，空值是故意占位，不要把“占位”文字填进真实密钥。
后续需要：已开通 APP 支付的 APPID、收款商户 PID（2088 开头）、公钥模式或证书模式、
服务器可读的应用私钥 PEM，以及支付宝公钥 PEM，或三份官方证书（应用公钥证书、支付宝公钥证书、支付宝根证书）。
私钥只存服务器 `/etc/openelf/keys/`；目录限制访问，文件通常 root:openelf、640，运行用户 `openelf` 可读。
不要发到聊天，不放 Flutter、APK、Git 或部署包。支付宝应用私钥不是 Apple `.p8`，不可混用。
配置使用官方 RSA2、2048 位及以上 RSA，公钥/证书模式只能选一种。

启用支付前先安装已固定版本的官方服务端 SDK：

```bash
cd /opt/openelf-api
npm install alipay-sdk@4.14.0 --save-exact --ignore-scripts --no-audit --no-fund
```

此命令仅在后续商户接入阶段使用。若现有服务器没有锁定依赖，先备份 package.json、package-lock.json
和依赖，再核对 npm 变化，避免升级无关依赖。占位阶段不安装此 SDK 也能开钱包。

通知地址固定配置为：`https://openelfai.com/api/v1/android/alipay/notify`。
必须外网 HTTPS 可达、正确转发 POST 表单。处理成功返回纯文本 `success`；无效签名或重复字段拒绝。
付款下单时间按北京时间生成，不依赖服务器时区。订单有效期 15 分钟；取消收银台不等于交易关闭。
未创建的订单须过期并经过查询缓冲才关闭，不能把网络故障当作未支付。

## 沙箱与正式收款

沙箱后端设置 `ALIPAY_SANDBOX=true`，并使用支付宝沙箱 APPID/商户/密钥；
对应 APK 必须用 `--dart-define=OPENELF_ANDROID_ALIPAY_SANDBOX=true` 构建。
普通 APK 只接受 Production，模式不匹配关闭入口。沙箱余额存独立测试账本，不转成正式余额。
同一后端 Android 通道一次只选择一种环境，切换需重启；不会改 Apple 的 Sandbox 配置。

商户资料完整、验签成功、退款对账流程完成并经过真机沙箱后，才可人工设置 `ALIPAY_ENABLED=true`。
未确认前保持 false。不能用模拟测试、SDK 加载成功或健康接口通过代替真实付款和到账验证。

## 上线前未完成项

1. 真实 MySQL 升级、并发扣款、备份恢复演练；本地领域/HTTP 测试使用内存适配器。
2. 真机 SDK 唤起、取消、断网/杀进程恢复、重复回调、双账号、全额退款及消费后欠额测试。
3. 部分退款/异常订单人工核对工具和告警闭环。记录在 `payment_objects` 的 `alipay_review/needs_review`；
   不要手动 SQL 猜测改余额。当前只做冻结保护，不宣称部分退款已自动结算，完成运营对账流程前不开放真实收费。
4. 正式 Android 签名：release 已改为读取本机 android/key.properties，不再回退到 Debug 证书。私有 JKS 与密码文件不提交 Git；绑定支付宝应用时须与实际 APK 的证书匹配。
5. 隐私政策展示和支付宝 SDK 披露、真正的服务端账号注销。这两项仍是原项目占位，不因增加支付宝而自动完成。
6. Google Play 等发行渠道如需分发，另行核对该渠道的支付要求；本轮没有接入 Google Play Billing 或微信。

## 开发验证

Flutter 使用 `flutter test --dart-define=OPENELF_IOS_IAP_TEST=true`，覆盖两个平台和未登录启动。
Node.js 24 可执行 `node --test --test-isolation=none test/apple_iap.test.js test/apple_deploy.test.js test/apple_http.test.js test/alipay.test.js test/alipay_gateway.test.js test/android_deploy.test.js test/captcha.test.js test/captcha_deploy.test.js`。
服务器 Node.js 20 使用 `npm run test:payments`（需测试依赖）。SDK RSA2 测试仅生成临时内存密钥，不使用商户密钥或发起网络付款。

官方参考：[支付宝 Node.js SDK](https://github.com/alipay/alipay-sdk-nodejs-all)、
[APP 支付 Android 集成流程](https://developer.alibaba.com/docs/doc.htm?articleId=105296&docType=1&treeId=193)。
