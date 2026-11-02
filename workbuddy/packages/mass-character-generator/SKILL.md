---
name: mass-character-generator
display_name: 千人千面生成器 OpenElf
display_name_en: Mass Character Generator OpenElf
description: 通过 OpenElf 千人千面生成器连接器，按图层配件组合批量生成千人千面的形象作品；用户提到批量生成形象、系列头像、稀有度权重、配件组合时使用。
description_zh: 读取图层目录、调稀有度权重、先预览再批量生成，最后打包下载或提交作品收单。
description_en: Read the layer catalog, tune rarity weights, preview first, then batch-generate character artworks, and download them as a zip or submit the work info.
examples_zh:
- "帮我生成 20 个千人千面的形象作品，皇冠调稀有一点"
- "先看看当前图层和配件的权重，再给我 3 张预览"
- "把刚生成的这一批打包下载，并提交作品信息收单"
- "把墨镜的权重调到 0，重新生成一批不要墨镜的"
examples_en:
- "Generate 20 mass character artworks and make the crown rarer"
- "Show the current layer weights first, then give me 3 previews"
- "Zip the batch I just generated and submit the work info"
- "Set the shades weight to 0 and regenerate a batch without them"
version: 1.0.0
author: "OpenElf"
x-openelf:
  requires_connector: openelf-generator
  min_plan: free
---

# 千人千面生成器 OpenElf

把形象拆成「背景 / 身体 / 眼睛 / 嘴巴 / 配饰」五个图层的配件组合，按稀有度权重随机搭配，批量生成千人千面的形象作品。先预览调权重，再批量产出，最后打包下载或提交作品信息收单。

所有输出图像均为 AI 生成，展示时需标注「内容由 AI 生成」。本技能依赖已发布的 `openelf-generator` 连接器，不重复内置连接器实现。

## 何时使用

- 用户想批量生成一系列风格统一、组合各异的形象作品（如系列头像、系列形象）。
- 用户想调整某个配件的出现概率，控制稀有款与常规款的分布。
- 用户想先看预览效果，确认后再批量产出。
- 用户需要把产出打包下载，或按统一标准提交作品信息收单。

## 不适用

- 从零自由创作单张精修形象（用形象工坊 OpenElf）。
- 真人照片修图、写实肖像定制。
- 复刻真实人物或他人已发布的形象；只能做原创组合。
- 视频、动图产出（当前仅静态图片）。

## 调用顺序

严格按下列顺序推进；先预览确认效果再批量生成，避免返工。

1. `fetch_layers` — 读取五个图层的配件目录与当前生效的权重，先了解组合空间。
2. `update_weight` — 按用户要求调整配件权重（0-100，0 表示该配件不再出现）；可多次调用。
3. `generate_preview` — 生成预览图给用户确认整体风格；记住 seed 可复现同一组合。
4. `generate_batch` — 用户确认后批量生成，单次最多 100 件，返回每件图片与缩略图地址、稀有度。
5. `download_item` / `download_batch` — 取单件图片地址，或把多件套成 zip（含元数据）下载。
6. `submit_work_submission` — 用户需要收单时，提交作品信息载荷，返回收单编号。

补充：批量产出后可按稀有度（common / rare / epic / legendary）向用户汇报分布，帮助决定是否继续调整权重再生成。
