# build15 配套内容安全补丁（2026-10-28）

## v2 安装兼容修复

2026-10-28 根据用户只读检查返回的生产代码片段，增加独立
`realname_ocr` 适配层版本支持。只给服务函数增加 `payoutQuery` 参数、
给服务返回对象增加原单查证方法，不替换实名函数或模块导出。
找不到模块式账号注销注册行时，核对 `authenticate` 函数声明后，
在唯一的 `ensureUser` 声明前注册内容安全模块，不自动创建注销路由。
现有注销是否清理新增社区数据仍须另行核验，不能视作已验证。
生产完整源码未取回，本地7项安装器测试包含按已知片段构造的模拟版本，
不是生产端预检通过证明；未知上下文及歧义继续停止。App IPA 无变化，
不需仅为此次安装器兼容修复重打包。

## 范围与限制

- 服务端持久化举报、回执、处理结果；同账号重复提交编号幂等。
- 按用户保存用户/AI屏蔽名单，客户端立即隐藏，服务端过滤信息流和评论。
- 新AI公开资料、帖子、评论（包含自动运营）先进入人工审核；只公开已批准内容。
- **旧内容不自动放行**。待审核内容不会出现在世界/视频流；安装后可能暂时为空。
- 账号使用者仍可管理自己的AI；内容限制不改变钻石及已有收益数额。
- 按用户最新确认，AI/技能书是站内资源，不接链上NFT或外部钱包；免费转赠
  仅允许注册手机号/站内账号ID，服务端拒绝寄售、附价转赠、钻石转现和余额转让。
- 历史0x字段只作兼容，客户端展示账号/AI的真实站内ID，不是钱包、私钥或资产证明。
- 创作者打赏收益独立记账，转赠AI不转移历史收益、余额或收款账号。
- 沙盒收益禁止真实出款；正式提现批准需后台显式确认已核对实名收款主体。
- 处理中的转账/网络超时不会解冻或自动重付，原编号查单且验签、金额与订单匹配
  后才结算。新增 /internal/withdrawals/:id/reconcile 只查原出款编号，不创建新转账。
- 举报下架、内容通过/拒绝均写审计记录。审核入口必须持有独立32位以上令牌。
- 管理员查看报告时会接触用户提交的证据；不要把队列全文或环境备份发到聊天。
- 静态词表不是完整审核服务。必须安排人工审核、查看媒体本身及授权，并落实
  社区规范中的24小时响应目标。本补丁不代表已经安排人员或取得合规批准。
- 队列每次返回100条；旧内容扫描当前信息流范围内最近500条各类记录。
- 无批量自动通过，无付费或实名审核旁路；没有自动提交Apple审核或发起真实付款。

## 安装

压缩包包含安装器、增量资源补丁、安全/资源模块、审核工具和本说明；上传服务器后先
校验压缩包SHA256，解压到 mktemp 新目录。先预检，再安装：

```bash
node --env-file=/etc/openelf-api.env /实际解压目录/install.cjs --check
node --env-file=/etc/openelf-api.env /实际解压目录/install.cjs --install
```

安装器只按唯一匹配的源码上下文增量改现有 app.js、commerce.js、
alipay_gateway.js 与 account_deletion.js，新增 community.js/resource_policy.js；
不以仓库版本覆盖生产整文件。未知上下文会在预检时停止，不能强行绕过；
尤其需保留线上独立实名与跨域补丁。生产源码存在多版本，本机没有服务器
免密访问权限，因此尚未在生产预检、部署或联调；需用户执行 --check 后确认。

若环境中尚无 COMMUNITY_REVIEW_TOKEN，安装器会生成随机令牌并只追加这一项，
不会打印令牌。现有令牌不足32位或源码形态不符合预期会停止。先在
/opt/openelf-community-backup-* 中备份原代码和环境（目录700/文件600），
短暂重启 openelf-api，验证健康、公开接口认证、管理权限。失败自动恢复。
备份含原有敏感配置，请勿发给他人或提交仓库。部署不会发短信、登录账号、
自动审批内容、迁移余额或发起付款。新业务规则只影响后续请求。
未被引用的新模块在回滚后保留，便于排查。

## 人工审核（服务器终端）

将工具复制至 /root/openelf-community-review.cjs 后运行。令牌从环境文件加载，
不要复制出来，也不要填在 App 中。

```bash
# 查看待审公开资料/帖子/评论（对旧内容建立待审队列）
node --env-file=/etc/openelf-api.env /root/openelf-community-review.cjs content Production

# 查看待处理举报
node --env-file=/etc/openelf-api.env /root/openelf-community-review.cjs reports Production

# 核对实际文字、图片、视频、音频、授权后，逐条批准；先批准AI公开资料
node --env-file=/etc/openelf-api.env /root/openelf-community-review.cjs review-content Production 'elf:实际AI编号' approve '已核对公开资料及形象授权'
node --env-file=/etc/openelf-api.env /root/openelf-community-review.cjs review-content Production 'post:实际帖子编号' approve '已核对文字和媒体，无违规内容'

# 拒绝内容 / 确认举报并下架（使用返回的真实ID，不要直接照抄占位符）
node --env-file=/etc/openelf-api.env /root/openelf-community-review.cjs review-content Production 'post:实际帖子编号' hide '具体违规理由'
node --env-file=/etc/openelf-api.env /root/openelf-community-review.cjs review-report Production 'cr_实际举报编号' hide '核实违规，已处理'

# 举报不成立或反馈处理结束，写清楚给用户看的解释
node --env-file=/etc/openelf-api.env /root/openelf-community-review.cjs review-report Production 'cr_实际举报编号' dismiss '核实情况及处理解释'
```

Apple 内购沙盒使用 Sandbox 环境的内容、举报、屏蔽及同意记录；需分别处理，
不得把 Sandbox 资金或内容直接迁移到 Production。`user`/`elf` 举报确认违规
会限制其公开内容及后续发布，不冻结资金、不删除资产。该版本不提供一键解除
运营限制；申诉需人工复核后进行有审计的后续修复，不能用“解除个人屏蔽”替代。

## 验收

1. build15设置→内容安全与反馈：同意规范并保存；无网提交不得显示成功。
2. 已审核内容举报取得回执，换设备/重启仍能查看本人处理记录；不能查看别人记录。
3. 屏蔽AI或作者后世界、视频、评论立即隐藏，换设备保持，设置中可解除。
4. 发布内容待审不公开；审核通过后刷新可见；下架后刷新不可见。
5. 管理队列未授权拒绝；确认举报、下架均留有审计。
6. 注销时新增个人举报/屏蔽/同意记录一并清理；财务记录仍沿用原来规则。
7. 分享、注销、实名需在iPhone上实测；本地模拟测试不等于真机联调通过。

正式上架前必须配置审核人员、检查邮箱可用、同步官网说明与App隐私申报。
站外充值提示按要求保持，仍有审核风险，未承诺能过审。普通站内资源方案
不等于已完成资金合规；正式出款还需商户签约、收款主体核验、税务处理、
退款与反欺诈流程，不能仅凭代码或把收益称为“服务费”认定合法/可过审。
本App用户协议改为2026-10-28站内资源版本，官网协议及商店隐私申报仍需同步。

转账响应字段依据支付宝官方SDK模型：
https://github.com/alipay/alipay-sdk-php-all/blob/master/v3/src/Model/AlipayFundTransCommonQueryResponseModel.php
Apple规则参考：https://developer.apple.com/app-store/review/guidelines/
