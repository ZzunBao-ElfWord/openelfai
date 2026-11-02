# WorkBuddy 上架项目

OpenElf 面向 WorkBuddy 开放平台交付的专家与技能包。每个包独立版本、独立打包、独立回滚；审核前先在本地完成自查。

> 这里只产出提交给 WorkBuddy 的包，与 OpenElf 自有开发者平台（openelfai.com/console）无关。

## 首批包

| 包 | 类型 | 版本 | 依赖连接器 | 说明 |
|---|---|---|---|---|
| `designer-expert` | 专家 | 1.1.0 | `openelf-character` | AI 角色设计师：设计简报、逐版收窄改动、定稿检查与失败恢复 |
| `image-studio-skill` | 技能 | 1.1.0 | `openelf-character` | 形象工坊：四条场景配方、成本确认与验收清单 |
| `influencer-manager` | 专家 | 1.1.0 | 无 | AI 网红经纪人：四维选题打分、文案骨架、复盘单变量验证 |
| `smart-cut` | 技能 | 1.1.0 | `openelf-video` | 爆款二次剪辑：处理上限口径、场景配方、气口规则与验收清单 |
| `mass-character-generator` | 技能 | 1.0.0 | `openelf-generator` | 千人千面生成器：图层权重、预览、批量生成（≤100/次）、打包下载与作品收单 |

连接器 `openelf-character` 已在 WorkBuddy 上架。连接器 `openelf-video` 的源码在 `integrations/workbuddy/connector-video/`，服务端端点为 `/mcp/video`，转写走阿里云百炼异步文件转写（`ASR_PROVIDER=dashscope`），需与技能一起提交审核。

连接器 `openelf-generator` 的源码在 `integrations/workbuddy/connector-generator/`，服务端端点为 `/mcp/generator`，渲染走服务端自研 PNG 画布，需与 `mass-character-generator` 技能同批提交审核。

## 目录结构

```
workbuddy/
  README.md
  RELEASES.md                 # 版本、审核状态与回滚记录
  packages/
    designer-expert/
      .codebuddy-plugin/plugin.json  # 专家配置（平台要求的位置）
      agents/designer.md             # 人设正文（含 YAML frontmatter）
      avatars/expert.png             # 头像
      README.md                      # 包说明
      package.json                   # 本地元信息（名称/版本/依赖）
    image-studio-skill/
      SKILL.md                # 技能正文（含 frontmatter）
      package.json            # 本地元信息（名称/版本/依赖）
  scripts/
    validate.mjs              # 规范自查，产出 dist/manifest.json
    pack.mjs                  # 校验通过后打包 dist/<name>-<version>.zip
    preview.mjs               # 生成 preview/index.html 静态预览
  dist/                       # 打包与清单产物（不入库）
  preview/                    # 预览页产物（不入库）
```

## 包规范

### 专家包

配置文件必须放在包内 `.codebuddy-plugin/plugin.json`（平台按此路径解析），字段以平台文档（https://open.workbuddy.cn/docs/expert）为准：

- 基础：`name`、`version`、`description`（英文）、`author{name,email}`、`agents[]`、`agentName`、`expertType`（`agent`）
- 展示：`displayName{zh,en}`、`profession{zh,en}`、`displayDescription{zh,en}`（中文 40–50 字）、`avatar`、`categoryId`、`plugin`（与 `name` 一致）
- 引导：`defaultInitPrompt{zh,en}`（必须等于 `quickPrompts[0]`）、`quickPrompts`（固定 3 条双语）、`tags`（固定 3 个双语）

`agents/*.md` 头部需 YAML frontmatter：`name`（与文件名一致）、`description`（英文）、`displayName{en,zh}`、`profession{en,zh}`；可选 `maxTurns`。

### 技能包

`SKILL.md` 必须有 YAML frontmatter。按平台文档（https://open.workbuddy.cn/docs/skill）以下字段必填：

`name`、`display_name`（中文展示名）、`display_name_en`（英文展示名）、`description`、`description_zh`（中文简介）、`description_en`（英文简介）、`version`、`author`。

可选：`examples_zh` / `examples_en`（详情页「试试这样用」）、`allowed-tools`、`x-openelf`（`requires_connector`、`min_plan`）。

命名规范：所有对外展示的技能名一律以应用名结尾，即 `display_name` 与 `display_name_en` 必须以 `OpenElf` 结尾（例：`形象工坊 OpenElf` / `AI Image Studio OpenElf`），`validate.mjs` 会强制校验。连接器的 `displayName` 同样遵循此规则。

- 技能名与所在目录名一致；
- 正文必须包含「何时使用」「不适用」「调用顺序」三节；
- 外部连接器在 `package.json` 的 `dependencies.connectors` 声明，不在包内重复托管。

### 全局拦截

- 对外文案禁止出现：NFT、区块链、链上、身份证、铸造；确权相关引导统一指向「OpenElf 平台」完成。
- 禁止出现真实密钥（形如 `api_key=`、`token=` 后接 12 位以上字符）。
- 图片只允许 png/jpg，单文件 ≤ 2MB。

## 本地流程

```powershell
# 1) 规范自查（同时产出 dist/manifest.json 供后台查看）
node scripts/validate.mjs

# 2) 打包（会再次校验，失败不产出 zip）
node scripts/pack.mjs designer-expert
node scripts/pack.mjs image-studio-skill

# 3) 生成静态预览（preview/index.html，可直接浏览器打开）
node scripts/preview.mjs
```

## 发布流程

1. 修改子包源码，同步更新 `plugin.json` / `SKILL.md` / `package.json` 中的版本号；
2. `node scripts/validate.mjs`；
3. `node scripts/pack.mjs <package>`；
4. 在 WorkBuddy 开放平台手工上传 zip 提交审核（平台未提供公开上传 API）；
5. 在 `RELEASES.md` 记录版本、提交时间、审核结果与回滚说明；
6. 把整个 `workbuddy/` 目录同步到后台运行目录（默认 `/opt/openelf-admin/workbuddy`），后台「WorkBuddy 上架」页即可看到包清单与校验结果。

## 常见驳回原因

| 现象 | 处理 |
|---|---|
| 头像缺失或格式不符 | 补 png/jpg，单文件 ≤ 2MB，路径与 `avatar` 字段一致 |
| 专家解析失败：找不到配置 | plugin.json 必须位于 `.codebuddy-plugin/`，`agents[]` 指向真实文件 |
| 专家解析失败：展示字段不全 | 补齐 `displayName`/`profession`/`displayDescription`/`defaultInitPrompt` 的 `{zh,en}`，`tags` 与 `quickPrompts` 各 3 条 |
| 描述含禁用词 | 去掉 NFT/区块链/链上/身份证/铸造等表述，改为「AI 形象」「OpenElf 平台」 |
| 技能缺章节 | 补齐「何时使用」「不适用」「调用顺序」 |
| 技能解析失败：缺少展示名/描述 | frontmatter 补齐 `display_name`、`display_name_en`、`description_zh`、`description_en`、`author` |
| 依赖连接器未声明 | 在 `package.json` 的 `dependencies.connectors` 补齐 |
| 版本号未递增 | 按 `x.y.z` 递增，并同步三处版本字段 |
