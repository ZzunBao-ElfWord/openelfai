# Mac 导出可上传 Transporter 的 IPA

本打包文件包含已同步 GitHub 的 Flutter 源码、阿里云图形验证和支付接入。它是构建源码，不是已经签名的 IPA。

## 首次准备

1. 在 Mac 安装完整的 Xcode 26 或更新版本（包含 iOS 26 或更新 SDK），打开 Xcode 完成首次组件安装。
2. 安装 Flutter（推荐与本项目验证版本一致：3.47.6）和 CocoaPods，确保终端能运行 `flutter`、`pod`、`xcodebuild`。
3. 在 Xcode 的 Settings > Accounts 登录具有本应用签名权限的 Apple Developer 账号。分发证书和私钥只保留在 Mac 钥匙串中。
4. 将打包文件传到 Mac，解压后在 `app` 目录打开终端，执行：

```bash
bash scripts/build_appstore_ipa.sh --prepare
```

脚本会准备 Flutter iOS 配置并打开 `Runner.xcworkspace`。在 Xcode 左侧选择 Runner 工程，再选择 **TARGETS > Runner > Signing & Capabilities**：

- 选择自己的开发团队（Team），勾选 Automatically manage signing。
- 确认 Bundle Identifier 为 `com.ai.openelf`，对应 App Store Connect 的 OpenElf 应用（Apple ID `6761752635`）。Android 的包名为 `com.openelf.app`，不用于此 iOS 应用。
- 如 Xcode 提示创建/下载签名资源，按账号权限完成，直到签名错误消失。上传需要 App Store 分发签名，导出时由 Xcode 自动选择/生成对应描述文件。

## 构建与导出

在 App Store Connect 确认版本号及已上传构建号。下面的 `2` 只是示例，必须换成未使用的构建号：

```bash
bash scripts/build_appstore_ipa.sh --build-name 1.0.4 --build-number 6
```

本次版本号按用户要求设为 `1.0.4`，也可以直接执行下面命令，按提示输入新构建号：

```bash
bash scripts/build_appstore_ipa.sh
```

脚本以 Release 模式构建，通过 `app-store-connect` 方式导出到 `build/ios/ipa/`。脚本不会自动上传应用，不强制使用沙盒钱包，也不携带服务端密钥。

导出后脚本检查 IPA 的 Bundle ID、版本号、构建号、SDK、签名、描述文件类型和图形验证资源，成功后打开输出文件夹。

将生成的 `.ipa` 拖入 Transporter，登录有上传权限的 App Store Connect 账号，先验证再交付。Apple 服务端处理通过后，才能在 App Store Connect 选择该构建。仅通过本地检查不能保证 Apple 一定接受。

## 当前限制

此包在 Windows 上完成了 Dart/服务端测试和 Android 编译验证；尚未在 Mac 上执行 Swift 编译、签名或真机测试。Mac 构建中若出现错误，请提供错误信息（不要发送密钥、证书私钥或账号密码），再据实际错误修复。

服务器支付宝/Apple 商户与支付通道是否启用，由服务器配置独立决定。生成 IPA 不代表真实支付已上线或通过 Apple 审核。
