# Openelf Monorepo

本项目为 Openelf 的 monorepo，包含网站主站与 Flutter 双端应用。

## 目录结构

```
.
├── web/          # Next.js 主站源码（openelfai.com）
│   ├── app/      # Next.js App Router 页面
│   ├── components/
│   ├── data/     # 工具数据
│   ├── lib/      # 工具函数
│   ├── public/   # 静态资源
│   └── out/      # 静态导出产物（构建后）
└── app/          # Flutter 双端源码
    ├── lib/      # Dart 源码
    ├── assets/   # 静态资源
    └── build.sh  # 构建脚本
```

## 分支模型

| 分支 | 用途 | 部署目标 |
|------|------|----------|
| `main` | 生产稳定版 | openelfai.com 主站 |
| `dev`  | 日常开发、功能集成 | https://openelfai.com/app/ 预览窗口 |

## 构建命令

### Web（Next.js）

```bash
cd web/
npm install
npm run build   # 输出到 web/out/
```

### App（Flutter）

```bash
cd app/
flutter build apk        # Android
flutter build ios        # iOS（需 macOS + Xcode）
# 或使用项目自带的构建脚本
bash build.sh
```

## 标准协作流程

1. **本地开发**：从 `dev` 拉取最新代码，创建功能分支或直接在 `dev` 上修改
2. **提交代码**：`git add` → `git commit` → `git push origin dev`
3. **预览部署**：推送 `dev` 后，预览环境自动/手动部署到 `https://openelfai.com/app/`
4. **上线发布**：将 `dev` 合并到 `main`，主站 `openelfai.com` 同步更新

## 安全约定

- **禁止**将 API 密钥、令牌、服务器密码等敏感信息提交到仓库
- 本地配置使用 `.env` 文件（已加入 `.gitignore`）
- 构建产物（`node_modules`、`.next`、`build`、`.dart_tool`、`.apk` 等）已全局忽略
