# 架构

## 仓库结构

```
wukong-animation/                          # GitHub 仓库
├── .agents/plugins/marketplace.json # Codex / ChatGPT 桌面来源，指向 ./plugin
├── .claude-plugin/marketplace.json   # Claude Code 来源，指向 ./plugin
├── plugin/                        # ★ 只有这里分发给用户
│   ├── plugin.json                # Agent Plugins 1.0：身份、展示、setup onboarding
│   ├── .codex-plugin/plugin.json   # Codex 兼容清单
│   ├── .claude-plugin/plugin.json
│   ├── catalog.json               # 自动生成：72 变索引
│   ├── skills/                    # 只有一层：skills/<id>/SKILL.md
│   │   ├── film/ setup/ styles/   # 跨宿主入口
│   │   ├── director/              # 通用流程
│   │   ├── new-style/
│   │   ├── ink-wash/              # SKILL · STYLE · TECH · style.json · scripts/ · examples/
│   │   └── keynote/               # 第 70 变，remotion 管线；scripts/ 是 TSX 组件
│   ├── commands/                  # Claude Code 入口：film · styles · setup
│   └── engine/
│       ├── bin/wka.mjs           # CLI
│       ├── templates/             # wka 用的模板：film/ · brief.md · style-skill/
│       ├── core/                  # 扩展时不改动
│       ├── schemas/               # style / film / pipeline / kit / exporter 的 JSON Schema
│       ├── runtime/               # 页面运行时（浏览器类管线共用）
│       ├── pipelines/  kits/  exporters/   # 三类插槽，各有 _template/
│       └── audio/                 # synth 合成器 · tts · mix
├── package.json                   # 维护命令入口：setup · test · smoke · lint · catalog（不分发、无依赖）
├── tools/                         # 维护脚本（不分发）
├── tests/smoke/                   # 冒烟测试 + 基准图（按平台分目录）
├── tests/unit/ tests/integration/ # node --test：cue 解析、AI 配音缓存、渲染失败清理
├── docs/                          # 画廊、本文件、贡献指南
└── .github/workflows/             # lint · smoke · agent-installation · jianying（真实导出必跑）
```

用户机器上：

```
~/.wukong-animation/
├── deps/<引擎版本>/<环境与锁身份>/  # npm 锁定依赖；安装完成后才发布
├── cache/fonts/        # 按需下载的字体
└── styles/<id>/        # 用户自定义风格

<项目>/                 # wka init-project 会 git init
└── films/<片名>/
    ├── film.json  story.md  storyboard.md
    ├── shots/sNN.js  shots/common.js
    ├── audio/build.mjs
    ├── .wka/state.json        # 进度、签批时的镜头哈希（进 git）
    ├── .cache/                 # 镜头片段、混音、QA（不进 git）
    │   ├── <后缀>/             # 副版（如 9x16/）的片段、拼接结果、QA
    │   └── approved/           # 第 13 道终审时的主版定稿快照
    ├── stills/                 # 静帧、接触表（不进 git）；副版在 stills/<后缀>/
    ├── subtitles.<后缀>.srt     # 副版字幕（主版是 subtitles.srt）
    └── <name>.mp4              # 成片（不进 git，可用 LFS）；副版是 <name>-<后缀>.mp4
```

仓库里的示范片（`plugin/skills/<id>/examples/<片名>/`）目录结构相同，但**只提交源文件**：`.wka/`、`stills/`、`review/`、生成的配音和字幕、成片都被 `.gitignore` 挡掉。用户项目会把 `.wka/state.json` 提交进 git，用来恢复在制进度；示范片是定稿后的成品，不需要进度文件。

## 桌面插件边界

三个清单共用同一份 `skills/`、`catalog.json` 和 `engine/`，插件版本保持一致。通用清单固定从根目录 `skills/` 发现技能，并把 `setup` 声明为安装后的设置入口；Codex 兼容清单显式声明 `./skills/`。Claude Code 保留原 commands。

跨宿主技能从当前加载文件的位置上移两级解析插件根目录，不依赖 `CLAUDE_PLUGIN_ROOT` 或源码仓库路径。引擎已有基于 `import.meta.url` 的路径解析，所以安装到缓存后无需更改引擎。所有影片写到用户选定的工程目录；插件缓存只存程序文件。审片使用宿主可用的提问工具，缺失时文字确认；异步提问也必须等待用户真实回复。

本次只支持具有终端和文件访问能力的桌面本地执行环境，不包含远程 MCP 或云端渲染服务。

## 一次渲染的数据流

