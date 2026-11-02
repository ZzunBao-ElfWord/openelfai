# WorkBuddy 上架项目设计（技能 + 专家）

日期：2026-10-30
状态：已确认（方案 B：分包）

## 背景与目标

OpenElf 需要把面向 WorkBuddy 开放平台的能力（专家 / 技能）从「一次性交付的资源包」升级为可长期迭代的上架项目：每个上架单元独立版本、独立打包、独立回滚，审核前可本地自查。

与 OpenElf 自有开发者平台（openelfai.com/console）无关：本项目只产出提交给 WorkBuddy 的包，不在 OpenElf 市场上架。

首批内容：

1. `designer-expert`：AI 角色设计师专家（人设 + 开场白 + 快捷提示）
2. `image-studio-skill`：形象工坊技能（配件目录 → 预览 → 角色卡 → 生成形象），依赖已发布的 `openelf-character` 连接器

## 目录结构

```
workbuddy/
  README.md                  # 定位、上架流程、字段规范、驳回原因
  RELEASES.md                # 版本、审核状态、回滚记录
  packages/
    designer-expert/
      plugin.json            # 专家上架元信息
      agents/designer.md     # 人设正文
      avatars/expert.png     # 头像
      package.json           # 本地元信息（名称 / 版本 / 依赖）
    image-studio-skill/
      SKILL.md               # 技能正文（含 frontmatter）
      package.json           # 本地元信息（名称 / 版本 / 依赖）
  scripts/
    validate.mjs
    pack.mjs
    preview.mjs
  dist/                      # 打包产物，gitignore
  preview/                   # 预览页产物，gitignore
```

## 包规范

### 专家包

`plugin.json` 必填字段：`name`、`displayName`、`expertType`、`categoryId`、`version`、`description`、`avatar`、`defaultInitPrompt`、`quickPrompts`（1–4 条）。
`avatar` 必须指向包内实际存在的文件；`description` 不写敏感词；`version` 为 `x.y.z`。

### 技能包

`SKILL.md` 必须有 YAML frontmatter：`name`、`description`、`version`；可带 `x-openelf`（`requires_connector`、`min_plan`）。
技能名与所在目录名一致；正文必须包含「何时使用」「不适用」「调用顺序」三节。
依赖的外部连接器在 `package.json` 的 `dependencies.connectors` 中声明，不在本包内重复托管连接器实现。

### 全局拦截（所有包）

- 对外文案禁止出现：NFT、区块链、链上、身份证、铸造；确权相关引导统一指向「OpenElf 平台」完成。
- 禁止出现真实密钥（形如 `api_key=...`、`token=...` 且后接 12 位以上字符）。
- 图片只允许 png/jpg，单文件 ≤ 2MB。

## 脚本

- `validate.mjs`：读取 `packages/*`，按上述规范逐项校验，输出每个包的问题清单与退出码；任一包失败则整体非零退出。
- `pack.mjs`：校验通过后，把单个包打成 `dist/<package>-<version>.zip`；打包前必须再次执行校验，避免带病上传。
- `preview.mjs`：生成 `preview/index.html`：左侧专家卡片（头像、名称、快捷提示），右侧技能流程（何时使用 / 不适用 / 调用顺序），纯静态、不联网。

脚本使用 Node 20，无第三方依赖；zip 走系统 `Compress-Archive`。

## 发布流程

1. 修改对应子包源码，更新 `package.json` / `plugin.json` / `SKILL.md` 中的版本号
2. `node scripts/validate.mjs`
3. `node scripts/pack.mjs <package>`
4. 手工上传 WorkBuddy 开放平台审核
5. 在 `RELEASES.md` 记录：版本、提交时间、审核结果、驳回原因/回滚说明

## 测试

- `validate.mjs` 对两个首批包全部通过；故意删字段、加敏感词、写假密钥时报错且退出码非零
- `pack.mjs` 产出的 zip 解压后目录结构与源目录一致
- `preview.mjs` 产物在浏览器打开可见两个包的内容，无外部请求

## 不在本次范围

- 连接器包本身（沿用已发布的 `openelf-character`）
- 往 OpenElf 自有开发者平台发布
- 自动调用 WorkBuddy 上传接口（平台未提供公开上传 API 前保持手工上传）
