# 字幕制作工序实施计划

目标：按 [spec](../specs/2026-10-26-1343-subtitles-step-design.md) 新增第 11 道字幕制作工序、进度迁移和字幕引擎功能。

架构：`core/subtitles.mjs` 放纯函数（断句、srt 读写、检查）；`core/subtitle-layer.mjs` 用 Chromium 把每条字幕渲染成透明 PNG，再用 ffmpeg `overlay` 叠到拼好的画面上；`wka subtitles` 生成 / 检查 / 预览，`wka final` 按 `subtitles.mode` 烧录、外挂，并把字幕交给剪映导出器。`core/state.mjs` 改为 14 道工序并迁移旧进度。

技术栈：Node ≥ 20（`node:test`），playwright Chromium（已有依赖），ffmpeg（`overlay`）。

全局约束（摘自 spec）：引擎版本不变、镜头哈希不变；QC 仍读无字幕的 `.cache/video.mp4`；没有 `subtitles` 字段的片子行为不变；进度只做 flow 1 → 2 迁移；ffmpeg 不依赖 `subtitles` / `drawtext` 滤镜。

## 文件

| 文件 | 职责 |
| --- | --- |
| `plugin/engine/core/state.mjs` | 改：14 道工序、10 个节点、`migrateProgress`、`readProgress` 写回 |
| `plugin/engine/core/subtitles.mjs` | 新建：`buildSubtitles` / `formatSrt` / `parseSrt` / `checkSubtitles` / `subtitleSettings` |
| `plugin/engine/core/subtitle-layer.mjs` | 新建：`burnSubtitles(job, video, cues, out)` |
| `plugin/engine/runtime/subtitle.html` | 新建：字幕层宿主页 |
| `plugin/engine/core/fonts.mjs` | 改：`KNOWN_FONTS` 加 Noto Sans SC |
| `plugin/engine/bin/wka.mjs` | 改：`wka subtitles`；`cmdFinal` 烧录、外挂、`timeline.subtitles`；`status` 显示迁移；`--step` 范围 |
| `plugin/engine/exporters/jianying/plan.mjs`、`index.mjs` | 改：有 `timeline.subtitles` 时字幕轨读它 |
| `plugin/engine/schemas/film.schema.json`、`style.schema.json` | 改：`subtitles` 字段 |
| `tests/unit/state.test.mjs`、`tests/unit/subtitles.test.mjs`、`tests/unit/jianying-plan.test.mjs`、`tests/integration/subtitles.test.mjs` | 新建 / 改：测试 |
| `docs/PRODUCTION-WORKFLOW.md`、`plugin/skills/director/SKILL.md`、`STORYBOARD.md`、`README.md` | 改：流程 v1.2.0 |

## 任务

1. **工序与迁移**（A1–A3）：改 `tests/unit/state.test.mjs` 为 14 道 / 10 节点并加迁移用例 → `node --test tests/unit/state.test.mjs` 确认失败 → 改 `state.mjs`、`wka.mjs` 的 `status` / `signoff` → 通过 → 提交。
2. **字幕纯函数**（A4–A6）：写 `tests/unit/subtitles.test.mjs` → 确认失败 → 实现 `core/subtitles.mjs` → 通过 → 提交。
3. **剪映字幕读 srt**（A10）：在 `tests/unit/jianying-plan.test.mjs` 加用例 → 确认失败 → 改 `plan.mjs` / `index.mjs` → 通过 → 提交。
4. **字幕层与命令**（A7–A9）：写 `tests/integration/subtitles.test.mjs`（browser 依赖缺失时跳过）→ 确认失败 → 实现 `subtitle-layer.mjs`、`runtime/subtitle.html`、schema、`fonts.mjs`、`wka subtitles`、`cmdFinal` 改动 → 通过 → 提交。
5. **文档**（A12）：流程文档 v1.2.0、SKILL.md、STORYBOARD.md、README → `node tools/lint.mjs` → 提交。
6. **全量验证**（A11）：`node --test tests/unit/*.test.mjs tests/integration/*.test.mjs`、`node tests/smoke/run.mjs`、`node tools/lint.mjs`、`node tools/build-docs.mjs --check`；在测试项目的《山水有回声》上跑 `wka status`（确认迁移为 13/14）。
