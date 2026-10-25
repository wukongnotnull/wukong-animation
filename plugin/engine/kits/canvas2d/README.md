# canvas2d 工具包 · v0.1.0

> 本文件由 `tools/build-docs.mjs` 从 `index.js` 的 JSDoc 生成，请勿手改。

Canvas 2D 手绘类基础件：纸张、离屏缓存、带粗细与飞白的毛笔笔触、晕染面、雾带、竖排题字、印章。

```
canvas2d 工具包 —— 挂在 wk.c2d 下。
所有函数都是确定性的：随机性只来自传入的 seed。
尺寸参数都是"实际像素"；在镜头里请用 s.u 换算（例如 width: 18 * s.u）。
```

依赖工具包：无 · 第三方库：无

## API

### `c2d.offscreen(w, h)`

创建离屏画布。

| 参数 | 类型 | 说明 |
|---|---|---|
| `w` | `number` | 宽 |
| `h` | `number` | 高 |

返回：`{canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D}`

### `c2d.rgba(hex, a = 1)`

把 "#rrggbb" 转成 "rgba(r,g,b,a)"。

### `c2d.cached(key, w, h, draw)`

按 key 缓存一张离屏画布（只画一次）。用于纸张、静止的远山等不随时间变化的层。

| 参数 | 类型 | 说明 |
|---|---|---|
| `key` | `string` | 唯一键（建议带上尺寸与种子） |
| `w` | `number` |  |
| `h` | `number` |  |
| `draw` | `(ctx: CanvasRenderingContext2D, w: number, h: number) => void` |  |

返回：`HTMLCanvasElement`

### `c2d.paper(w, h, o = {})`

生成宣纸 / 纸张纹理（带低频斑驳、纤维和细颗粒），结果已缓存。

| 参数 | 类型 | 说明 |
|---|---|---|
| `w` | `number` |  |
| `h` | `number` |  |
| `[o]` | `{color?: string, seed?: number, mottle?: number, fibers?: number, grain?: number}` |  |

返回：`HTMLCanvasElement`

### `c2d.smoothPath(pts, spacing = 2)`

用 Catmull-Rom 平滑经过控制点，并按弧长等距重采样。

| 参数 | 类型 | 说明 |
|---|---|---|
| `pts` | `number[][]` | 控制点 [[x,y], ...]（至少 2 个） |
| `spacing` | `number` | 采样间距（像素） |

返回：`{pts: number[][], len: number[], total: number}` len 为累计弧长

### `c2d.brush(ctx, pts, o)`

毛笔笔触：起笔由细到粗、行笔有抖动、收笔收细，带洇边与飞白。 画在离屏层上再以 multiply 叠到 ctx（墨"吃"进纸里，重叠处会更深）。

| 参数 | 类型 | 说明 |
|---|---|---|
| `ctx` | `CanvasRenderingContext2D` |  |
| `pts` | `number[][]` | 控制点（会被平滑） |
| `o` | `object` |  |
| `o.width` | `number` | 基础笔宽（像素） |
| `[o.color]` | `string` | 墨色，默认 '#1a1a1a' |
| `[o.alpha=0.9]` | `number` | 整体不透明度 |
| `[o.progress=1]` | `number` | 0..1，只画出前面这部分（"写"出来的动画） |
| `[o.taper]` | `number[]` | [起笔比例, 收笔比例]，默认 [0.12, 0.3] |
| `[o.pressure]` | `(u:number)=>number` | 沿笔画 u∈[0,1] 的压力倍数 |
| `[o.dry=0.25]` | `number` | 飞白程度 0..1（越往笔尾越干） |
| `[o.bleed]` | `number` | 洇边模糊半径（像素），默认 width*0.35 |
| `[o.bristles=14]` | `number` | 笔毛数量 |
| `[o.jitter=0.1]` | `number` | 行笔粗细抖动 |
| `[o.seed=1]` | `number` |  |

### `c2d.wash(ctx, shape, o = {})`

晕染面：柔边填充 + 边缘一圈稍深的"水线"，可选纵向淡出（山脚入雾）。

