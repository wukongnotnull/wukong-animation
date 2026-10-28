# 横竖双版（主版 + 副版画幅）实施计划

- spec：`docs/wukong-code-project/specs/2026-10-28-1826-aspect-variants-design.md`（#89）
- 目标：同一部片用同一套镜头和声轨，在主版定稿后出副版画幅，主版画面有据可查地不变，并接入 director 第 14 道「改版」。
- 架构：新模块 `core/variants.mjs` 把「当前画幅」解析成一份变体描述（尺寸、后缀、各类路径、覆盖项）；`loadFilm(filmDir, { aspect })` 据此改写尺寸、镜头文件和字幕样式，渲染、静帧、质检、字幕、成片都从 `ctx.variant` 取路径。定稿快照与主版不变比对放在新模块 `core/approval.mjs`，进度里的签批记录由 `state.mjs` 读写。
- 技术栈：Node 20（node:test）、ffmpeg（`psnr` 滤镜）、Playwright Chromium、Remotion。

## 全局约束（摘自 spec）

- 没有 `variants` 的片子行为、路径、缓存、测试基准图都不变；旧进度自动迁移。
- 副版只在主版第 13 道签批之后做；不能有自己的镜头表、时长、声轨或译文。
- 这次只实现并测试 16:9 ↔ 9:16；1:1 数据结构允许但不测试。
- 主版永远不用覆盖文件；主版路径全部不变。

## 实现时的三处细化（spec 没写到这个粒度，按 spec 原意落地）

- **副版英文**：英文稿是按中文字幕条一一对应的（`subtitles.en.json`），副版中文拆条不同。做法：按人声句把主版英文合并成一句，再按副版各条中文的字数比例在英文词边界切开，写成 `subtitles.en.<后缀>.json` 作为副版英文稿（可手改；`attachEnglish` 照旧校验）。不重新翻译。
- **副版尺寸**：spec 3.1 已改为「按主版短边等比推出」：主版 1920×1080 时副版就是 1080×1920，与 spec 一致；集成测试用 320×180 的小片时副版是 180×320，测试才跑得快。
- **剪映草稿名**：现在草稿名取自 `timeline.title`；副版传 `<title>-<后缀>`，与 spec 3.5 表一致。

## 文件

| 文件 | 职责 |
| --- | --- |
| `plugin/engine/core/variants.mjs`（新） | `aspectOf(size)`、`orientationOf(size)`、`suffixOf(aspect)`、`sizeOf(aspect)`、`resolveVariant(film, style, aspect)` → `{ aspect, isMain, size, suffix, cacheDir, stillsDir, review(name), subtitlesFile, enFile, exportName, title, overrides }`、`overrideShotPath(shotPath, suffix)`、`listAspects(film)` |
| `plugin/engine/core/job.mjs` | `loadFilm` 接 `aspect`；渲染、静帧、动态分镜、导出读 `ctx.variant` 的路径 |
| `plugin/engine/core/cache.mjs` | `ShotCache` 接缓存目录参数（缺省 `.cache/`） |
| `plugin/engine/core/subtitles.mjs` | `subtitleSettings(film, variant)`；`splitEnglishForVariant(mainPairs, mainSubs, variantSubs)` |
| `plugin/engine/core/qc.mjs` | 读 `ctx.variant.cacheDir`；`qcConfig(style, aspect)` 合并 `qc.by_aspect` |
| `plugin/engine/core/state.mjs` | 工序 15 道、节点 12 个、`FLOW` 3 → 4 迁移；`recordApproval`、`variantStale` |
| `plugin/engine/core/approval.mjs`（新） | `snapshotMain(filmDir)`（第 13 道签批）；`checkMainUnchanged(filmDir, { aspect })` → 报告；`psnrMin(a, b)` |
| `plugin/engine/pipelines/browser/index.mjs`、`plugin/engine/runtime/wk.js` | `cfg.aspect`、`cfg.orientation` → `s.aspect`、`s.orientation` |
| `plugin/engine/pipelines/remotion/entry.mjs` | `s.aspect`、`s.orientation` |
| `plugin/engine/schemas/film.schema.json`、`style.schema.json` | `variants`；`qc.by_aspect` |
| `plugin/engine/bin/wka.mjs`、`bin/args.mjs` | 六个命令的 `--aspect`、`final --aspect all`、签批第 13 / 14 道的快照与记录、`status` 提示过期 |
| `plugin/skills/keynote/scripts/shot.tsx` | 改读 `s.orientation` |
| PR 2：`plugin/skills/director/SKILL.md`、`specs/BRIEF.md`、`specs/FILM.md`、`specs/STORYBOARD.md`、`references/GLOSSARY.md`、`references/CHANGELOG.md`；`engine/templates/brief.md`、`templates/style-skill/STYLE.md`；keynote、ink-wash 的 `STYLE.md`；`docs/ARCHITECTURE.md`；《七十二变》`film.json` 与需要的竖屏分支；`tests/smoke/run.mjs` 与 `baseline/<平台>/keynote/qishier-9x16/` | 流程、文档、示范片、冒烟 |
| 测试（新）：`tests/unit/variants.test.mjs`、`tests/unit/approval.test.mjs`、`tests/integration/variants.test.mjs`；（改）`tests/unit/state.test.mjs`、`subtitles.test.mjs`、`qc-judge.test.mjs`、`remotion-entry.test.mjs`、`keynote-frame.test.mjs`、`templates-structure.test.mjs` | 见各任务 |

