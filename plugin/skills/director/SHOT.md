# 镜头文件规范（shots/sNN.js）

> 镜头文件是画面的代码，引擎逐帧调用它出画。

- **工序**：第 8 道写关键帧，第 9 道完成镜头
- **模板**：`engine/templates/film/shots/s01.js`（remotion 管线用 `s01.tsx`），`wka init` 按风格带出
- **流程**：见 `SKILL.md` 第 8、9 道
- **示例**：各风格的示范片，如 `ink-wash/examples/hanjiang/shots/`

每镜一个文件，只做一件事：注册一个镜头。第一行注释写镜号和本镜用到的技法名（风格 STYLE.md「5. 技法」里的名字），写代码时按名字到 STYLE.md 和 TECH.md 对照；分镜表不写技法。

```js
// s02 —— 宣纸、小舟
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
4. **时间用声音同步点。** 跟人声 / 音效对齐的动作用 `s.cueIn('名')`，不写死秒数。
   名字写成字面量（`s.cueIn('第二句')`，别写 `s.cueIn(name)`）：引擎据此只让用到这个同步点的镜头随它重渲；写成变量就只能每次改人声都重渲这一镜。
5. **每帧从头画。** 引擎在每帧开始时重置画布与状态（变换、透明度、混合模式、滤镜）。

## 屏幕文字与人声对位

屏幕文字（题字、标题、诗句）和某条人声说的是同一句话时，文字要跟着人声出现，观众才会觉得"念到哪、写到哪"：

- 从这条人声的 `s.cueIn('名')` 开始，不另加延迟。
- 逐字写出的，先在 `film.json` 这条人声上加 `"chars": true`，`wka soundtrack` 会写出每个字的同步点，镜头里用 `s.cueChars('名')` 取：

```js
// 「花落知多少」：每个字在人声念到它时起笔（s.cueChars 不含标点，一个字一项）
const chars = s.cueChars('第四句');
[...'花落知多少'].forEach((ch, i) => wk.ink.inscribe(ctx, ch, { x, y: y + i * step, size, progress: wk.seg(t, chars[i].in, chars[i].out) }));
```

  逐字同步点是近似值：按句中停顿分句、每句里按字数均分。念得快慢不均、需要更准时，再用下面的手工办法。
- 手工办法（没有逐字同步点时的备用）：把每个字的起笔时刻对到人声里念到这个字的时刻：用 `ffmpeg -i <人声文件> -af silencedetect=noise=-35dB:d=0.08 -f null -` 量出句中停顿，按停顿把字分组；量不出停顿就按字数比例把字分配到 `[cueIn, cueOut]`。不用固定字速（如"每字 0.6 秒"）。
- 每个字相对 `cueIn` 的时间写成常量表放在镜头文件开头，注明"从人声实测得出，换配音要重量"。

```js
// 从旁白「一叶落，而知天下秋」实测（停顿检测）得出，换配音要重量
const TITLE = [['一', 0.22, 0.35], ['叶', 0.38, 0.35], ['知', 1.1, 0.4], ['秋', 1.71, 0.5]]; // [字, 起笔, 写完用时]
// render 里：
const vo = s.cueIn('旁白');
TITLE.forEach(([ch, at, dur], i) => wk.ink.inscribe(ctx, ch, { x, y: y + i * step, size, progress: wk.seg(t, vo + at, vo + at + dur) }));
```

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
| `s.cueChars(名)` | 逐字同步点 `[{ in, out }, …]`（本镜头内时间，一个字一项，不含标点）；要在 `voices[].chars` 设 `true` 并运行 `wka soundtrack` |
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

## remotion 管线的镜头（shots/sNN.tsx）

风格的 `style.json` 写 `"pipeline": "remotion"`（如 keynote）时，镜头不是 `wk.shot`，而是一个默认导出的 React 组件。`wka init` 会按风格自动生成 `s01.tsx`。

```tsx
import React from "react";
import { useCurrentFrame } from "remotion";
import { Headline, SceneShell, sec } from "@wka/style";   // 风格积木，见风格的 TECH.md
import type { ShotProps } from "@wka/style";

export default function S01({ dur, s }: ShotProps) {
  const frame = useCurrentFrame();                  // 本镜内的帧号，0 起
  const beat = sec(s.cueIn("第一句"), s.fps);        // 同步点（秒，相对本镜）→ 帧
  return (
    <SceneShell dur={dur}>
      <Headline lines={["一句[标题]"]} style="T01" at={beat} />
    </SceneShell>
  );
}
```

- `dur`：本镜帧数；`s`：`id / W / H / designW / designH / fps / seed / duration / start` 和 `cueIn(名) / cueOut(名)`。`W/H` 是设计尺寸，小样由管线缩小。
- 铁律照旧：画面只由帧号决定（不用 `Math.random()`、`Date`、网络）；同步点只用字面量 `s.cueIn('名')`。
- 片内公共组件写成 `.tsx` 列进 `film.json` 的 `scripts`，镜头里用 `@wka/film/<相对片目录的路径>` 引用。
- 其余（时长、景别、缓存、字幕、声音）与 `.js` 镜头完全相同。
