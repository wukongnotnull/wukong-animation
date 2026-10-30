# 渲染性能实施计划

目标：减少日常渲染和验证的重复工作，同时保持完整交付检查与终稿品质。

架构：job 负责时间轴与增量调度；browser/remotion 直接按目标帧率输出；timing 复用内容验证；CLI 和 director 规定日常与整片入口。技术栈：Node.js、Remotion/React、Playwright、FFmpeg。

规范全局约束：平衡优先；终稿原定画质；整片仅按明确需求生成；缓存默认留存；流程可复用。

## 文件与交付顺序

1. `core/render-profile.mjs`、`job.mjs`、`timing.mjs`、`subtitle-preflight.mjs`、两条管线与 `word-sync.mjs`：统一输出规格、低并发、直接小样帧。先在 `tests/unit/render-performance.test.mjs` 加失败规格与入口测试，运行 `node --test tests/unit/render-performance.test.mjs` 确认失败，再实现并通过。
2. `core/timing.mjs` 与 QC/CLI 入口：按内容持久化验证、完整检查覆盖。先增加真实小视频的探测次数/损坏/跨进程测试，确认失败，再实现与回归 `tests/unit/timing.test.mjs`。
3. `core/fonts.mjs` 与 job：稳定字体输入、复用子集。先增加未变镜头哈希测试，再实现。
4. `core/job.mjs`、`bin/wka.mjs`、`core/cache.mjs`：局部预览与明确缓存清理。先在 `tests/integration/render-performance.test.mjs` 覆盖变更与未变片段、无全片、清理边界，再实现并验证。
5. `plugin/skills/director/SKILL.md`、README 与报告：更新日常默认流程；运行 `node --test --test-concurrency=1 tests/unit/*.test.mjs tests/integration/*.test.mjs`、`npm run lint`、适用 smoke 和 portable 构建。使用隔离样本做前后比较，保存结果，不改客户片子。

每步遵循失败测试 → 最小实现 → 定向通过；完成后统一检查 diff，记录尚未验证项并更新 #109。不发布版本或推送安装缓存。
