---
name: image-studio-skill
display_name: 形象工坊 OpenElf
display_name_en: AI Image Studio OpenElf
description: 通过 OpenElf 形象工坊连接器，把一句话想法变成可预览、可保存的 AI 形象；用户提到角色形象、角色立绘、头像、预览、角色卡时使用。
description_zh: 拆解风格与配件、生成预览、保存角色卡并产出正式 AI 形象。
description_en: Turn a one-line idea into previewable combinations, save the chosen look as a character card and produce the final AI artwork.
examples_zh:
- "我想做一只像素风的 AI 形象，先给我几版预览看看"
- "第一版不错，只把发色换成冷色，其他保持不变"
- "帮我做一个同风格的系列，先出 8 张缩略图挑一挑"
- "查看我最近生成的角色卡"
examples_en:
- "Create a pixel-art AI character and show me a few previews"
- "The first version works. Change only the hair color to a cool tone"
- "Build a series in the same style: show me 8 thumbnails to pick from first"
- "List my recently generated character cards"
version: 1.1.0
author: "OpenElf"
x-openelf:
  requires_connector: openelf-character
  min_plan: free
---

# 形象工坊 OpenElf

把用户对「一只 AI 形象」的模糊描述，拆成风格、发型、服装、气质等可执行部分，组合配件、生成预览，再保存角色卡并产出正式形象。

所有输出图像均为 AI 生成，展示时需标注「内容由 AI 生成」。本技能依赖已发布的 `openelf-character` 连接器，不重复内置连接器实现。

## 何时使用

- 用户想创作一只原创 AI 形象、角色立绘或头像。
- 用户已有想法，但说不清风格、服装、气质，需要先看几版预览再决定。
- 用户想批量看同一风格的多个组合，用于挑选或做系列。
- 用户想找回、查看自己的角色卡与已生成形象。

## 不适用

- 真人照片修图、写实肖像定制。
- 任何需要证件材料、实名或人脸采集的场景。
- 复刻真实人物或他人已发布的角色；只能提炼同类型气质做原创。
- 纯文字设定整理（不涉及图像生成）的请求。

## 调用顺序

严格按下列顺序推进；每一步确认后再进入下一步，避免让用户为尚未定稿的配置付费。

1. `fetch_layers` — 读取槽位与配件目录。先了解当前可用的风格、槽位、稀有度与组合空间，再给方案。
2. `generate_preview` — 随机组合出缩略图（免费，不扣费）。建议一次 1–3 张，让用户挑选；不满意就换种子重掷。
3. `create_character` — 用户选中某版后，保存为角色卡草稿。角色名必填；预览选中的配件在下一步再指定。
4. `generate_character` — 为角色卡生成正式形象，返回大图与缩略图地址。传 `characterId` 与预览时的 `traits`/`seed` 可复现所选外观。

补充：`get_character` 查询单张角色卡，`list_my_characters` 列出当前用户的角色卡，`generate_batch` 批量出缩略图与联系表（单次最多 10 个，适合系列初筛）。

## 场景配方

四条常见路径，按用户说法对号入座，不要混用。

### 首次探索

用户只有一句模糊描述时：`fetch_layers` → `generate_preview`（1 张，确认风格方向）→ 给两三个部件方向 → 再出 3 张对比 → 用户挑一版后走定向调整。

### 定向调整

用户说「只改某一处」时：保留上一版 `seed` 与 `traits`，只在 `traits` 里覆盖目标槽位，其余不动。每次只改一到两个槽位，并说明改动点。

### 系列出图

用户要同一风格的多个组合时：`generate_batch`（count 1–10）先出缩略图与联系表，让用户从缩略图挑；再对挑中的组合逐个 `create_character` + `generate_character`。注意 `generate_batch` 只产出缩略图与联系表，不产出正式大图。

### 找回历史

用户问「我之前做的呢」时：`list_my_characters` 返回角色卡数组，按名称或风格定位；需要看大图就用 `get_character` 取单张。

## 参数说明

参数名以工具 schema 为准，未列出的字段不要传（schema 禁止多余字段，传了会直接报参数错误）。

### fetch_layers

无参数。返回各层可选配件与组合空间（`slots`、`comboSpace`）。

### generate_preview

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `style` | string | 否 | 风格标识，缺省 `general` |
| `seed` | integer | 否 | 非负整数；同风格同 seed 复现同一组合，不传则随机 |
| `traits` | object | 否 | `{slot: partId}`，只覆盖指定槽位，其余由种子决定 |

返回 `thumbDataUrl`（缩略图，data URL）、`compositionHash`、`rarityScore`、`rarityTier`、`planted`。

