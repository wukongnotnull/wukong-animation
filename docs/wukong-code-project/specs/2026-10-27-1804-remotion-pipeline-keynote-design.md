# remotion 管线与第 70 变 keynote 设计

关联 issue：[wukongnotnull/wukong-animation#36](https://github.com/wukongnotnull/wukong-animation/issues/36)

## 1. 问题与目标

用户在 wukong-self-media 仓库里有一个已用于多支成片的 skill `wk-motion-graphics`：Remotion（React）工程，Keynote 发布会风格的讲解动画。要把它的画风和组件变成本项目的一个风格 skill。

已确认的决定：

- 名字用 72 变清单预留的第 70 变 `keynote`（发布会 Keynote，`xinxi` 信息叙事）。
- 走 remotion 管线：先实现 `engine/pipelines/remotion`（现在是 `status: planned` 的占位），再把远端 template 的视觉组件和规范移植成 `plugin/skills/keynote`。
- `tools/plan72.json` 里 keynote 的管线由 `browser + svg-gsap` 改为 `remotion`、工具包为空。

目标：

1. `film.json` 的 `style` 为 `keynote` 时，`wka render / stills / animatic / final` 全部可用，镜头缓存、拼接、混音、字幕层、导出器（mp4 / gif / jianying）沿用现有引擎，不需要为 remotion 改写。
2. `wka list styles` 中 keynote 显示为可用（第 2 变），README 进度 2 / 72。
3. `plugin/skills/keynote/examples/` 带一支 10–15 秒、16:9 的示范片，`wka qc` 全部通过。

已核实的事实（2026-10-27）：

- npm 上 `remotion` / `@remotion/renderer` 最新为 4.0.539，`react` 19.3.1；远端 template 用 `^4.0.538` + React 19。
- 引擎的管线接口为 `check()` / `renderShots(job, todo, {onDone})` / `renderStills(job, points, outDir)`（`pipelines/browser/index.mjs`、`pipelines/remotion/README.md`），镜头片段由引擎负责缓存、拼接、混音和导出。
- `resolver.mjs` 拒绝 `status: planned` 的管线；`job.mjs` 的镜头哈希包含管线名与版本、`style.json` 的 `scripts`、`film.json` 的 `scripts` 和镜头文件内容。
- 字体由 `core/fonts.mjs` 下载并子集化，产出的 `@font-face` 使用 `file://` 路径；`KNOWN_FONTS` 已有 Noto Sans SC，没有 Inter 和 JetBrains Mono（google/fonts 仓库里都是 OFL）。
- 字幕由 `core/subtitle-layer.mjs` 渲染成透明 PNG 后叠加，不进镜头缓存，与管线无关。
- `wka setup` 把 `engine/package.json` 的 `dependencies` 装到 `~/.wukong-animation/deps/<版本>/`。
- Remotion 的许可：个人和不超过 3 人的公司免费，更大的公司需要购买公司授权（remotion.dev/license）。

## 2. 架构与组件边界

```
job.mjs（不改调度逻辑）
  └─ pipelines/remotion/index.mjs
        ├─ entry.mjs     buildEntry(job) 纯函数：job → 入口源码（每镜一个 Composition）
        ├─ bundle        @remotion/bundler：入口 + 别名 → 一次打包，整个任务共用
        ├─ renderShots   @remotion/renderer.renderMedia：每镜一个无声 H.264 片段 → todo[i].out
        └─ renderStills  @remotion/renderer.renderStill：PNG
plugin/skills/keynote/
  ├─ SKILL.md · STYLE.md · TECH.md · style.json
  ├─ scripts/            风格组件（TSX），镜头里 import from '@wka/style'
  ├─ assets/grid.jpg     深色透视网格背景（来自远端 template/public/bg）
  └─ examples/<示范片>/
```

- 新文件：`pipelines/remotion/entry.mjs`、`plugin/skills/keynote/**`、`tests/unit/remotion-entry.test.mjs`、`tests/integration/remotion.test.mjs`。
- 改动文件：`pipelines/remotion/{index.mjs, pipeline.json, README.md}`、`engine/package.json`（加依赖）、`core/fonts.mjs`（`KNOWN_FONTS` 加两行）、`bin/wka.mjs`（`init` 按管线选镜头模板，见 3.5）、`skills/director/templates/film/shots/s01.tsx`（新增）、`skills/director/SHOT.md`（加 remotion 镜头写法一节）、`tools/plan72.json`、`plugin/catalog.json`（由脚本生成）、`README.md`、`docs/ARCHITECTURE.md`（插槽表、依赖、许可说明）。
- browser 管线、工具包、导出器、字幕层、音频模块不改。

## 3. 接口、数据与行为

### 3.1 镜头文件

remotion 风格的镜头是 `shots/sNN.tsx`，默认导出一个 React 组件：

```tsx
import { SceneShell, Headline, useFrameSpec } from '@wka/style';
import type { ShotProps } from '@wka/style';

export default function S01({ dur, s }: ShotProps) {
  const f = useFrameSpec();
  return (
    <SceneShell dur={dur}>
      <Headline text="仓库在，[记忆]就在" box={f.layout.L01.phrase} style="T01" />
    </SceneShell>
  );
}
```

- `ShotProps`：`dur`（本镜帧数）、`s`（`{ id, W, H, designW, designH, fps, seed, cues, duration, start }`，与 browser 管线传给 `render` 的 `s` 字段同名同义）。
- 组件必须只依赖 `useCurrentFrame()` 和 props（Remotion 本身的约束，等同 browser 管线“render 是 t 的纯函数”）。
- `film.json` 的 `scripts` 里列出的 `.ts/.tsx` 文件可在镜头中用 `@wka/film/<文件名>` 引用（片子自己的公共组件）。

### 3.2 入口生成（entry.mjs，纯函数）

`buildEntry(job)` 返回入口源码字符串，写到 `job.workDir/remotion/index.tsx`：

- 每个镜头注册一个 `Composition`：`id` = 镜头 id，`durationInFrames = Math.max(1, Math.round(duration × film.fps))`，`fps = film.fps`，`width/height = designW/designH`。
- 每个 Composition 外包一层 `WkaRoot`：注入字体 CSS，用 `delayRender` 等 `document.fonts.ready` 后再出第一帧；提供 `FrameProvider`（横竖由 designW/designH 判断）。
- 别名：`@wka/style` → 风格目录 `scripts/index.ts`；`@wka/film/*` → 片目录。模块解析追加 `~/.wukong-animation/deps/<版本>/node_modules` 和引擎自身 `node_modules`（片目录没有 node_modules）。

### 3.3 打包与渲染

- 打包：`bundle({ entryPoint, webpackOverride, publicDir })`，每次 `renderShots` / `renderStills` 调用只打包一次。`publicDir` 为 `job.workDir/remotion/public/`：放风格 `assets/` 和本次用到的子集字体文件；字体 CSS 里的 `file://` 路径改写成 `staticFile()` 地址（打包后的页面走 http，读不到 `file://`）。
- 浏览器：优先把 playwright 已装的 Chromium 传给 `browserExecutable`；Remotion 不接受时退回它自己的 `ensureBrowser()` 下载（见 6 的验证项）。
- 每镜：`selectComposition` → `renderMedia({ codec: 'h264', muted: true, crf: proxy ? 23 : 16, scale: job.W / job.designW, outputLocation: out + '.part' })`，成功后改名为 `out`；失败删 `.part` 并抛出带镜头 id 的错误（与 browser 管线一致）。
- 并行：同一时间一个 `renderMedia`，其内部用 `concurrency`（默认 `WKA_WORKERS`，否则 `min(2, CPU 数)`）；任一镜头失败后不再开始新的镜头。
- 小样：`scale` 0.5；Remotion 按 `film.fps` 渲染后，用 ffmpeg 把片段转成 `job.fps`（半帧率），使所有片段帧率与 browser 管线的小样一致。
- 静帧：`renderStill({ frame: Math.round(t × film.fps), scale, output })`，文件名与 browser 管线相同（`<id>-<t>s.png`）。
- 进度：`onProgress` 每 25% 打一行日志，格式与 browser 管线相同。

### 3.4 check()

缺 `@remotion/bundler`、`@remotion/renderer`、`react`、`react-dom`、`remotion` 中任一项，或缺 ffmpeg，返回 `ok: false` 和缺失清单，提示运行 `/wukong-animation:setup`。

`pipeline.json`：`version` 0.1.0，`status` 改为 `experimental`，`requires` 改为 `["node", "ffmpeg", "remotion"]`。

### 3.5 依赖与 init

- `engine/package.json` 的 `dependencies` 加 `remotion`、`@remotion/bundler`、`@remotion/renderer`、`react`、`react-dom`，固定为 4.0.539 / 19.3.1（不用 `^`）。`wka setup` 照常安装，所有用户都会装上（约百 MB 级，体积在实现时实测后写进 README）。
- `wka init --style <id>`：风格管线为 `remotion` 时，复制模板后删除 `shots/s01.js`、改用 `shots/s01.tsx`，`film.json` 的 `shots[0].file` 同步改为 `shots/s01.tsx`。

### 3.6 keynote 风格

`style.json`：

- `id` keynote，`order` 70，`category` xinxi，`pipeline` remotion，`kits` {}，`fps` 30，`aspects` ["16:9", "9:16"]。
- `scripts` 列出 `scripts/` 下全部文件（进镜头哈希；单元测试保证不漏列）。
- 字体：Inter、Noto Sans SC、JetBrains Mono（`core/fonts.mjs` 的 `KNOWN_FONTS` 加 Inter 与 JetBrains Mono 两行）。
- `subtitles`：Noto Sans SC，白色，细描边加柔阴影，无底框（远端 style-defaults 的字幕规则）。
- `qc`：底色 `#111111`，强调色 `#D97757`，强调色占比上限、帧差、硬切阈值在示范片实测后定值写入。

从远端 template 移植进 `scripts/` 的内容：

| 远端 | 移植后 | 处理 |
|---|---|---|
| `theme.ts`、`frame.tsx` | 同名 | 横竖两套几何（安全区、T01–T09、L01–L07、`scene.detail`）原样保留；出镜小窗 `presenter` 字段保留但不使用 |
| `lib/anim.ts`、`geo.ts`、`stages.ts`、`cue.ts` | 同名 | 原样 |
| `components/` Backdrop、Headline、Copy（CuePoint / StepList）、MorphBox、Shot、Cursor、Guides、SceneShell | 同名 | 去掉对 `Sfx`、`timeline.ts`、`staticFile` 硬路径的依赖；Backdrop 背景图走 `publicDir` |
| `components/` Sfx、Soundtrack、Subtitles、Presenter | 不移植 | 声音归 `audio/build.mjs` + cues，字幕归引擎字幕层，出镜不在本次范围 |
| `components/GitLanes.tsx`、`scenes/ExampleScenes.tsx` | 不移植 | 项目专用示例，示范片里另写 |
| `references/design-spec.md`、`style-defaults.md`、`motion.md` | 写进 `STYLE.md` 九段 | 视觉、字号、版式、动效、声音（音效要稀）、禁忌（不做标题逐字符变形、不做进度条、强调色只用一个）、质检 |
| `references/components.md`、`ui-redraw.md` | 写进 `TECH.md` | 积木 API 与“用代码重绘界面”的做法 |

`SKILL.md`：一句话触发描述（发布会、产品讲解、知识讲解、口播类信息片）+ “流程按 director 执行”，与 ink-wash 结构一致。

## 4. 约束、兼容性与非目标

- 不改 `job.mjs` 的调度、缓存、拼接逻辑；不改 browser 管线和水墨风格的任何输出（冒烟基准图不变）。
- Remotion 许可写进 `pipelines/remotion/README.md`、keynote 的 `SKILL.md` 和 `README.md`：个人和 3 人以内公司免费，更大的公司需购买授权。
- 远端 `wk-motion-graphics` 不改，也不删。

非目标（本次不做，需要时另开 issue）：

- 口播流程：审口播稿、按 SRT 句子对齐场景（`scenes.json` / `sent()`）、临时 AI 配音粗剪流程。
- 出镜小窗、中英双语字幕、Mixkit 音效下载与试听、-14 LUFS 母带、按页增量渲染脚本（本引擎的镜头缓存已覆盖）。
- 横转竖的“横屏不变”比对工具；竖屏只保证几何可用，示范片只做 16:9。
- 其它 remotion 风格（`doc-subtitle`、`vertical-short`）。

## 5. 错误处理与运维

- 依赖缺失：`check()` 返回缺失清单，`wka check` 和渲染前都会提示，不进入打包。
- 打包失败（TSX 语法错误、找不到 `@wka/style` 导出）：错误信息包含出错文件路径和 webpack 的第一条错误，并说明是哪支片。
- 镜头渲染失败：消息格式 `镜头 <id> (<file>) 渲染失败：<原因>`，半成品 `.part` 删除，已完成的镜头已写入缓存，下次只重渲失败及之后未完成的镜头。
- 字体下载失败：沿用 `prepareFonts` 的退回逻辑（用 fallback 字体，日志说明）。

## 6. 验收标准与测试

单元测试（`node --test`）：

1. `buildEntry`：给定 3 个镜头的 job，生成源码中 Composition 的 id、帧数（含非整数秒四舍五入、最少 1 帧）、宽高正确；`@wka/style` 别名指向风格目录。
2. 字体 CSS 改写：`file://` 路径改为 `staticFile` 地址，文件被列入待复制清单。
3. `check()`：模拟缺少 `@remotion/renderer` 时返回 `ok: false` 且 `missing` 含该项。
4. keynote 的 `style.json` 通过 schema 校验，`scripts` 覆盖 `scripts/` 下全部文件。
5. `wka init --style keynote` 生成 `shots/s01.tsx`，`film.json` 指向它，没有残留 `s01.js`。

集成测试（需要依赖，缺依赖时跳过并说明）：

6. 2 镜、每镜 1 秒的 keynote 小片：`render` 产出片段时长与 `film.json` 一致（误差 ≤ 1 帧），第二次 `render` 两镜都缓存命中；改其中一镜文件只重渲那一镜。
7. 同一帧 `renderStill` 两次逐像素一致（确定性）。
8. 小样渲染片段为半分辨率、`job.fps` 帧率。
9. 镜头组件抛错时：报错含镜头 id，缓存目录没有 `.part` 残留。

手动验收：

10. 示范片在 `wka render` → `wka final` 后，联系表看得到深色网格背景、Inter + Noto Sans SC 字体、单一橙色强调、至少一处对象级神奇移动和一处 hold 衔接；`wka qc` 全部通过。
11. `wka list styles` 显示 `70  keynote  发布会 Keynote  信息叙事  remotion/`，不标“不可用”；README 进度 2 / 72。
12. 现有测试和冒烟测试全部通过，水墨基准图无变化。

已验证（2026-10-27，macOS arm64）：playwright 1.64.1 的完整版 Chromium（`chromium.executablePath()`，Chrome for Testing）作 `browserExecutable` 时页面无响应，不能用；它同时装的 `chromium_headless_shell-1248/chrome-headless-shell-<平台>/chrome-headless-shell` 可以，30 帧渲染正常。所以管线从 `chromium.executablePath()` 推出同版本 headless shell 的路径（把路径里的 `chromium-<rev>` 换成 `chromium_headless_shell-<rev>`，再找 `chrome-headless-shell[.exe]`）；找不到时不传 `browserExecutable`，由 Remotion 自行下载它的 Chrome Headless Shell（约 170 MB），日志里说明。`wka setup` 不用改（`playwright install chromium` 默认就装 headless shell）。