命令约定：单测 `node --test tests/unit/<文件>`；全量 `npm test`；`npm run lint`；`npm run smoke`。

## PR 1：引擎（分支 `feat/aspect-variants`）

每个任务按「写失败的测试 → 运行确认失败 → 最小实现 → 运行确认通过 → 提交」做，提交信息 `feat(engine): …` / `test: …`，正文 `Refs #89`。

### 任务 1：画幅工具与变体解析

- 测试 `tests/unit/variants.test.mjs`：
  - `aspectOf([1920,1080])` = `'16:9'`、`[1080,1920]` = `'9:16'`、`[1080,1080]` = `'1:1'`；`orientationOf` 对应 `landscape` / `portrait` / `square`。
  - `suffixOf('16:9')` = `'16x9'`；`sizeOf('9:16', [1920,1080])` = `[1080,1920]`、`sizeOf('9:16', [320,180])` = `[180,320]`。
  - `resolveVariant(film, style)`（不传画幅）= 主版：`cacheDir` 为 `<片>/.cache`、`review('小样.mp4')` = `review/小样.mp4`、`subtitlesFile` = `film.subtitles.file || 'subtitles.srt'`、`exportName` = `export.name`。
  - `resolveVariant(film, style, '9:16')`（`variants: {'9:16': {}}`）：`size` `[1080,1920]`、`cacheDir` `.cache/9x16`、`stillsDir` `stills/9x16`、`review('小样.mp4')` = `review/小样-9x16.mp4`、`subtitlesFile` `subtitles.9x16.srt`、`enFile` `subtitles.en.9x16.json`、`exportName` `<name>-9x16`、`title` `<title>-9x16`。
  - 覆盖项：`variants['9:16'].export.name` 生效；`subtitles.style` 合并。
  - 报错：画幅等于主版；不在 `variants`；主版或副版画幅不在 `style.aspects`（错误信息列出支持的画幅）；写法不是 `W:H`。
  - `overrideShotPath('shots/s03.tsx', '9x16')` 在文件存在时返回 `shots/s03.9x16.tsx`，不存在时返回原路径。
  - `listAspects(film)` = `[主版, ...副版]`。
- 实现 `core/variants.mjs`。
- 预期：`node --test tests/unit/variants.test.mjs` 全过。

