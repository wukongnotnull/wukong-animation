# 水墨写意 · 技术说明

## 选型

| 需求 | 技术 | 理由 |
|---|---|---|
| 笔触、纸、雾、题字、印章 | Canvas 2D（`canvas2d` 工具包） | 手工痕迹需要逐笔控制：粗细、飞白、洇边。2D 画布走 CPU 光栅，无 GPU 也快 |
| 墨滴晕开 | WebGL shader（`webgl` 工具包） | 晕染是逐像素计算（不规则边缘、浓淡、颗粒、水线），2D 画布做不出、也太慢 |
| 逐帧渲染 | `browser` 管线 | 两者都在浏览器里，逐帧 seek 截图即可 |

不需要 three / gsap 等第三方库，渲染 1080p 约 0.1 秒 / 帧（2 核）。

## 积木 API（`scripts/ink.js` → `wk.ink`）

所有长度参数按 1080p 设计，传 `u: s.u` 自动换算。

主版、副版共用镜头时，`s.orientation`（`'landscape'` / `'portrait'`）和 `s.aspect`（`'16:9'` / `'9:16'`）是当前渲染的画幅，构图不同的地方按它分支；构图完全不同的镜头，副版写覆盖文件 `shots/sNN.9x16.js`。怎么排见 STYLE.md「4. 构图 · 画幅重排规则」。

### `wk.ink.palette`
`{ paper, jiao, nong, zhong, dan, qing, zhusha }`，见 STYLE.md「2. 色彩」。

### `wk.ink.paper(ctx, s, seed = 72)`
铺宣纸（缓存）。每帧第一句。

### `wk.ink.drop(ctx, { x, y, r, density = 1, color = nong, seed = 1 })`
墨滴晕开（WebGL）。`r` 是当前半径（像素），动画由调用方控制：
```js
const r = wk.ease.cubicOut(wk.seg(t, 0.3, 3)) * 150 * s.u;
wk.ink.drop(ctx, { x: 0.33 * s.W, y: 0.41 * s.H, r });
```

### `wk.ink.mountain(ctx, { x0, x1, y, amp, peaks, tone, alpha, line, cun, depth, freq, taper, u, seed })`
一层山：晕染山体（山脚入雾）+ 断续干笔山脊 + 皴擦。
- `peaks: [[中心 0..1, 高度px, 宽度 0..1], …]`
- `tone`：远 `qing` / 中 `dan` / 近 `zhong`
- `line: 0` 不勾山脊（远山），`cun: 0` 不皴
- `taper: [左, 右]` 两端收到地面的比例，默认 `[0, 0.14]`

**很贵，必须缓存**：
```js
const img = wk.c2d.cached(`mid:${s.W}x${s.H}`, s.W, s.H, (g) => wk.ink.mountain(g, {...}));
ctx.drawImage(img, -pan, 0);
```

### `wk.ink.ripples(ctx, { x, y, w, n = 4, progress, t, u, seed })`
几笔横向淡墨水纹。

### `wk.ink.boat(ctx, { x, y, size = 1, progress, u, seed })`
小舟 + 篷 + 渔翁 + 钓竿，按 progress 依次写出；写完自动缓存，之后只做平移。

### `wk.ink.inscribe(ctx, text | [列…], { x, y, size, progress, family, gap, colGap })`
竖排题字，右起；`x` 是第一列中心，`y` 是首字顶部。写完自动缓存。

### `wk.ink.seal(ctx, { x, y, size, text, progress, rotate, seed })`
朱砂白文印，2 或 4 个字。

### `wk.ink.mist(ctx, { y, h, x0, x1, alpha, t, drift, puffs, seed })`
宣纸色雾带。`t` 传 `s.gt`（全片时间）让漂移跨镜头连续。

## 底层工具包

需要更细的控制时直接用：

- `wk.c2d.brush(ctx, pts, { width, color, alpha, progress, taper, pressure, dry, bleed, bristles, jitter, seed })`
- `wk.c2d.wash(ctx, shape, { color, alpha, blur, edge, edgeWidth, fade, fadeLeft, fadeRight, bounds })`
- `wk.c2d.ridge({ x0, x1, y, amp, freq, peaks, rough, taper, step, seed })`
- `wk.c2d.verticalText` / `wk.c2d.seal` / `wk.c2d.mist` / `wk.c2d.paper` / `wk.c2d.cached` / `wk.c2d.offscreen`
- `wk.gl.shader(frag, { width, height }).render(uniforms)` —— 片元着色器里可用 `{{noise}}` 引入 `snoise` / `fbm`

完整说明：`engine/kits/canvas2d/README.md`、`engine/kits/webgl/README.md`。

## 性能要点

1. 不随时间变化的层一律 `wk.c2d.cached`（山、写完的舟和题字已自动缓存）。
2. `ctx.filter = 'blur()'` 很贵，只用在小的离屏层上，不要对整幅画布用。
3. WebGL 全页只有一个上下文，`render()` 返回的 canvas 会被下一次调用覆盖，要立刻 `drawImage`。
