# OpenElf Buddy 应用入驻指南

本文档指导如何将 OpenElf 包装为 WorkBuddy Buddy 应用并完成入驻。

## 目录结构

```
buddy-app/
├── config.md              # 完整配置清单（所有文案可直接粘贴）
├── buddy-static.zip       # 网页资源包（自定义菜单用，直接上传）
├── icons/                 # 图标资产
│   ├── app-icon.png       # 应用头像（256×256）
│   ├── guide-character.svg    # 引导卡片图标：虚拟形象
│   ├── guide-generator.svg    # 引导卡片图标：批量生成
│   ├── guide-video.svg        # 引导卡片图标：视频剪辑
│   └── guide-influencer.svg   # 引导卡片图标：选题策划
└── web-resource/          # 网页资源包源码（修改后重新打包）
    ├── manifest.json
    ├── index.html
    └── assets/
        ├── style.css
        ├── app.js
        └── logo.svg
```

## 入驻流程

### 1. 创建应用（模块 1）

访问 [WorkBuddy 开放平台](https://open.workbuddy.cn) → Buddy 应用 → 创建应用。

按 `config.md` 模块 1 填写：
- 应用名称：OpenElf 网红创作工作台
- 应用简介、头像（`icons/app-icon.png`）
- 授权回调 URL、可信 Origin

创建后保存 **Client ID** 和 **Client Secret**（仅展示一次）。

### 2. 引导配置（模块 2）

按 `config.md` 模块 2 配置 4 条引导卡片，上传对应 SVG 图标。

### 3. 首页配置（模块 3）

- **首页标题（Slogan）**：你的 AI 网红创作工作台
- **场景胶囊**：按 `config.md` 配置 6 个场景，绑定对应专家/技能
- **工作模式**：配置 3 个模式（网红孵化/内容创作/形象设计），粘贴对应 System Prompt
- **自定义菜单**：上传 `buddy-static.zip`，菜单标题填「OpenElf 工作台 / OpenElf Workspace」

### 4. 市场配置（模块 4）

从已上架的资产中选择：
- **专家**：AI 角色设计师、AI 网红经纪人
- **技能**：形象工坊 OpenElf、千人千面生成器 OpenElf、爆款二次剪辑 OpenElf
- **连接器**：openelf-character、openelf-generator、openelf-video

### 5. 其他配置（模块 5）

按 `config.md` 模块 5 填写绑定授权文案、输入框占位符、模型排序。

### 6. 预览调试（模块 6）

通过预览链接下载 WorkBuddy 端，打开预览态验证：
- 引导卡片展示正常
- 场景胶囊点击后能唤起对应专家/技能
- 工作模式切换后 System Prompt 生效
- 自定义菜单「OpenElf 工作台」页面正常加载，点击卡片能唤起 AI 对话

### 7. 提交审核

确认无误后提交审核，等待平台审核通过即发布上线。

### 8. 企业单管理（发布后）

应用上线后，可在「企业单管理」创建企业单：
1. 填写企业名称，生成授权链接
2. 将链接发给企业管理员
3. 管理员确认后，应用出现在企业管理后台
4. 管理员分配给员工使用

## 网页资源包修改

如需修改工作台页面：
1. 编辑 `web-resource/` 下的文件
2. 重新打包：
   ```powershell
   Compress-Archive -Path "web-resource\*" -DestinationPath "buddy-static.zip" -Force
   ```
3. 在开放平台重新上传

## 前置依赖

以下资产需已在 WorkBuddy 平台上架（如未上架需先提交）：
- 连接器：openelf-character、openelf-generator、openelf-video
- 专家：designer-expert、influencer-manager
- 技能：image-studio-skill、mass-character-generator、smart-cut

详见 `openelfai/workbuddy/README.md`。