### 任务 2：`film.json` / `style.json` schema

- 测试（加进 `variants.test.mjs`）：带 `variants: {'9:16': {}}` 的 film 通过 `validate('film', …)`；`variants: {'9:16': {foo: 1}}` 不通过；style 带 `qc.by_aspect: {'9:16': {accent_max: 5}}` 通过。
- 实现：两个 schema 加字段（`variants` 的键限定 `^\d+:\d+$`，值只允许 `subtitles.style`、`export.name`）。

### 任务 3：`loadFilm` 接画幅，镜头拿到 `s.aspect` / `s.orientation`

- 测试：
  - 单元（`variants.test.mjs`）：`loadFilm(dir, { aspect: '9:16' })` 的 `film.size` 为 `[1080,1920]`、有 `shots/s01.9x16.js` 时 `shots[0].path` 指向它、`ctx.variant.isMain` 为 false；不传 `aspect` 时 `ctx.variant.isMain` 为 true，其余与现在相同。
  - `remotion-entry.test.mjs`：生成的入口里 `s` 带 `aspect`、`orientation`。
  - `keynote-frame.test.mjs`：`shot.tsx` 按 `s.orientation` 选 `FrameProvider`。
- 实现：`job.mjs` 的 `loadFilm` 调 `resolveVariant` 并替换 `size`、镜头路径、字幕样式；browser `config` 和 `wk.js` 的 `baseState` 加 `aspect`、`orientation`；remotion `entry.mjs` 同上；keynote `shot.tsx` 改读 `s.orientation`。

### 任务 4：按画幅分开缓存与产物

- 测试 `tests/integration/variants.test.mjs`（沿用 `render.test.mjs` 的 `makeFilm` 写法，缺依赖时跳过；ink-wash 片，主版 320×180，`variants: {'9:16': {}}` 时副版尺寸用 `sizeOf` 按比例缩到与主版同一短边，测试里用 180×320）：
  - `wka render <片>` 的输出与现在相同（`.cache/video.mp4`，片段在 `.cache/segments/`）。
  - `wka render <片> --aspect 9:16`：片段在 `.cache/9x16/segments/`、`.cache/9x16/video.mp4` 尺寸 180×320；主版缓存文件未被改动。
  - `--proxy` 时小样写到 `review/小样-9x16.mp4`。
  - `wka still <片> --aspect 9:16` 写 `stills/9x16/`；`animatic` 写 `review/动态分镜-9x16.mp4`、`review/接触表-9x16.jpg`。
  - 有 `shots/s01.9x16.js` 时副版用它（画面颜色不同可验），主版不用它。
  - `--aspect 4:3`、`--aspect 9:16`（无 `variants`）都失败并给出可用值。
- 实现：`ShotCache(filmDir, dir)`；`createRenderJob` 的 `workDir`、`render` 的 `video`、`stills` 的输出目录、`animatic` 的审阅文件名都改从 `ctx.variant` 取；`wka.mjs` 的 `render` / `still` / `animatic` 解析 `--aspect` 并传下去；`args.mjs` 的 `VALUE_OPTS` 已含 `aspect`，不用改。
- 副版尺寸按上文「三处细化」：`sizeOf(aspect, mainSize)` 按主版短边等比推出。

### 任务 5：副版字幕

- 测试 `subtitles.test.mjs`：
  - `subtitleSettings(film, variant9x16)`：`file` `subtitles.9x16.srt`、`maxChars` 12、`maxCharsEn` 28；主版不变。
  - `splitEnglishForVariant`：一条人声主版切 2 条（各配英文），副版切 3 条 → 副版英文 3 条，拼起来等于主版英文按空格合并，切点落在词边界；中文字数比例大致对应。
  - 主版某条英文为空时，副版对应条为空（`attachEnglish` 会报待填）。
