---
name: smart-cut
display_name: 爆款二次剪辑 OpenElf
display_name_en: Viral Remix Cutter OpenElf
description: 通过 OpenElf 视频剪辑连接器，把长视频转成多条可独立发布的短片段；用户提到二次剪辑、爆款切片、找气口、批量出片、自动字幕时使用。
description_zh: 转写长视频、定位气口与口癖、批量裁剪拼接并生成字幕，产出可直接发布的短片段。
description_en: Transcribe a long video, find the strongest hooks, cut and stitch short clips, and generate subtitles ready to publish.
examples_zh:
- "把这段 20 分钟的直播回放切成十条短视频"
- "帮我找出这段长视频里最抓人的几段，并加上字幕"
- "同一条素材做三个不同开头的版本，方便我做 A/B 测试"
- "把已经导出的几条片段按顺序拼成一条合集"
examples_en:
- "Cut this 20-minute livestream replay into ten short clips"
- "Find the most engaging segments in this long video and add subtitles"
- "Make three versions of the same clip with different openings for A/B testing"
- "Stitch the clips I already exported into one compilation"
version: 1.1.0
author: "OpenElf"
x-openelf:
  requires_connector: openelf-video
  min_plan: free
---

# 爆款二次剪辑 OpenElf

把一条长视频拆成多条可独立发布的短片段：先转写拿到逐句时间，再按气口、口癖与信息密度挑出高完播区间，最后重编码、压字幕并批量导出。

本技能依赖 `openelf-video` 连接器完成转写与编码，技能层只负责编排流程与结果整理，不内置转写或编码实现。

## 何时使用

- 用户想把直播回放、长视频或播客切成多条短视频。
- 用户想批量产出同一素材的多个开头版本，用于对比测试。
- 用户需要自动找气口、剪掉口癖与停顿，并配好字幕。
- 用户已有一条表现不错的长内容，想做二次分发。
- 用户想把已导出的几条片段按顺序拼成一条合集。

## 不适用

- 从零创作新视频（脚本、拍摄、生成画面）。
- 需要真人出镜、声音克隆或换脸的内容。
- 版权不明、未获授权或包含他人肖像与声音的素材。
- 纯音频剪辑、音乐混音等与短视频切片无关的需求。
- 超出单素材时长上限且用户不愿分段处理的素材（见下节口径）。

## 调用顺序

严格按下列顺序推进；每一步确认后再进入下一步，避免让用户为尚未确认的片段付费。

1. `probe_media` — 读取素材信息（时长、分辨率、帧率、音轨、体积），判断能否直接处理。
2. `transcribe_audio` — 转写音轨，返回带时间戳的逐句文本与词级时间，作为后续定位依据。
3. `find_hooks` — 按气口、口癖、信息密度与情绪强度打分，返回候选区间、推荐理由与建议时长。
4. `cut_video` — 按候选区间裁剪并重编码，统一分辨率、帧率与响度；支持一次提交多个区间。
5. `burn_subtitles` — 根据转写结果生成字幕文件，选择压制进画面或外挂字幕。
6. `export_clips` — 打包导出，返回每个片段的视频、封面与字幕地址。

补充：`list_clips` 查询历史任务与片段，`delete_clip` 删除指定片段，`concat_clips` 把多个片段按顺序拼接。

## 处理上限

先看口径再谈方案，避免给用户一个跑不通的计划：

| 项目 | 上限 | 超出时怎么办 |
|---|---|---|
| 单素材时长 | 默认 30 分钟（可由服务端配置） | 先按剧情或话题切成若干段，分别处理 |
| 单素材体积 | 200 MB | 请用户先压缩或降低码率 |
| 单片段时间 | 60 秒 | 缩短区间；需要更长时先拼后不拆 |
| 单次裁剪区间 | 20 段 | 拆成多个批次 |
| 单次候选数量 | 20 个 | 分批找气口 |
| 拼接片段 | 2–10 段，总长 ≤ 300 秒 | 分组合集，或先合并再拼 |

用户提到「两小时回放」这类超出上限的素材时，先说明口径并给出分段方案，不要直接调用工具撞限制。

## 场景配方

### 直播回放切片

