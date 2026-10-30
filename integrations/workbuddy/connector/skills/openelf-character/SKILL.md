---
name: openelf-character
description: 通过 OpenElf 形象工坊连接器，把一句话想法变成可预览、可保存的 AI 形象。
version: 1.0.0
x-openelf:
  requires_connector: openelf-character
  min_plan: free
---

# OpenElf 形象工坊

把用户对「一只 AI 形象」的模糊描述，拆成风格、发型、服装、气质等可执行部分，组合配件、生成预览，再保存角色卡并产出正式形象。

所有输出图像均为 AI 生成，展示时需标注「内容由 AI 生成」。

## 何时使用

- 用户想创作一只原创 AI 形象、角色立绘或头像。
- 用户已有想法，但说不清风格、服装、气质，需要先看几版预览再决定。
- 用户想批量看同一风格的多个组合，用于挑选或做系列。
- 用户想找回、查看自己的角色卡与已生成形象。

不适用：真人照片修图、写实肖像定制、任何需要证件材料的场景。

## 调用顺序

严格按下列顺序推进；每一步确认后再进入下一步，避免让用户为尚未定稿的配置付费。

1. `fetch_layers` — 读取槽位与配件目录。先了解当前可用的风格、槽位、稀有度与组合空间，再给方案。
2. `generate_preview` — 随机组合出缩略图（免费，不扣费）。建议一次 1–3 张，让用户挑选；不满意就换种子重掷。
3. `create_character` — 用户选中某版后，保存为角色卡草稿。角色名必填。
4. `generate_character` — 为角色卡生成正式形象，返回大图与缩略图地址。

补充：`get_character` 查询单张角色卡，`list_my_characters` 列出当前用户的角色卡，`generate_batch` 批量出图（单次最多 10 个，适合系列场景）。

## 参数说明

### fetch_layers

无必填参数，可选 `style` 过滤。返回 `slots`（槽位顺序）与 `comboSpace`（组合空间）。

### generate_preview

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `style` | string | 否 | 风格标识，如 `general` / `pixel` / `comic` / `painterly` |
| `seed` | integer | 否 | 非负整数；同风格同 seed 复现同一组合，不传则随机 |
| `traits` | object | 否 | `{slot: partId}`，只覆盖指定槽位，其余仍随机 |

返回 `thumbDataUrl`（缩略图）、`traits`、`compositionHash`、`rarity`。

### create_character

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 是 | 角色名，1–64 字 |
| `style` | string | 否 | 与预览保持一致 |
| `prompt` | string | 否 | 用户原话或结构化描述，建议 ≤ 4000 字 |
| `persona` / `fear` / `habit` | string | 否 | 人格、恐惧、习惯，各 ≤ 1000 字 |
| `traits` | object | 否 | 预览确认的 `{slot: partId}` |
| `seed` | integer | 否 | 预览使用的种子，保持可复现 |

返回角色卡对象，含 `id`、`name`、`status`、`seed`、`traits`。

### generate_character

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `character_id` | string | 是 | 角色卡 id |
| `traits` | object | 否 | 想调整的槽位，未传则沿用卡上组合 |
| `seed` | integer | 否 | 想重掷时传入新种子 |
| `refine` | boolean | 否 | 是否做质感增强；默认关闭，失败会自动回退为合成图 |

返回 `card`、`imageUrl`（大图）、`thumbUrl`（缩略图）、`refine`。

### generate_batch

`count` 1–10（超出直接拒绝）、`style`、`seedStart`（非负整数，按序递增）、`name`。返回批次 id、`sheetKey`（联系表）与逐条 `items`。

### get_character / list_my_characters

`character_id` 必填；列表可选 `limit`（1–200）。

## 结果展示

- 预览阶段只展示缩略图，并说明「预览免费，正式形象按实际用量计费」。
- 正式形象返回的图片地址为站内相对路径，直接用于 `<img>` 与下载链接即可。
- 图片旁统一标注「内容由 AI 生成」。

## 错误处理

| 情况 | 表现 | 处理 |
|---|---|---|
| 未授权 / 密钥无效 | 401，`UNAUTHORIZED` | 提示用户到 OpenElf 开放平台控制台检查或重新创建 API Key，不要重试同一密钥 |
| 余额不足 / 额度用尽 | 402，`INSUFFICIENT_BALANCE` / `QUOTA_EXCEEDED` | 提示充值后再试；不提供免费替代生成，不自行降级 |
| 数量超限 | 400，`INVALID_COUNT` 或类似 | 单次批量最多 10 个；请拆分批次或减少数量 |
| 参数不合法 | 400，`INVALID_TRAITS` / `INVALID_SEED` / `INVALID_NAME` | 按提示修正槽位、种子或角色名后重试一次 |
| 组合冲突 | 工具内部自动换种子重试 | 无需用户干预；连续失败时换风格或减少固定槽位 |
| 网络或服务异常 | 超时 / 5xx | 说明失败原因，保留角色卡，稍后重试；不重复扣费 |

## 禁止事项

- 不承诺任何价值、所有权、唯一性证明或交易属性；对外只描述为「AI 形象」。
- 不提及、不引导任何证件材料或实名流程。
- 不暴露内部路径、接口名、服务端目录、密钥或错误堆栈。
- 不代替用户确认付费；生成前说明将产生费用，得到确认后再调用。
- 不伪造生成结果；未拿到图片地址时明确说明失败。
