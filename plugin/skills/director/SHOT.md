# 镜头文件规范（shots/sNN.js）

每镜一个文件，只做一件事：注册一个镜头。

```js
wk.shot({
  // 可选：每镜只运行一次。放只依赖种子的预计算（随机点位、路径），返回值就是 s.state
  setup(s) {
    const r = s.rng;                       // 本镜头的种子随机数
    return { birds: Array.from({ length: 5 }, () => [r(), r()]) };
  },
  // 必需：画出时间 t（秒，本镜头内）的那一帧
  render(ctx, t, s) {
    wk.ink.paper(ctx, s);
    const k = wk.seg(t, s.cueIn('第二句'), s.cueOut('第二句'), 'sineInOut');
    wk.ink.boat(ctx, { x: 0.6 * s.W, y: 0.8 * s.H, progress: k, u: s.u });
  },
});
```

## 铁律

1. **`render` 必须是 `t` 的纯函数。** 引擎会乱序渲染（静帧、并行、只重渲某一镜），同一个 `t` 必须画出同一帧。
   不要在 `render` 里累加状态（如 `x += v`），要写成 `x = x0 + v * t`。
   可以缓存"画好之后不再变化"的图层（`wk.c2d.cached`），因为它与 t 无关。
2. **不用 `Math.random()`。** 引擎会拦截并告警。用 `s.rng`（逐帧可复现）或 `wk.rng(seed)`。
3. **尺寸用相对值。** 位置用 `s.W`、`s.H` 的比例；长度、笔宽乘 `s.u`（`s.u = 画高 / 1080`）。这样预览（半分辨率）、竖屏和正式渲染构图一致。
4. **时间用声音同步点。** 跟 VO / 音效对齐的动作用 `s.cueIn('名')`，不写死秒数。
   名字写成字面量（`s.cueIn('第二句')`，别写 `s.cueIn(name)`）：引擎据此只让用到这个同步点的镜头随它重渲；写成变量就只能每次改 VO 都重渲这一镜。
5. **每帧从头画。** 引擎在每帧开始时重置画布与状态（变换、透明度、混合模式、滤镜）。

## s：镜头状态

| 字段 | 含义 |
|---|---|
| `s.W` `s.H` | 当前渲染尺寸（像素） |
| `s.u` | 设计单位：按 1080p 设计的像素 × `s.u` |
| `s.t` `s.T` `s.p` | 本镜头内时间、镜头时长、进度 `t/T` |
| `s.gt` | 全片时间（秒），用于跨镜头连续的效果（雾的漂移、水波） |
| `s.frame` `s.fps` | 帧号、帧率 |
| `s.rng` | 本帧的种子随机数（`r()`、`r.range(a,b)`、`r.int`、`r.pick`、`r.gauss`） |
| `s.state` | `setup` 的返回值 |
| `s.cueIn(名)` `s.cueOut(名)` | 声音同步点在本镜头内的入点 / 出点 |
| `s.seed` | 本镜头的种子 |

## 运行时工具（所有风格可用）

| 函数 | 说明 |
|---|---|
| `wk.seg(t, a, b, ease?)` | t 在 [a,b] 的进度 0..1，可带缓动名（`'sineInOut'`、`'cubicOut'`…） |
| `wk.keys(t, [[t0,v0],[t1,v1]…], ease?)` | 分段插值（数值或数组） |
| `wk.stagger(t, i, n, a, b, overlap?)` | 第 i 个元素依次出现的进度 |
| `wk.ease.*` | `linear` `sineIn/Out/InOut` `quadIn/Out` `cubicOut` `cubicInOut` `expoOut`（刻意不提供回弹类） |
| `wk.clamp` `wk.lerp` `wk.remap` `wk.smoothstep` | 数学工具 |
| `wk.rng(seed)` | 种子随机数 |
| `wk.noise(seed)` | `n2(x,y)` `n1(x)` `fbm2` `fbm1` |
| `wk.font(family, px)` | 带 fallback 的字体串，直接赋给 `ctx.font` |

工具包与风格积木的 API 见各自的 README / TECH.md：
`engine/kits/<kit>/README.md`、`skills/<风格>/TECH.md`。

## 片内公共脚本

多个镜头画的是"同一幅画的不同阶段"时（例如一幅山水逐渐画成），把场景画法写进 `shots/common.js`，
在 `film.json` 的 `scripts` 里声明；各镜头只传"画到哪一步"的参数。这样镜头之间天然连续，没有跳变。
