# 架构

## 仓库结构

```
wukong-animation/                          # GitHub 仓库
├── .claude-plugin/marketplace.json   # 指向 ./plugin
├── plugin/                        # ★ 只有这里分发给用户
│   ├── .claude-plugin/plugin.json
│   ├── catalog.json               # 自动生成：72 变索引
│   ├── skills/                    # 只有一层：skills/<id>/SKILL.md
│   │   ├── director/              # 通用流程 + 片子模板 templates/film/
│   │   ├── new-style/
│   │   └── ink-wash/              # SKILL · STYLE · TECH · style.json · scripts/ · examples/
│   ├── commands/                  # film · styles · setup
│   └── engine/
│       ├── bin/wka.mjs           # CLI
│       ├── core/                  # 扩展时不改动
│       ├── schemas/               # style / film / pipeline / kit / exporter 的 JSON Schema
│       ├── runtime/               # 页面运行时（浏览器类管线共用）
│       ├── pipelines/  kits/  exporters/   # 三类插槽，各有 _template/
│       └── audio/                 # synth 合成器 · tts · mix
├── templates/style-skill/         # 新风格模板
├── tools/                         # 维护脚本（不分发）
├── tests/smoke/                   # 冒烟测试 + 基准图（按平台分目录）
├── tests/unit/ tests/integration/ # node --test：cue 解析、AI 配音缓存、渲染失败清理
├── docs/                          # 画廊、本文件、贡献指南
└── .github/workflows/             # lint · smoke
```

用户机器上：

```
~/.wukong-animation/
├── deps/<引擎版本>/    # npm 依赖与 Chromium（插件升级不受影响）
├── cache/fonts/        # 按需下载的字体
└── styles/<id>/        # 用户自定义风格

<项目>/                 # wka init-project 会 git init
└── films/<片名>/
    ├── film.json  story.md  storyboard.md
    ├── shots/sNN.js  shots/common.js
    ├── audio/build.mjs
    ├── .wka/state.json        # 进度（进 git）
    ├── .cache/                 # 镜头片段、混音、QA（不进 git）
    ├── stills/                 # 静帧、接触表（不进 git）
    └── <name>.mp4              # 成片（不进 git，可用 LFS）
```

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

## 三类插槽

| 插槽 | 目录 | 清单 | 接口 |
|---|---|---|---|
| 管线 | `engine/pipelines/<名>/` | `pipeline.json` | `check()` · `renderShots(job, todo, {onDone})` · `renderStills(job, points, outDir)` |
| 工具包 | `engine/kits/<名>/` | `kit.json` | 页面脚本，挂到 `wk.<名>`；JSDoc 生成 README |
| 导出器 | `engine/exporters/<名>/` | `exporter.json` | `encodeOutput({video, audio, out, fps, proxy, timeline})`，可返回实际产物路径 |

`core/registry.mjs` 启动时扫描三个目录（跳过 `_` 开头），校验清单后注册。
`status: planned` 的插槽会被列出，但 resolver 拒绝使用。
风格在 `style.json` 里按名字和版本范围引用：`"kits": {"canvas2d": "^0.1"}`。

## 确定性

- 运行时拦截 `Math.random()`（告警并改用种子随机）。
- 每帧开始前重置画布状态。
- `render(ctx, t, s)` 必须是 t 的纯函数；只允许缓存"与 t 无关"的图层。
- 冒烟测试会把同一帧渲染两次，逐像素比对。

## 性能

- 2D 画布走 CPU 光栅（`--disable-accelerated-2d-canvas`），无 GPU 时比 SwiftShader 快 5–10 倍；WebGL 仍用 SwiftShader。
- 页面只用一个 WebGL 上下文，按需调整尺寸。
- 默认 2 个页面并行渲染不同镜头（`WKA_WORKERS` 可调）。
- 1080p 30fps、15 秒、5 镜的水墨短片：约 80 秒（2 核云主机）。
