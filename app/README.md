# OpenElf 开放精灵 · Flutter 版

OpenElf AI 应用商店的 Flutter 双端实现，复用 Web 版的 107 款 AI 工具数据与品牌设计风格。

## 功能

- **首页**：工具分类导航（六大分类）+ 搜索 + 统计数据 + 精选推荐 + 最新收录
- **工具列表页**：分类筛选、区域筛选、关键词搜索
- **工具详情页**：工具介绍、标签、分类信息、跳转官网/下载按钮
- **纯本地数据**：内置 tools.json，无需网络即可浏览
- **品牌设计**：精灵绿 #2E7A58 主色调，暖纸底风格，国内朱砂/海外靛青语义色

## 目录结构

```
openelf_flutter/
├── pubspec.yaml              # Flutter 依赖配置
├── analysis_options.yaml     # Dart 代码规范
├── assets/
│   └── data/
│       └── tools.json        # 107 款 AI 工具数据
└── lib/
    ├── main.dart             # 应用入口 + 路由 + 启动屏
    ├── theme.dart            # 品牌色与主题配置
    ├── models/
    │   └── tool.dart         # Tool 数据模型
    ├── data/
    │   └── tools_repository.dart  # 数据加载与查询
    └── pages/
        ├── home_page.dart        # 首页
        ├── tools_list_page.dart  # 工具列表页
        └── tool_detail_page.dart # 工具详情页
```

## 环境要求

- Flutter SDK 3.0+（建议 3.24.x 稳定版）
- Dart SDK 3.0+
- Android SDK（构建 APK 需要）
- Java 17+（Android 构建需要）

## 安装 Flutter

```bash
# Linux / macOS
git clone https://github.com/flutter/flutter.git -b stable --depth 1
export PATH="$PWD/flutter/bin:$PATH"
flutter doctor

# 或下载预编译包
# https://docs.flutter.dev/get-started/install
```

## 运行（调试）

```bash
cd openelf_flutter
flutter pub get
flutter run
```

## 构建 Web 版本

```bash
cd openelf_flutter
flutter build web --release
# 产物在 build/web/ 目录
# 部署到服务器：
#   cp -r build/web/* /var/www/openelf/app/
```

> Web 构建产物已部署在 https://openelfai.com/app/

## 构建 Android APK

```bash
cd openelf_flutter

# 确保 Android SDK 已安装且 ANDROID_HOME 已设置
flutter doctor --android-licenses
flutter build apk --release

# APK 产物：build/app/outputs/flutter-apk/app-release.apk
# 重命名并上传：
#   cp build/app/outputs/flutter-apk/app-release.apk openelf.apk
#   scp openelf.apk root@180.184.160.179:/var/www/openelf/app/openelf.apk
```

### Android 构建环境准备（Ubuntu/Debian）

```bash
# 1. 安装 Java
sudo apt update
sudo apt install -y openjdk-17-jdk

# 2. 下载 Android SDK
mkdir -p ~/android-sdk/cmdline-tools
cd ~/android-sdk/cmdline-tools
wget https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
unzip commandlinetools-linux-11076708_latest.zip
mv cmdline-tools latest

# 3. 设置环境变量（添加到 ~/.bashrc）
export ANDROID_HOME=$HOME/android-sdk
export PATH=$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH

# 4. 安装必要组件
sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"

# 5. 验证
flutter doctor
```

## 构建 iOS（需 macOS + Xcode）

```bash
cd openelf_flutter
flutter build ios --release
# 产物在 build/ios_archive/，需用 Xcode 签名后上传 App Store
```

## 重新部署 Web 预览

修改代码后重新构建并部署：

```bash
cd openelf_flutter
flutter build web --release

# 通过 SSH 部署到服务器
scp -r build/web/* root@180.184.160.179:/var/www/openelf/app/
```

## 数据更新

tools.json 更新后，需要重新构建并部署。数据与代码解耦：
1. 替换 `assets/data/tools.json`
2. 重新运行 `flutter build web --release`
3. 重新部署产物

## 品牌色

| 颜色 | 值 | 用途 |
|------|-----|------|
| 精灵绿 | #2E7A58 | 主色、按钮、强调 |
| 深绿 | #1F5740 | 悬停态、强调 |
| 浅绿 | #E8F3ED | 背景、分区 |
| 琥珀金 | #F5B841 | 行动按钮点缀 |
| 朱砂 | #B4432E | 国内工具标识 |
| 靛青 | #33598C | 海外工具标识 |

## 许可证

本项目为 OpenElf 开放精灵官方 Flutter 客户端源码。
