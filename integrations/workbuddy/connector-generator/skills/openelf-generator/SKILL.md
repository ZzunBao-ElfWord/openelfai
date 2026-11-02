---
name: openelf-generator
display_name: 千人千面生成器 OpenElf
display_name_en: Mass Character Generator OpenElf
description: 通过 OpenElf 千人千面生成器连接器，按图层组合批量生成形象作品并打包下载。
description_zh: 读取图层目录、调整稀有度权重、批量生成形象作品并打包下载。
description_en: Read the layer catalog, tune rarity weights, batch-generate character artworks and download them as a zip.
author: "OpenElf"
version: 1.0.0
x-openelf:
  requires_connector: openelf-generator
  min_plan: free
---

# 千人千面生成器 OpenElf

按「背景 / 身体 / 眼睛 / 嘴巴 / 配饰」五个图层的配件组合，批量生成千人千面的形象作品：先看预览、调权重，再批量产出并打包下载。

## 何时使用

- 用户想按图层组合批量生成一系列形象作品。
- 用户想调整各配件的出现概率（稀有度权重）。
- 用户需要把产出打包下载，或把作品信息提交收单。

不适用：从零自由绘图、真人照片处理、单张精修（用形象工坊）。

## 调用顺序

1. `fetch_layers` — 读取图层与配件目录，确认当前生效的权重。
2. `update_weight` — 按需调整配件权重（0-100，0 表示不再出现）。
3. `generate_preview` — 生成预览图确认整体效果，可传 seed 复现。
4. `generate_batch` — 批量生成（单次最多 100 件），返回每件图片地址。
5. `download_item` / `download_batch` — 取单件或打包 zip 下载。
6. `submit_work_submission` — 需要收单时提交作品信息，拿回执编号。