### create_character

只保存角色卡草稿，不生成图片、不扣费。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 是 | 角色名，1–64 字 |
| `source` | string | 否 | 固定 `text`（当前仅支持文本描述） |
| `style` | string | 否 | 与预览保持一致，缺省 `general` |
| `prompt` | string | 否 | 角色外观描述，≤ 4000 字 |
| `persona` / `fear` / `habit` | string | 否 | 人格、恐惧、习惯，各 ≤ 1000 字 |

返回完整角色卡（含 `id`、`name`、`status`、`style`）与 `imageUrl`/`thumbUrl`；尚未生成形象时这两个地址为 `null`。

### generate_character

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `characterId` | string | 是 | 角色卡 ID（注意是驼峰命名） |
| `traits` | object | 否 | 覆盖指定槽位，未指定的沿用卡上组合 |
| `seed` | integer | 否 | 想重掷时传新种子 |
| `refine` | boolean | 否 | 质感增强；默认关闭，失败自动回退为合成图 |

返回 `card`、`imageUrl`（大图）、`thumbUrl`（缩略图）、`refine`（对象，含 `skipped` 与原因，或消耗信息）。

### generate_batch

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `count` | integer | 是 | 1–10，超出直接拒绝 |
| `style` | string | 否 | 缺省 `anime` |
| `name` | string | 否 | 批次名称，缺省按风格自动命名 |

返回 `batchId`、`name`、`count`、`items`（含 `index`、`compositionHash`、`rarityTier`、`imageUrl`、`thumbUrl`）、`sheetUrl`（联系表）。

### get_character

`characterId` 必填（驼峰），返回单张角色卡与图片地址。

### list_my_characters

无参数，返回 `characters` 数组，列出当前 API Key 所属账号的全部角色卡。

## 成本与确认

- 预览免费：`generate_preview` 不扣额度，可以多试几轮，但一次仍建议不超过 3 张。
- 正式生成计费：`generate_character` 会消耗额度；同一角色卡重掷同样计费。
- 精修另计：`refine` 使用调用方自己的 API Key 与钱包额度，默认关闭，开启前必须说明。
- 批量前先报价：`generate_batch` 一次最多 10 个，调用前先报数量，得到确认再执行。
- 不代替用户确认付费；不因为失败自动重试计费操作。

## 结果展示

- 预览阶段只展示缩略图，并说明「预览免费，正式形象按实际用量计费」。
- 多版对比给一张小表：种子、稀有度层级、与前版的差异各一句。
- 正式形象返回的图片地址为站内相对路径，直接用于 `<img>` 与下载链接即可。
- 图片旁统一标注「内容由 AI 生成」。

## 验收清单

交付前自检：

- 风格与用户最终确认的一致；
- `seed` 与 `traits` 已记录，能原样复现；
- 大图与缩略图地址均可访问，不是占位；
- 生成前已说明计费，`refine` 状态已告知；
- 图片已标注「内容由 AI 生成」。

## 错误处理

| 情况 | 表现 | 处理 |
|---|---|---|
| 未授权 / 密钥无效 | 401，`UNAUTHORIZED` | 提示用户到 OpenElf 开放平台控制台检查或重新创建 API Key，不要重试同一密钥 |
| 余额不足 / 额度用尽 | 402，`INSUFFICIENT_BALANCE` / `QUOTA_EXCEEDED` | 提示充值后再试；不提供免费替代生成，不自行降级 |
| 数量超限 | 400，`INVALID_COUNT` 或类似 | 单次批量最多 10 个；请拆分批次或减少数量 |
| 参数不合法 | 400，`INVALID_TRAITS` / `INVALID_SEED` / `INVALID_NAME` | 按提示修正槽位、种子或角色名后重试一次 |
| 组合冲突 | 工具内部自动换种子重试 | 无需用户干预；连续失败时换风格或减少固定槽位 |
| 精修失败 | `refine.skipped` 带原因 | 告知已回退为合成图，询问是否重试，不重复计费操作 |
| 网络或服务异常 | 超时 / 5xx | 说明失败原因，保留角色卡，稍后重试；不重复扣费 |

## 禁止事项

- 不承诺任何价值、所有权、唯一性证明或交易属性；对外只描述为「AI 形象」。
- 不提及、不引导任何证件材料或实名流程。
- 不暴露内部路径、接口名、服务端目录、密钥或错误堆栈。
- 不代替用户确认付费；生成前说明将产生费用，得到确认后再调用。
- 不伪造生成结果；未拿到图片地址时明确说明失败。
