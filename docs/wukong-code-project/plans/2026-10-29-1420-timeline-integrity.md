# 统一时间轴实施计划

目标：实现已批准 spec 的 FR-1/FR-2，消除逐镜累计漂移，并以真实媒体证据阻止错误交付。

架构：core/timing.mjs 统一累计切点与媒体校验，job 调度两条可用管线并记录来源。QC、预览与输出复用校验入口，保留原工程秒数和声音 cue。

技术栈：Node.js ESM、node:test、ffmpeg/ffprobe、Playwright、Remotion。

依据：[spec](../specs/2026-10-29-1407-timeline-integrity-design.md)，已获用户批准。

## 全局约束（从 spec 原样摘录）

- 不增加必填 film.json 字段；不修改原镜头时长、旁白、字幕文本或客户工程。
- 不自动删除或覆盖 `.cache/approved/`、approved.main、签批历史。主版已有签批时，发现新旧哈希或帧数差异必须明确提示；副版仍用原快照比较，真实切点变化不得标为主版不变。
- 不发布版本、不改已安装缓存；不实现 Manim，不扩展小数帧率，不在本批优化 PSNR 比对缓存。
- 不承诺识别声音与画面内容是否表达同一件事；词级同步属于后续 FR-3。

## 文件与职责

- core/timing.mjs：帧时间轴、ffprobe 验证、报告及来源签名。
- core/job.mjs、cache.mjs：任务帧分配、缓存失效、拼接和动态分镜校验。
- pipelines/browser/index.mjs、remotion/{entry,index}.mjs：服从分配帧数，代理输出精确帧长。
- core/qc.mjs、approval.mjs、bin/wka.mjs：QC、主版保护、字幕与输出的校验门槛。
- 管线 README、模板和 director：新约定与报告交付说明。
- tests/unit/{timing,remotion-entry}.test.mjs、tests/integration/timing.test.mjs：纯函数及真实媒体回归。

## 任务

1. **统一分配**：先在 remotion-entry 加 107 镜用例，运行 `node --test tests/unit/remotion-entry.test.mjs` 确认累计帧数错误；实现 buildFrameTimeline 和管线帧参数；增加边界/零帧/整数 fps 测试；运行对应测试通过后提交。
2. **媒体校验**（依赖1）：先写真实错误帧数与抵消偏差测试，确认缺少检查；实现片段、拼接、来源签名和报告；运行 `node --test tests/unit/timing.test.mjs tests/integration/timing.test.mjs` 验证后提交。
3. **流程接入**（依赖2）：先覆盖 QC 旧来源、输出被截短、定稿保护和动态分镜；接入生产链、更新文档；运行相关集成测试后提交。
4. **验收**：运行 `npm test`、`npm run lint`、`npm run smoke`，并执行两条管线的 107 镜主副版/高清小样实测矩阵、解码检查实际切点。检查旧定稿与 film.json 不变，记录失败与跳过，不重录冒烟基准。更新 issue，提交验证结果。

每个任务均遵守“失败测试 → 确认失败原因 → 最小实现 → 确认通过 → 提交”；遇到设计变化先回写 spec 并按规则处理。
