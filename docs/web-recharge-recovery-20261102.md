# 网页充值回退调查及恢复包

线上https://web.openelfai.com/main.dart.js于2026-11-02只读核对：Last-Modified为2026-10-30 06:21:52 GMT，SHA256为084126d6884536e31338e8ab17581c74cb7739f9da63247a1586e0efbec795a0。解码JS转义后，有“暂无可用充值渠道”等兜底文案，但无网页钻石充值面板及/api/v1/web/alipay、/api/v1/web/wallet。

此前有充值功能的2026-10-29布局包主包SHA256为fbdb92ba7230cb34627246c72fc3f67064a3734b3f09742b99fea5f731991ce8，含对应接口，和线上不一致。可认定网页构建功能回退，不能仅凭此认定具体覆盖操作人或命令。此次安卓打包未部署Web。

web.openelfai.com下/api返回HTML首页；正确API域名为https://openelfai.com，原有网页包也使用该域名。正式API两类充值产品路由未登录均返回401 JSON，Origin为网页域名时允许跨域。验证码公开配置为enabled=true、mode=enforce。本次不调整服务端、支付配置、密钥或数据库；匿名响应不作为真实支付验收。

使用当前集成源码生成独立Web release，版本仍1.0.4 Build22，保留钻石充值、API余额充值、订单/账号隔离、验证码桥接及视频CDN映射。32项支付相关Flutter测试通过。Bash/Node脚本语法通过，45项包内文件哈希通过。打包与安装新增实际编译JS功能标记检查，拒绝不含充值、API域名错误或缺少验证码入口的构建。bootstrap和主包带发布查询标识，不清除localStorage。

安装脚本只切换/var/www/openelf-webapp，并完整备份原目录；5项公网文件哈希核对失败自动回滚。预检要求真实API路由返回401 JSON且验证码强制，失败不修改开关以绕过。不重启API、不发短信、不创建订单或付款。尚未执行真实服务器部署或回滚故障注入。

包：OpenElf-Web-Recharge-Recovery-20261102.tar.gz，14,649,790字节；SHA256 7c35610c89aaf1ba6489973b1686e6704cc46ccdd5c0657bb6f1ba928d0f2f44。恢复主包SHA256 fd552544fa10e202aa14e882b3530f91c320545bc4cc84e898609a19a8e7981c。

SSH BatchMode仍为Permission denied，因此由用户上传执行安装。后续用户已提供预检和备份输出；公网openelf-release.json与main.dart.js均已核对为恢复版且哈希匹配，网页文件已切换，不再是待部署状态。仍须核对安装最终输出与已登录页面的产品、余额、扫码交接；真实付款尚未验收。