`probe_media` 确认时长在上限内 → `transcribe_audio` → `find_hooks`（count 8–12，minSec 15、maxSec 45）→ 展示候选并确认 → `cut_video` 统一 9:16 → `burn_subtitles` 压字幕 → `export_clips`。素材过长时先按话题分成 20 分钟以内的几段。

### 单条爆款复刻

用户指定「这条火了，照这个节奏再来几条」时：先 `transcribe_audio` 拿逐句文本，再 `find_hooks` 用同样的 minSec/maxSec 与 count 提取等价区间；风格参数保持一致，只换内容区间。

### 多开头 A/B

同一区间做多个开头：`cut_video` 用不同起止点提交多组区间（每组只改开头 1–3 秒）→ `burn_subtitles` 统一字幕样式 → `export_clips` 一次导出。开头版本控制在 3 个以内，便于用户比较。

### 播客转短视频

无人声画面、只有对白时：`transcribe_audio` → `find_hooks`（优先问句与结论句）→ `cut_video` 统一 9:16 并可保留原图 + 字幕压在画面上 → `export_clips`。提醒用户确认声音与嘉宾授权。

### 合集拼接

已有多条片段时：`list_clips` 找回 → `concat_clips`（2–10 段、总长 ≤ 300 秒）→ `export_clips` 补齐封面。分辨率与帧率不一致时先由 `cut_video` 统一。

## 气口判定规则

`find_hooks` 的评分依据，提前说明便于用户理解推荐结果：

- 信息密度：单位时间内的有效字数越高，分越高。
- 问句与感叹：出现问号、感叹号的区间加权。
- 钩子开头：以「其实」「你知道」「为什么」这类词开头的区间加权。
- 收尾完整：以句号、问号、感叹号或引号收束的区间加权。
- 时长区间：20–45 秒加权，过短或过长不加分。
- 口癖扣分：开启 `removeFillers` 后，「嗯」「那个」「就是说」等出现越多扣分越多。

分数只用于排序，不代表平台表现；不要向用户承诺播放量。

## 参数说明

参数名以工具 schema 为准，未列出的字段不要传（schema 禁止多余字段，传了会直接报参数错误）。

### probe_media

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `sourceUrl` | string | 是 | 素材地址，支持已授权的公网 http/https 链接 |
| `maxDurationSec` | integer | 否 | 允许处理的最长时长，超出直接拒绝 |

### transcribe_audio

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `sourceUrl` | string | 是 | 与 `probe_media` 相同的素材地址 |
| `language` | string | 否 | 语言代码；不传则自动识别 |
| `wordTimestamps` | boolean | 否 | 是否返回词级时间，默认开启 |

返回 `transcriptId`、`language`、`durationSec`、`segmentCount` 与 `segments`（含 `start`、`end`、`text`）。

### find_hooks

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `transcriptId` | string | 否 | 上一步返回的转写 ID，与 `segments` 二选一 |
| `segments` | array | 否 | 直接传入逐句文本，形如 `[{start, end, text}]` |
| `count` | integer | 是 | 候选数量，1–20，超出直接拒绝 |
| `minSec` / `maxSec` | integer | 否 | 单片段时长范围，默认 15–60 秒；`maxSec` 必须大于 `minSec` |
| `removeFillers` | boolean | 否 | 是否在评分时计入口癖与停顿，默认开启 |

返回 `count`、`minSec`、`maxSec`、`hooks`（含 `start`、`end`、`score`、`reason`）。

### cut_video

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `sourceUrl` | string | 是 | 素材地址 |
| `ranges` | array | 是 | 区间列表，每项 `{start, end}`，单次最多 20 段 |
| `aspect` | string | 否 | `original` / `9:16` / `1:1` / `16:9`，默认保持原比例 |
| `normalizeLoudness` | boolean | 否 | 是否统一响度，默认开启 |

返回 `count`、`aspect`、`clips`（含 `clipId`、`durationSec`、`videoUrl`、`coverUrl`、`subtitleUrl`）。