| 参数 | 类型 | 说明 |
|---|---|---|
| `ctx` | `CanvasRenderingContext2D` |  |
| `shape` | `Path2D\|number[][]` | 闭合路径或多边形点 |
| `o` | `object` |  |
| `[o.color='#4d4d4d']` | `string` |  |
| `[o.alpha=0.5]` | `number` |  |
| `[o.blur=6]` | `number` | 柔边半径 |
| `[o.edge=0.35]` | `number` | 水线强度 0..1 |
| `[o.edgeWidth=2]` | `number` |  |
| `[o.fade]` | `number[]` | [yStart, yEnd]：从 yStart 到 yEnd 渐隐到透明 |
| `[o.fadeLeft]` | `number[]` | [x0, x1]：左端从透明渐显 |
| `[o.fadeRight]` | `number[]` | [x0, x1]：右端渐隐到透明 |
| `[o.bounds]` | `number[]` | [x, y, w, h] 离屏层范围，默认整幅画布 |

### `c2d.ridge(o)`

用 1D fBm 生成一条山脊线。

| 参数 | 类型 | 说明 |
|---|---|---|
| `o` | `object` |  |
| `o.x0` | `number` |  |
| `o.x1` | `number` | 水平范围 |
| `o.y` | `number` | 基线 |
| `o.amp` | `number` | 起伏幅度（像素） |
| `[o.freq=1.5]` | `number` | 起伏频率（整段内的大约峰数） |
| `[o.peaks]` | `number[][]` | 额外的主峰：[[x中心比例0..1, 高度像素, 宽度比例], ...] |
| `[o.step=6]` | `number` | 采样间隔 |
| `[o.rough=0.12]` | `number` | 细碎起伏 |
| `[o.taper]` | `number[]` | [左端, 右端] 收到地面的比例，如 [0, 0.12] |
| `[o.seed=1]` | `number` |  |

返回：`number[][]`

### `c2d.mist(ctx, o)`

横向雾带：一串柔和椭圆，随时间缓慢漂移。用宣纸色（或背景色）画，能"遮"住下面的墨。

| 参数 | 类型 | 说明 |
|---|---|---|
| `ctx` | `CanvasRenderingContext2D` |  |
| `o` | `object` |  |
| `o.y` | `number` |  |
| `o.h` | `number` | 雾带中心与厚度 |
| `[o.x0=0]` | `number` |  |
| `[o.x1=画宽]` | `number` |  |
| `[o.color='#F2EDE3']` | `string` |  |
| `[o.alpha=0.6]` | `number` |  |
| `[o.t=0]` | `number` | 时间（秒） |
| `[o.drift=0]` | `number` | 漂移速度（像素/秒） |
| `[o.puffs=9]` | `number` |  |
| `[o.seed=1]` | `number` |  |

### `c2d.verticalText(ctx, text, o)`

竖排文字，从上到下逐字"写"出（每个字自上而下显现，带淡淡洇边）。 多列时从右往左排。

| 参数 | 类型 | 说明 |
|---|---|---|
| `ctx` | `CanvasRenderingContext2D` |  |
| `text` | `string\|string[]` | 字符串（单列）或字符串数组（多列，第一列在最右） |
| `o` | `object` |  |
| `o.x` | `number` |  |
| `o.y` | `number` | 第一列的中心 x、首字顶部 y |
| `o.size` | `number` | 字号（像素） |
| `[o.family='Ma Shan Zheng']` | `string` |  |
| `[o.color='#141414']` | `string` |  |
| `[o.alpha=0.92]` | `number` |  |
| `[o.gap=0.12]` | `number` | 字距（相对字号） |
| `[o.colGap=0.5]` | `number` | 列距（相对字号） |
| `[o.progress=1]` | `number` | 0..1 全部字的显现进度 |
| `[o.bleed]` | `number` | 洇边模糊，默认 size*0.03 |

### `c2d.seal(ctx, o)`

白文方印（红底白字），边缘与印面带斑驳。progress 控制"盖"下去的过程： 放大 1.08 → 1、透明 → 不透明，不回弹。

| 参数 | 类型 | 说明 |
|---|---|---|
| `ctx` | `CanvasRenderingContext2D` |  |
| `o` | `object` |  |
| `o.x` | `number` |  |
| `o.y` | `number` | 印章中心 |
| `o.size` | `number` | 边长（像素） |
| `o.text` | `string` | 2 或 4 个字（右列先读，自上而下） |
| `[o.color='#B22C22']` | `string` |  |
| `[o.family='Ma Shan Zheng']` | `string` |  |
| `[o.progress=1]` | `number` |  |
| `[o.seed=1]` | `number` |  |
| `[o.rotate=0]` | `number` | 轻微倾斜（弧度） |
