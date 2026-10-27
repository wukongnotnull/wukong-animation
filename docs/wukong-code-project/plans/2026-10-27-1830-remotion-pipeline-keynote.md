# remotion 管线与第 70 变 keynote 实施计划

spec：[2026-10-27-1804-remotion-pipeline-keynote-design.md](../specs/2026-10-27-1804-remotion-pipeline-keynote-design.md) · issue [#36](https://github.com/wukongnotnull/wukong-animation/issues/36)

**目标**：实现 remotion 管线，并把 wk-motion-graphics 的视觉组件与规范移植成第 70 变 keynote。

**架构**：管线生成每镜一个 Composition 的入口，用 `@remotion/bundler` 打包一次，`@remotion/renderer` 逐镜渲染无声片段交给引擎；缓存、拼接、混音、字幕、导出沿用现有引擎。keynote 风格以 TSX 组件形式放在 `scripts/`，镜头通过 `@wka/style` 引用。

**技术栈**：Node 20、remotion / @remotion/bundler / @remotion/renderer 4.0.539、React 19.3.1、ffmpeg、`node --test`。

**全局约束（摘自 spec）**：

- 不改 `job.mjs` 的调度、缓存、拼接逻辑；不改 browser 管线和水墨风格的任何输出（冒烟基准图不变）。
- Remotion 许可写进管线 README、keynote SKILL.md 和 README。
- 远端 `wk-motion-graphics` 不改、不删。

## 文件

| 文件 | 职责 |
|---|---|
| `plugin/engine/pipelines/remotion/entry.mjs` | 纯函数：`buildEntry(job)`、`rewriteFontCss(css)`、`webpackAliases(job)` |
| `plugin/engine/pipelines/remotion/index.mjs` | `check` / `renderShots` / `renderStills` |
| `plugin/engine/pipelines/remotion/pipeline.json`、`README.md` | 状态 experimental、依赖、许可 |
| `plugin/engine/package.json`、`package-lock.json` | 加 remotion 依赖 |
| `plugin/engine/core/fonts.mjs` | `KNOWN_FONTS` 加 Inter、JetBrains Mono |
| `plugin/engine/bin/wka.mjs` | `init` 按管线选镜头模板 |
| `plugin/skills/director/templates/film/shots/s01.tsx`、`SHOT.md` | remotion 镜头模板与写法 |
| `plugin/skills/keynote/**` | 风格 skill、组件、背景图、示范片 |
| `tools/plan72.json`、`plugin/catalog.json`、`README.md`、`docs/ARCHITECTURE.md` | 目录与文档 |
| `tests/unit/remotion-entry.test.mjs`、`tests/unit/keynote-style.test.mjs`、`tests/integration/remotion.test.mjs` | 测试 |

## 任务

### 1. 依赖与浏览器验证

- 把 remotion 依赖写进 `engine/package.json`，`npm install` 到引擎目录和 `~/.wukong-animation/deps/0.1.0/`。
- 写一次性脚本：最小 Composition，用 playwright 的 Chromium 作 `browserExecutable` 渲染 1 帧。结果写回 spec 第 6 节。
- 提交：`chore: 引擎加入 remotion 依赖`。

### 2. entry.mjs（纯函数）

- 写 `tests/unit/remotion-entry.test.mjs`（spec 验收 1、2）→ `node --test tests/unit/remotion-entry.test.mjs` 失败。
- 实现 `entry.mjs` → 通过。提交。

### 3. 管线 check / renderShots / renderStills

- 写 `check()` 缺依赖单测（验收 3）与 `tests/integration/remotion.test.mjs`（验收 6–9，缺依赖跳过）→ 失败。
- 实现 `index.mjs`，`pipeline.json` 改 experimental → 通过。提交。

### 4. keynote 风格

- 写 `tests/unit/keynote-style.test.mjs`（验收 4）→ 失败。
- 移植 theme / frame / lib / components，写 SKILL / STYLE / TECH / style.json，复制 grid.jpg → 通过；集成测试改用 keynote 组件仍通过。提交。

### 5. init 与镜头模板

- 在 `tests/integration` 或单测里加 `wka init --style keynote` 用例（验收 5）→ 失败 → 实现 → 通过。提交。

### 6. 目录与文档

- plan72 改 keynote 管线；`node tools/build-catalog.mjs`、`node tools/build-docs.mjs`、`node tools/lint.mjs` 通过；README 进度、ARCHITECTURE 更新。提交。

### 7. 示范片与全量验证

- 做 10–15 秒示范片，`wka render` → `wka final` → `wka qc`；定 qc 阈值；看联系表（验收 10、11）。
- 跑全部单元、集成、冒烟测试（验收 12）。提交。
