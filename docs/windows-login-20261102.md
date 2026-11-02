# Windows 桌面短信登录修复

原实现允许桌面游客浏览，但 _verifyCaptcha 主动拒绝所有桌面短信登录。Windows 现使用 webview_windows 0.4.0/WebView2 承载真实供应商 H5 验证，不移除服务端校验。

验证页、脚本和现有同哈希供应商 SDK 打包为本地 Flutter 资源；仅在此专用 WebView 中将 web.openelfai.com 虚拟主机映射到应用新建的临时资源目录，加载 desktop.html。不会修改 DNS、hosts、OS 安全策略、真实网站目录或 Edge 用户资料。验证只读取公开配置，要求 enabled=true、mode=enforce、platform=web；页面没有手机号、账号令牌或发短信接口。

每次验证使用安全随机64位十六进制nonce（256 bit），放在片段而非远程请求中。原生侧校验当前 HTTPS 页面、端口、路径、nonce、版本、消息类型和四个有界字符串字段；只将成功证明交回既有 send-code 流程，由后端验证。取消/错误/超时不发送短信。新窗口拒绝新增权限及弹出窗口，异常导航停止。缺少WebView2显示明确提示，不自动安装组件或弱化安全措施。

范围只限Windows；Android/iOS继续使用原生验证码，Web继续使用已有桥接，macOS/Linux仍明确不支持，不伪造H5证明。未修改导航/对话布局、支付、链功能、服务端配置或生产网站。

验证：完整Flutter测试180通过、1跳过；新增Windows证明解析4项及验证页Node模拟3项通过，移动登录品牌4项通过。Windows release独立副本编译成功。构建工具提示临时目录可能影响增量构建，本次是全新独立构建，非编译错误。

测试目录：Z:/openelf/打包文件夹/08_Windows桌面测试/OpenElf-1.0.4-build22-desktop-login-test-20261102

openelf.exe SHA256=b828cf58d903cdcccd0ccfda7831ffc614d3734a4f4803717985b8d17fd645b9

保留旧运行程序与全部APK/IPA。新测试版启动后只读观察到世界页及已恢复账号界面；这不能替代用户实际完成图形验证、收到短信及服务端登录验收。自动测试未完成真实验证码、发送短信或支付。真实H5验证在桌面WebView2中的供应商兼容性仍需用户手动验收。
