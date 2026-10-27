# 中英双语字幕 实施计划

- spec：`docs/wukong-code-project/specs/2026-10-28-0145-bilingual-subtitles-design.md`（#48）
- 目标：`film.json` 打开 `subtitles.bilingual` 后，烧录版、外挂字幕、剪映草稿都带英文行。
- 架构：英文写在片目录 `subtitles.en.json`（与 srt 逐条对应的 `{zh, en}`）；`core/subtitles.mjs` 负责同步、核对、检查，把英文挂到字幕条目的 `en` 上；烧录层、外挂导出、剪映计划读 `en`。
- 技术栈：Node 20（node:test）、Playwright（烧录）、ffmpeg。
- 全局约束（摘自 spec）：不写 `bilingual` 的片子所有输出与现在相同；英文由写片子的人填，不自动翻译。

## 文件

| 文件 | 职责 |
| --- | --- |
| `plugin/engine/core/subtitles.mjs` | 设置缺省值、`syncEnglish` / `attachEnglish` / `checkEnglish`、`subtitleOutputs` 多英文 srt |
| `plugin/engine/core/subtitle-layer.mjs` / `.html` | 两行烧录、`font_en` |
| `plugin/engine/exporters/jianying/plan.mjs`、`write_draft.py`、`index.mjs` | 「英文字幕」轨与按轨样式 |
| `plugin/engine/bin/wka.mjs` | `cmdSubtitles` 写英文稿、读取时挂英文；`cmdFinal` 出英文 srt |
| `plugin/engine/schemas/film.schema.json`、`style.schema.json`、keynote `style.json` | `bilingual`、`max_chars_en`、`font_en` |
| `tests/unit/subtitles-en.test.mjs`（新）、`tests/unit/jianying-plan.test.mjs`、`tests/integration/subtitles.test.mjs` | 验收 1–6 |
| director `SKILL.md`、简报模板，keynote `STYLE.md` | 文档 |

## 任务

1. 英文稿：单元测试（同步、核对、检查、输出名、英文 srt）→ 失败 → 实现 → 通过。
2. 剪映：单元测试（英文轨、中文轨上移、单语不变）→ 失败 → 实现 → 通过。
3. 烧录与命令：集成测试（生成英文稿、空条报错、两行烧录、单语不生成）→ 失败 → 实现烧录层与 `wka.mjs` → 通过。
4. schema、keynote 样式、文档；`node tools/lint.mjs`、`node --test tests/unit/*.test.mjs tests/integration/*.test.mjs`、`node tests/smoke/run.mjs`。