```
film.json ──► loadFilm ──► getStyles ──► resolveStyle ──► { pipeline, kits(拓扑排序) }
                                                │
shots/*.js + 镜头哈希 ──► ShotCache ──命中──► 复用片段
                                │未命中
                                ▼
            pipeline.renderShots(job, todo)   ← browser：Chromium 逐帧 seek → JPEG → ffmpeg
                                │
                                ▼
               concat ──► mix(audio/build.mjs + TTS + tracks) ──► exporter(mp4/gif/jianying/…)
```

镜头哈希包含：引擎版本、管线与工具包版本、运行时 / 工具包 / 风格脚本 / 公共脚本 / 镜头文件的内容、尺寸、帧率、种子、字体、本镜用到的声音同步点（按 `s.cueIn('名')` 字面量静态识别，识别不了就算全部）。任何一项变了，这一镜才会重渲。

内容证据通过 `core/file-hash.mjs` 同步分块读取，单个缓冲区最多 1 MiB；前缀长度来自同一次打开的文件，读取结束核对文件身份与修改信息。`sourceState` 只在单次同步观察内按归一化路径复用摘要，并在结束时核对文件与目录条目；下一次调用仍重新读取内容。视频检查后的复读和最终交付双遍扫描独立执行，不共享这个观察上下文。

## 主版与副版（横竖双版）

`film.json` 的 `size` 是主版画幅，`variants` 里是副版（如 `"9:16": {}`）。命令加 `--aspect <副版>` 处理副版：`core/variants.mjs` 把画幅解析成尺寸（按主版短边等比推出）、画幅后缀和各类路径，`loadFilm` 换上副版尺寸，镜头有覆盖文件 `sNN.<后缀>.<扩展名>` 时换成它。镜头表、`cues`、声轨两版共用；镜头从 `s.aspect` / `s.orientation` 知道当前画幅。

主版第 13 道签批时，`core/approval.mjs` 把每镜哈希记进 `state.json`、片段存到 `.cache/approved/`；渲染副版前重算主版哈希，变了的镜头重渲后与快照逐帧比 PSNR（> 50 dB 且帧数相同算不变），写 `review/主版不变报告-<后缀>.md`。副版在第 14 道签批时记下当时的主版哈希，主版之后重新签批且哈希变了，副版就过期，`wka final` 拒绝输出。

## 三类插槽

| 插槽 | 目录 | 清单 | 接口 |
|---|---|---|---|
| 管线 | `engine/pipelines/<名>/` | `pipeline.json` | `check()` · `renderShots(job, todo, {onDone})` · `renderStills(job, points, outDir)` |
| 工具包 | `engine/kits/<名>/` | `kit.json` | 页面脚本，挂到 `wk.<名>`；JSDoc 生成 README |
| 导出器 | `engine/exporters/<名>/` | `exporter.json` | `encodeOutput({video, audio, out, fps, proxy, timeline})`，可返回实际产物路径 |

`core/registry.mjs` 启动时扫描三个目录（跳过 `_` 开头），校验清单后注册。
`status: planned` 的插槽会被列出，但 resolver 拒绝使用。

现有管线：`browser`（Chromium 逐帧 seek，镜头是 `wk.shot` 的 `.js`）、`remotion`（experimental：镜头是 React 组件 `.tsx`，每镜一个 Composition，打包一次后逐镜 `renderMedia` 出无声片段；风格积木用 `@wka/style` 引用；复用 playwright 的 chromium headless shell；Remotion 对 3 人以上公司需商业授权，见 `pipelines/remotion/README.md`）、`manim`（规划中）。
风格在 `style.json` 里按名字和版本范围引用：`"kits": {"canvas2d": "^0.1"}`。

## 确定性

- 运行时拦截 `Math.random()`（告警并改用种子随机）。
- 每帧开始前重置画布状态。
- `render(ctx, t, s)` 必须是 t 的纯函数；只允许缓存"与 t 无关"的图层。remotion 镜头同理：只依赖 `useCurrentFrame()` 和 props。
- 冒烟测试会把同一帧渲染两次，逐像素比对。

## 性能

- 2D 画布走 CPU 光栅（`--disable-accelerated-2d-canvas`），无 GPU 时比 SwiftShader 快 5–10 倍；WebGL 仍用 SwiftShader。
- 页面只用一个 WebGL 上下文，按需调整尺寸。
- 日常预览与小样默认 1 个 worker，终稿默认最多 2 个（且不超过 CPU 数；`WKA_WORKERS` 可调）。Remotion 逐镜渲染，worker 数控制镜内并发。
- 1080p 30fps、15 秒、5 镜的水墨短片：约 80 秒（2 核云主机）。
- remotion：打包一次约 1–5 秒，1080p 约 20–25 帧/秒；《七十二变》14 秒 4 镜约 27 秒（M 系列 Mac）。
