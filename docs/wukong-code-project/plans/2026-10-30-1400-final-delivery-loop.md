# 最终交付闭环实施计划

目标：按[获批设计](../specs/2026-10-30-1334-final-delivery-loop-design.md)提供精简、可部分使用、绑定具体版本的最终交付。

架构：新增独立最终交付证据模块，读取确认决定生成稳定槽位，按项比较依赖、文件身份及批准。现有导出和签批边界只追加证据，旧 delivery 与阶段缓存保持兼容。

技术栈：Node.js ESM、内置 node:test、JSON Schema 子集、现有 CLI。

全局约束（摘自 spec）：
- 本轮只新增最终交付判定、展示和验收证据；不改渲染/混音算法、缓存复用条件、实际审片数量或制作流程编号。
- 不自动覆盖、删除、移动、重命名、归档或重渲客户产物；不修改剪映native格式，不清理旧草稿。
- 保留用户编辑保护、同名避让和原始导出回执。

## 文件与职责

| 文件 | 职责 |
| --- | --- |
| plugin/engine/core/final-delivery.mjs | 契约、严格快照、依赖、状态、批准绑定、报告 |
| plugin/engine/schemas/final-delivery.schema.json | 账本结构校验 |
| plugin/engine/core/job.mjs | 成功导出后登记证据 |
| plugin/engine/bin/wka.mjs | final 查询、显式重试、revision 签批、字幕登记 |
| plugin/skills/director/SKILL.md | 最终交付与原有节点的使用方式 |
| tests/unit/final-delivery.test.mjs | A1–A10 状态与只读/恢复矩阵 |
| tests/integration/final-delivery.test.mjs | A3–A5、A9–A11 CLI 与真实导出链路 |

## 任务

1. 契约与精简报告（A1–A3、A9、A11）。先写 `node --test tests/unit/final-delivery.test.mjs`，确认功能缺失导致失败；实现只读契约和报告，复跑通过后提交。
2. 严格产物与逐项来源（A6–A10）。先加英文/布局/画幅隔离、动态来源未知、损坏账本、特殊文件测试并运行确认失败；实现独立来源快照与生成登记，不改变 operations；复跑后提交。
3. 版本绑定（A4、A5、A8、A10）。先加 revision 过期、手改目录、幂等和旧批准测试并确认失败；接入既有 13/14/15 与显式 record，保留原记录；复跑后提交。
4. CLI 与导演说明（A1–A5、A9–A11）。先写隔离 CLI 测试并确认缺入口失败；接入命令与生成边界，验证仅约定报告落盘。真实导出使用临时工程和临时草稿根目录。
5. 完成前核验。执行 `npm test`、`npm run lint`、`npm run smoke`，核对 A1–A11；记录真实宿主未验证边界、更新 #93 和验证报告，提交供审阅。客户制作工程始终只读。
