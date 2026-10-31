---
name: openelf-video
display_name: 视频剪辑 OpenElf
display_name_en: AI Video Cutter OpenElf
description: 通过 OpenElf 视频剪辑连接器，把长视频转写、找气口、裁剪重编码并生成字幕。
description_zh: 转写长视频、定位高完播区间、批量裁剪并生成字幕。
description_en: Transcribe a long video, find the strongest hooks, cut clips and generate subtitles.
author: "OpenElf"
version: 1.0.0
x-openelf:
  requires_connector: openelf-video
  min_plan: free
---

# 视频剪辑 OpenElf

把一条长视频拆成多条可独立发布的短片段：读取素材信息、转写音轨、按气口与信息密度定位候选区间，再裁剪、加字幕与导出。

## 何时使用

- 用户想把直播回放、长视频或播客切成多条短视频。
- 用户需要自动找气口、剪掉口癖与停顿。
- 用户要给片段加字幕或批量导出封面。

不适用：从零创作新视频、换脸或声音克隆、版权不明的素材。

## 调用顺序

1. `probe_media` — 读取时长、分辨率、帧率与音轨，判断能否处理。
2. `transcribe_audio` — 转写音轨，返回带时间戳的逐句文本与 `transcriptId`（走阿里云百炼异步文件转写，句级时间戳）。
3. `find_hooks` — 按 `transcriptId` 打分，返回候选区间、评分与理由。
4. `cut_video` — 按候选区间裁剪并重编码，统一比例与响度。
5. `burn_subtitles` — 生成外挂字幕或压制字幕。
6. `export_clips` — 补齐封面并返回视频、封面与字幕地址。

补充：`list_clips` 查询历史片段，`delete_clip` 删除片段，`concat_clips` 按顺序拼接。
