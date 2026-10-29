# remotion 管线（experimental）

调用 Remotion（React）渲染字幕密集、模板化的镜头：每个镜头是一个 React 组件，打包一次后逐镜输出无声 H.264 片段。
接口与 browser 管线一致：`check()` / `renderShots(job, todo, {onDone})` / `renderStills(job, points, outDir)`，引擎负责缓存、拼接、混音、字幕和导出。

## 许可

Remotion 不是 MIT 许可：**个人和不超过 3 人的公司免费，更大的公司需要购买公司授权**（见 <https://www.remotion.dev/license>）。用到 remotion 风格（如 keynote）前请确认自己符合条件。

## 镜头写法

`shots/sNN.tsx` 默认导出一个组件，props 为 `{ dur, s }`：

- `dur`：本镜帧数（全片累计切点的相邻差，不是逐镜独立取整）。
- `s`：`{ id, W, H, designW, designH, fps, seed, cues, duration, start }`。`W/H` 是**设计尺寸**；小样由 `renderMedia` 的 `scale` 缩小，组件不用管。

组件只能依赖 `useCurrentFrame()` 和 props（Remotion 的约束）。风格 `scripts/` 里的 `index.ts(x)` 用 `@wka/style` 引用；片目录里的文件用 `@wka/film/<路径>` 引用。风格 `index` 若导出 `ShotRoot`，每个镜头都会包在它里面（放背景、几何上下文等）。

## 实现要点

| 环节 | 做法 |
|---|---|
| 入口 | `entry.mjs` 的 `buildEntry` 生成 `.cache/work/remotion-*/index.jsx`，每镜一个 Composition（设计尺寸、`film.fps`） |
| 字体 | 引擎 `prepareFonts` 的 `file://` 字体复制进打包的 public 目录，`WkaShot` 等字体加载完再出第一帧 |
| 静态文件 | 风格的 `assets/` 复制到 public 的 `assets/`，组件用 `staticFile('assets/…')` |
| 依赖 | `react`、`react-dom`、`remotion` 用别名钉成同一份（`core/deps.mjs` 的 `resolveDep`） |
| 浏览器 | 用 playwright 同版本的 chromium headless shell；找不到时 Remotion 自行下载（约 170 MB） |
| 小样 | `scale` 0.5，按 `film.fps` 的累计切点渲染，再用 ffmpeg 降帧并精确匹配代理帧时间轴；仅允许补足最多两帧镜尾画面 |
| 失败 | 先写 `.part.mp4`，成功才改名；报错带镜头 id 和文件名 |

## 时间轴检查

镜头时长与声音 cue 保留原始秒数。引擎按当前输出 fps 量化全片切点，相减得到每镜帧数；零帧镜头报错，不静默补成一帧。新片段、命中缓存与拼接视频均检查真实帧数和时间戳，错误结果不进入后续交付。`review/时间轴检查*.md` 是可交付的报告，`.cache/timing*.json` 是来源记录；旧工程先重新渲染建立记录。视频时间轴通过不代表旁白语义或关键词同步通过。

## 词首显现

片级 sync-points.json 可声明 manual/aligned/estimated 词点。使用 `const at = s.cueFrame("word:material-available")`，再比较 useCurrentFrame；不要额外乘 fps。该帧入口适配输出切点与代理采样，动画仍以原生 film.fps 运行。来源状态、词首前当后帧和人声片段交付到 review/词级同步*.md；来源有效不代表实际画面响应已经由机器证明。