### burn_subtitles

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `clipIds` | array | 是 | 需要加字幕的片段 ID 列表，单次最多 20 个 |
| `transcriptId` | string | 是 | 转写记录 ID，字幕文本来自该记录 |
| `mode` | string | 否 | `burn`（压制进画面）或 `sidecar`（外挂字幕），默认 `sidecar` |
| `style` | string | 否 | 样式片段，如 `FontSize=18,Outline=2`，仅允许字母、数字与常见符号 |

### export_clips

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `clipIds` | array | 是 | 要导出的片段 ID 列表，单次最多 20 个 |
| `cover` | boolean | 否 | 是否同时产出封面，默认开启 |

### concat_clips

`clipIds` 必填，2–10 段，按数组顺序拼接；各片段的分辨率与帧率需一致，否则先由 `cut_video` 统一。

### list_clips

无参数，返回最近 100 条片段摘要，按创建时间倒序。

### delete_clip

`clipId` 必填，删除片段及其封面与字幕文件。

## 成本与确认

- 裁剪、字幕与导出都会产生实际文件与算力消耗；调用前先说清这一步要处理几条、预计多长。
- 一次最多 20 段，超过就先分批并告知用户将分几次执行。
- 用户还没确认候选区间时，不要提前裁剪，避免为废片付费。
- 失败后不自动重试计费步骤；保留已完成的转写与片段，等用户决定。

## 结果展示

- 先展示候选区间列表：起止时间、建议时长、推荐理由、评分。
- 用户确认后再裁剪；导出时每个片段给出时长、起始时间、封面与字幕地址。
- 所有产出标注「内容由 AI 处理」。
- 发布前提醒用户自行确认素材版权、肖像与声音授权。

## 验收清单

交付前自检：

- 每条片段时长在 15–60 秒区间内，比例与用户要求一致；
- 响度已统一，字幕模式（压制或外挂）与用户确认的一致；
- 视频、封面、字幕地址均可访问，不是占位；
- 片段总数与用户确认的数量一致，分批次时说明批次归属；
- 已标注「内容由 AI 处理」并提示版权与授权事项。

## 错误处理

| 情况 | 表现 | 处理 |
|---|---|---|
| 未授权 / 密钥无效 | 401，`UNAUTHORIZED` | 提示用户到 OpenElf 开放平台控制台检查或重新创建 API Key，不要重试同一密钥 |
| 余额不足 / 额度用尽 | 402，`INSUFFICIENT_BALANCE` / `QUOTA_EXCEEDED` | 提示充值后再试；不提供免费替代处理，不自行降级画质以外的选项 |
| 素材不可读 | 400，`INVALID_MEDIA` | 说明哪项信息缺失，请用户重传或换格式 |
| 素材过大 | 413，`MEDIA_TOO_LARGE` | 请用户先压缩或分段，再重新处理 |
| 素材过长 | 400，`MEDIA_TOO_LONG` | 按处理上限分段；不要改 `maxDurationSec` 绕过限制 |
| 无人声或转写失败 | 422，`NO_SPEECH` | 说明无法定位气口，改为手动指定区间后再裁剪 |
| 未配置转写服务 | `ASR_NOT_CONFIGURED` | 说明管理员需在服务端配置 `ASR_BASE_URL`、`ASR_API_KEY` 与 `ASR_MODEL`；此时可让用户直接提供逐句文本，走 `find_hooks` 的 `segments` |
| 转写超时 | `ASR_TIMEOUT` / `ASR_FAILED` | 提示缩短素材后重试，或改用已有文本 |
| 数量或区间超限 | 400，`INVALID_COUNT` / `INVALID_RANGE` | 单次候选项最多 20 个、区间最多 20 段，请拆分批次 |
| 区间超出素材时长 | 400，`INVALID_RANGE` | 按 `probe_media` 返回的时长修正区间 |
| 网络或服务异常 | 超时 / 5xx | 说明失败原因，保留已完成的转写与片段，稍后重试；不重复扣费 |

## 禁止事项

- 不处理版权不明、未获授权的素材；用户无法说明来源时先暂停。
- 不做换脸、声音克隆或模仿特定真人声线。
- 不伪造转写结果；未拿到片段地址时明确说明失败。
- 不暴露内部路径、服务端目录、密钥或错误堆栈。
- 不代替用户确认付费；裁剪与导出前说明将产生费用，得到确认后再调用。
