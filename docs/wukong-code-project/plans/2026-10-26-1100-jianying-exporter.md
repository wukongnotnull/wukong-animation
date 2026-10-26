# 剪映草稿导出器实施计划

目标：按 [spec](../specs/2026-10-26-1040-jianying-exporter-design.md) 新增 `jianying` 导出器。

架构：`cmdFinal` 把混音返回的未混音轨、人声时间和渲染返回的分段组装成 `timeline`，经 `encodeOutputs` 透传给导出器；导出器用纯函数 `buildDraftPlan` 生成草稿计划，再调用 `python3 write_draft.py`（pyJianYingDraft 0.3.1）写进剪映草稿目录。

技术栈：Node ≥ 20（`node:test`），Python 3 + pyJianYingDraft==0.3.1，ffmpeg。

全局约束（摘自 spec）：仅 macOS 剪映专业版 11.6；`experimental`；不覆盖同名草稿；`--proxy` 报错；素材复制进草稿；mp4 / gif / png-seq 行为不变。

## 文件

| 文件 | 职责 |
| --- | --- |
| `plugin/engine/exporters/jianying/plan.mjs` | 新建：`buildDraftPlan(timeline)` 纯函数 |
| `plugin/engine/exporters/jianying/index.mjs` | 新建：前置检查、写计划 JSON、调用 Python、日志 |
| `plugin/engine/exporters/jianying/write_draft.py` | 新建：按计划建草稿、复制素材、保存、失败清理 |
| `plugin/engine/exporters/jianying/exporter.json` | 新建：清单 |
| `plugin/engine/audio/soundtrack.mjs` | 改：返回 `{ mix, tracks, voices }` |
| `plugin/engine/core/job.mjs` | 改：`render` 返回 `segments`；`encodeOutputs` 透传 `timeline`、接收返回路径 |
| `plugin/engine/bin/wka.mjs` | 改：`cmdFinal` 组装 timeline；`wka check` 加检测 |
| `plugin/engine/exporters/_template/index.mjs`、`docs/ARCHITECTURE.md`、`requirements.txt` | 改：接口说明与依赖 |
| `tests/unit/jianying-plan.test.mjs`、`tests/integration/jianying.test.mjs` | 新建：测试 |

## 任务

1. **草稿计划**：写 `tests/unit/jianying-plan.test.mjs` → `node --test tests/unit/jianying-plan.test.mjs` 确认失败 → 实现 `plan.mjs` → 再跑通过 → 提交。
2. **管线透传**：改 soundtrack / job / wka，跑 `node --test tests/unit/*.test.mjs tests/integration/*.test.mjs` 确认现有测试仍通过 → 提交。
3. **导出器与 Python 写出**：写 `tests/integration/jianying.test.mjs`（临时草稿根目录）→ 确认失败 → 实现 `index.mjs`、`write_draft.py`、`exporter.json` → 通过 → 提交。
4. **依赖与文档**：`requirements.txt`、`wka check`、`_template`、`ARCHITECTURE.md` → 提交。
5. **验证**：全部单元 / 集成测试、`node tests/smoke/run.mjs`；用样片导出草稿交用户在剪映 11.6 人工验收。
