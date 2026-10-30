# browser 管线

无头 Chromium 打开宿主页，逐帧调用镜头的 `render(ctx, t, s)`，把每帧编码成 JPEG 送进 ffmpeg（libx264）。

## 注入顺序

1. `runtime/`：wk.js → rng.js → easing.js → noise.js → timeline.js
2. 工具包：按 `style.json` 的 `kits` 展开依赖后拓扑排序
3. 风格脚本：`style.json` 的 `scripts`
4. 片内公共脚本：`film.json` 的 `scripts`
5. 镜头文件：每个镜头一个独立页面，互不污染

## 参数

| 项 | 终版 | 小样（--proxy） |
|---|---|---|
| 分辨率 | film.json `size` | × 0.5 |
| 帧率 | film.json `fps` | ÷ 2 |
| 编码 | libx264 crf 16 fast | crf 23 veryfast |

环境变量 `WKA_WORKERS` 可调并行页面数（默认 min(2, CPU 数)）。

## WebGL

用 SwiftShader 软件渲染（`--use-angle=swiftshader`），无 GPU 的服务器上也能跑，但复杂 shader 会慢。

## 时间与帧数

引擎为每镜提供 `frames` 和 `startFrame`：先对全片累计切点取整，再相减分配帧数。管线按 `frames` 绘制，局部时间为 `frame / job.fps`；原始 `duration/start` 与声音 cue 不改。零帧分配会在渲染前拒绝。片段和拼接视频经真实帧数、CFR 时间戳验证后，生成 `review/时间轴检查*.md`；缓存片段也要重新验证。