- 集成（`variants.test.mjs`）：`wka subtitles <片> --aspect 9:16` 写 `subtitles.9x16.srt`（条数多于主版）和 `subtitles.en.9x16.json`；已存在且不加 `--force` 时只检查不覆盖。
- 实现：`subtitleSettings` 加 `variant` 参数；`splitEnglishForVariant`；`cmdSubtitles` 接 `--aspect`，`--preview` 读 `.cache/<后缀>/video-proxy.mp4`、写 `review/字幕预览-<后缀>.mp4`。

### 任务 6：副版质检

- 测试 `qc-judge.test.mjs`：`qcConfig(style, '9:16')` 合并 `qc.by_aspect['9:16']`，主版不受影响；没有 `by_aspect` 时两版相同。
- 集成：`wka qc <片> --aspect 9:16 --proxy` 读 `.cache/9x16/video-proxy.mp4`，写 `.cache/9x16/qc.json`、`stills/9x16/qc/`。
- 实现：`qc.mjs` 抽出 `qcConfig`，`runQc` 接 `aspect`。

### 任务 7：进度 15 道与迁移

- 测试 `state.test.mjs`（改现有断言）：
  - `LAST_STEP` 15；`PRODUCTION_STEPS[14]` = `'改版'`、`[15]` = `'剪映草稿交付'`；`REVIEW_GATES` 12 个，`14` = `'⑪改版审片'`、`15` = `'⑫剪映草稿'`。
  - flow 3 进度里 `step: 14`（剪映草稿）迁成 15，节点标签换新；`step: 13` 不变；flow 1 进度一路迁到 flow 4（第 11 道起 +1，再第 14 道起 +1）。
  - `migrateProgress` 不改入参。
- 实现：`state.mjs` 改常量、`FLOW = 4`、迁移函数按 flow 分段平移。

### 任务 8：定稿快照、主版不变比对、副版过期

- 测试 `tests/unit/approval.test.mjs`：
  - `recordApproval(filmDir, { main })` 写 `state.approved.main`；再次写入时所有 `approved.variants.*` 被标过期（`variantStale(state, '9:16')` 为 true）。
  - `recordApproval(filmDir, { variant: '9:16', shots, main })` 后 `variantStale` 为 false。
  - `psnrMin(a, a)` 为 `Infinity`；两段颜色不同的短视频 `< 50`。
- 集成（`variants.test.mjs`）：
  1. 渲染主版 → `wka signoff <片> "终审通过" --step 13`：`state.json` 有 `approved.main`，`.cache/approved/` 有每镜片段。
  2. 不改代码 `wka render <片> --aspect 9:16`：报告 `review/主版不变报告-9x16.md` 写全部镜头「哈希相同」。
  3. 给 `s01` 加只影响竖屏的分支（`if (s.orientation === 'portrait') …`）再渲染副版：报告里 s01 为「重渲比对通过，PSNR inf」。
  4. 改 s01 的横屏画面：报告置顶写「主版有变化」，列出 s01 和最低 PSNR，命令仍成功。
  5. 删 `.cache/approved/` 后：报告列出需目视复核的镜头。
  6. `wka signoff --step 14` 后再 `--step 13`：`wka final <片> --aspect 9:16` 失败并提示重做第 14 道；`wka status` 显示副版过期。
- 实现：
  - `approval.mjs`：`snapshotMain` 用主版 `createRenderJob` 算每镜哈希（复用 `shotHash`，从 `job.mjs` 导出），复制 manifest 里的全分辨率片段到 `.cache/approved/`；`checkMainUnchanged` 比哈希，变了的镜头用 `render(filmDir, { only })` 重渲主版后 `psnrMin` 比对，写报告。
  - `psnrMin`：`ffmpeg -i a -i b -lavfi psnr=stats_file=… -f null -`，取每帧 `psnr_avg` 的最小值（`inf` 记 `Infinity`）。
  - `wka.mjs`：`signoff --step 13` 后调 `snapshotMain` 并 `recordApproval({ main })`；`--step 14` 记录各副版哈希；带 `--aspect <副版>` 的 `render` / `still` / `final` 先 `checkMainUnchanged`（没有 `approved.main` 时提示「主版还没在第 13 道签批」并继续）；`final` 遇过期副版失败；`status` 打印过期副版。

