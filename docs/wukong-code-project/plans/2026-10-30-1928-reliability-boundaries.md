# 第一批可靠性修复实施计划

目标：按 [已批准规格](../specs/2026-10-30-1923-reliability-boundaries-design.md) 修复重复镜头编号、缓存清单中断恢复、首次提交夹带暂存文件三项问题。关联 #113。

架构：唯一性检查留在共享 loadFilm 入口；ShotCache 复用现有 atomicJson 并在本地处理损坏清单；initProject 限定首次提交路径。三项独立实现与验收，不新增框架。

技术栈：Node.js ESM、node:test、文件系统、Git、既有 browser/Remotion 与 ffmpeg 渲染检查。

## 全局约束（摘自规格）

- 本批不改变生成画面、帧率、声音、字幕、主副版关系或审片门槛。
- 使用临时测试工程验证，不修改客户作品、已安装插件缓存、既有签批成片或外部剪映草稿。
- 本批不修改依赖安装流程、流程版本迁移、剪映 CI、性能算法或渲染并发；这些属于已确认的后续批次。
- 近期继续使用 browser/Remotion，不新增 Manim/Blender，不拆分整个核心，不为未来管线建立通用框架。

## 文件与职责

| 文件 | 职责 |
| --- | --- |
| plugin/engine/core/job.mjs | 加载时拒绝重复 ID；向 ShotCache 传递已有日志出口 |
| plugin/engine/core/cache.mjs | 校验清单结构、报告损坏并按未命中恢复、原子保存 |
| plugin/engine/core/project.mjs | 首次提交限定 .gitignore 路径 |
| tests/unit/load-film.test.mjs | 主副版、两种管线、requireShots:false 的重复 ID 与合法配置 |
| tests/unit/shot-cache.test.mjs | 损坏降级、读写失败、原子保存、有效缓存回归 |
| tests/unit/project.test.mjs | 真实 Git 索引、提交树和工作区内容保护 |
| tests/integration/render.test.mjs | 损坏清单后真实重渲，受保护文件不变 |
| docs/wukong-code-project/reports/2026-10-30-reliability-boundaries-validation.md | 红绿证据、验收映射与验证限制 |

## 任务 1：R1，配置提前拒绝（A1–A2）

1. 新增 load-film 测试，使用真实临时工程与 loadFilm/render 入口；重复 ID 检查必须在缺失文件、字体准备和渲染前触发。
2. 运行 `node --test tests/unit/load-film.test.mjs`，确认旧代码因未拒绝重复 ID 而失败。
3. 在 Schema 验证后、风格/镜头解析前增加最小唯一性校验，不改变原始配置。
4. 同命令通过，再提交 R1 测试与实现。

## 任务 2：R2，缓存恢复（A3–A6）

1. 新增 ShotCache 测试：截断/结构损坏、正常读写和缓存命中；注入读写错误确认实际失败传播与旧清单完整性。在现有渲染集成文件追加隔离短片的恢复测试。
2. 运行 `node --test tests/unit/shot-cache.test.mjs tests/integration/render.test.mjs`，确认旧代码在清单损坏和非原子保存时失败。
3. 读取错误只对 ENOENT 按无缓存处理；语法/结构损坏记录路径和原因后使用空索引。store/invalidate 用 atomicJson，保存成功后再发布内存索引、淘汰旧片段，失败不提前破坏旧命中。
4. 同命令通过；核对源文件、声音、签批、另一画幅索引和既有产物摘要保持不变。提交 R2 测试与实现。

## 任务 3：R3，首次提交范围（A7–A8）

1. 在 project 测试中构造尚无 HEAD 的真实仓库，先暂存无关文件再修改工作区，记录索引的 blob/mode 与工作区字节。
2. 运行 `node --test tests/unit/project.test.mjs`，确认旧代码首次提交夹带该文件而失败。
3. 将首次提交限定为 .gitignore，沿用已有 HEAD 分支的路径限定方式；失败/缺身份仍保留原日志行为。
4. 同命令通过，覆盖全新仓库、已有 HEAD、缺身份、hook 拒绝提交以及索引/工作区保护。提交 R3 测试与实现。

## 最终验收

1. 核对三项改动仅涉及批准范围，逐项映射 A1–A8。
2. 运行 `npm test`；若本机全并发资源竞争导致失败，保留原失败证据、定位原因，再按固定低并发运行完整单元与集成矩阵，不静默跳过用例。
3. 运行 `npm run smoke`、`npm run lint`、`git diff --check`，不更新视觉基准。
4. 保存验证报告、补充 #113，提交剩余文档；列明未运行的远端 CI。此次不发布、不修改安装缓存。