### 任务 9：`final --aspect` 与剪映草稿

- 测试 `variants.test.mjs`：
  - `wka final <片> --aspect 9:16 --proxy`（`subtitles.mode: burn`）写 `<name>-9x16_有字幕-proxy.mp4`，尺寸为竖屏。
  - `--aspect all` 依次出主版和副版。
  - `jianying-plan.test.mjs`：副版 timeline 的 `title` 为 `<title>-9x16`，`size` 为竖屏。
- 实现：`cmdFinal` 接 `aspect`，字幕、导出名、外挂 srt 名、timeline 的 `title` / `size` 都从 `ctx.variant` 取；`all` 时按 `listAspects` 循环。

### 任务 10：收尾

- `npm run lint`、`npm test`、`npm run smoke` 全过（主版基准图不变）。
- 用 code-reviewer 审一遍，处理 CRITICAL / HIGH。
- 开 PR 1：描述链接 spec 与本计划，按 spec 验收 2、3、4、5 条逐条说明（第 1 条在 PR 2），`Refs #89`。

## PR 2：流程、风格文档与示范片（PR 1 合并后从 main 开分支 `feat/aspect-variants-flow`）

### 任务 11：director 与简报

- 测试：`templates-structure.test.mjs` 现有的「规范说明表与模板逐项对应」随 BRIEF / FILM / STORYBOARD 改动更新，先改测试确认失败。
- 文档：
  - `director/SKILL.md`：命令表加 `--aspect`；工序总表、流程图、审片节点总表改 15 道 / 13 节点；新增「第 14 道 · 改版」细则（spec 3.11）；剪映草稿改第 15 道并说明双版各导一份；无副版时 `--step 14` 记「跳过」。
  - `specs/BRIEF.md`、`templates/brief.md`：画幅项改「主画幅 + 可选副版」与推荐规则。
  - `specs/FILM.md`：`variants` 字段。`specs/STORYBOARD.md`：「副版重排」表格式。
  - `references/GLOSSARY.md`：主版、副版、改版、覆盖文件、主版不变报告；`references/CHANGELOG.md` 记一笔。
- 预期：`npm run lint`、`npm test` 通过。

### 任务 12：风格文档

- `templates/style-skill/STYLE.md` 加必填段「画幅重排规则」（横转竖、竖转横）；如有对应检查（`style-sections.test.mjs`），先加断言确认失败。
- keynote `STYLE.md` / `TECH.md`：写两个方向的重排规则（L01–L07 横竖对照已有，补竖转横时的留白处理）和 `s.orientation` 用法；ink-wash `STYLE.md` 补「画幅重排规则」。
- `docs/ARCHITECTURE.md`：用户目录结构加副版路径，数据流加「改版」。

### 任务 13：《七十二变》双版示范与冒烟

- `examples/qishier/film.json` 加 `"variants": { "9:16": {} }`；需要时给镜头加竖屏分支或覆盖文件。
- `tests/smoke/run.mjs`：示范片有 `variants` 时，副版也按同样的取帧点 `wka still --aspect … --proxy`，基准图放 `baseline/<平台>/keynote/qishier-9x16/`。
- 手动：`wka final <片> --aspect all` 出两版成片并目视；主版成片与改动前逐帧比对一致（验收第 1 条）。
- 生成 darwin 基准图；linux 基准图按以前的做法在 CI 产出后提交。

### 任务 14：收尾

- `npm run lint`、`npm test`、`npm run smoke` 全过；code-reviewer 审一遍。
- 开 PR 2：按 spec 验收第 1 条说明，`Closes #89`。
