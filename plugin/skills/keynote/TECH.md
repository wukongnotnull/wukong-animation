# 发布会 Keynote · 技术说明

## 选型

| 需求 | 选择 | 理由 |
|---|---|---|
| 大量排版、界面重绘、对象移动缩放 | remotion 管线（React + DOM） | 文字排版、圆角阴影、SVG 描边都是 DOM 的强项；组件可复用，横竖两版共用一套镜头 |
| 背景、字体 | `ShotRoot` + 引擎字体 | 背景按片内时间推进，跨镜连续；字体走引擎的按需下载与子集化 |
| 声音、字幕 | 引擎 | `audio/build.mjs` + 同步点；字幕层由引擎叠加 |

组件移植自用户的 wk-motion-graphics（Remotion 工程），去掉了音效组件（声音归 `audio/build.mjs`）、字幕和出镜组件（引擎负责 / 本次不做），节拍从"按字幕句子"改成"按帧号"（由同步点换算）。

## 镜头写法

```tsx
// shots/s02.tsx
import React from "react";
import { CuePoint, Headline, SceneShell, Shot, color, sec, useFrame } from "@wka/style";
import type { ShotProps } from "@wka/style";
import { FilmPanel, PANEL } from "@wka/film/shots/panel"; // 片子自己的公共组件（列进 film.json 的 scripts）

export default function S02({ dur, s }: ShotProps) {
  const f = useFrame();                 // 当前画幅的字号、安全区、版式
  const L = f.layout.L04;
  const b1 = sec(s.cueIn("第二句"), s.fps); // 同步点（秒，相对本镜）→ 帧
  return (
    <SceneShell dur={dur} exit="hold">
      <Headline lines={["一个故事", "→ 一支[短片]"]} style="T03" rect={L.title} at={4} />
      <CuePoint rect={L.body} points={[{ at: 20, text: "选一套画风" }, { at: b1, text: "写脚本、画分镜" }]} />
      <div style={{ position: "absolute", left: L.image.x, top: L.image.y }}>
        <Shot natW={PANEL.w} natH={PANEL.h} width={L.image.w} height={L.image.h} push={{ from: 0, frames: dur }} style={{ background: color.container }}>
          <FilmPanel />
        </Shot>
      </div>
    </SceneShell>
  );
}
```

- `ShotProps`：`dur` 本镜帧数；`s` 有 `id / W / H / designW / designH / fps / seed / duration / start` 和 `cueIn(名) / cueOut(名)`（秒，相对本镜）。`W/H` 是设计尺寸，小样由管线缩小，镜头里不用管。
- 镜头只能依赖 `useCurrentFrame()` 和 props；不要用 `Math.random()`、`Date`、网络请求。
- 镜头经 `@wka/film/…` import 的片目录文件（公共组件、数据、图片）**都要列进 `film.json` 的 `scripts`**：镜头缓存只认这里列出的文件，漏列的文件改了不会触发重渲。风格通用的图片放风格 `assets/`，用 `staticFile('assets/…')`（已进缓存哈希）。

## 积木 API（`scripts/index.ts` → `@wka/style`）

### 几何与样式

- `useFrame(): FrameSpec` —— `orientation`、`W/H`、`safe`、`type.T01…T09`（size / weight / line）、`layout.L01…L07`（L07 是 `cards` 四个位置）、`subtitle`、`presenter`、`scene.detail`（细节页，整个画面）。横竖由片子尺寸自动判断。新增横竖不同的几何，加到 `frame.tsx` 的 `SceneGeometry` 并两边都填。
- `color`、`font`（`sans` / `mono`）、`gap`、`motion`（`fade` 14 / `move` 20 / `transition` 24 帧）、`lanes`。
- `useShot(): { dur, s }` —— 不想层层传 props 时读当前镜头。

### 动画曲线（`lib/anim.ts`）

- `reveal(frame, start, duration = 18)` —— expo-out 0→1，用于出现。
- `glide(frame, start, duration = 21)` —— 慢进慢出 0→1，用于移动和镜头。
- `keyframes(frame, frames[], values[])` —— 多段插值。
- `pop(frame, fps, delay)` —— 弹簧，用于卡片逐个弹出。
- `sec(seconds, fps = 30)` —— 秒 → 帧。

### 版面与接缝（`components/SceneShell.tsx`）

- `<SceneShell dur enter="fade|hold" exit="fade|hold">` —— 每镜最外层：fade 是整页淡入淡出 + 轻推，hold 是画面不动、只让文字淡出。
- `useTextExit()` —— 文字在 `exit="hold"` 的最后 8 帧淡出的系数（`Headline`、`CuePoint` 已内置）。
- `<At x y>`、`<Fit slot natW natH>`、`fitRect(slot, natW, natH)` —— 绝对定位与按比例放进槽位。

### 文字（`Headline.tsx`、`Copy.tsx`）

- `<Headline lines portrait? style="T02" at={0} align rect?>` —— `[方括号]` 上强调色；`portrait` 给竖屏另行断行。
- `<CuePoint points={[{at, text}]} rect style="T05" align>` —— 一次只亮一条要点。
- `<StepList steps={[{at, text}]} rect>` —— 多步骤（T06），到 `at` 的那一步高亮。
- `<Callout text at size="T06">` —— 平的强调标签。

### 界面与镜头（`Shot.tsx`、`Cursor.tsx`、`lib/stages.ts`、`lib/geo.ts`）

- `<Shot src? natW natH width height camera? push? radius style>` —— 截图（`src` 走 `staticFile`）或矢量界面（children 按自然像素画）通过可移动的镜头显示；children 的坐标是自然像素，跟着缩放走。
- `<Highlight x y w h progress spotlight?>` —— 在 `Shot` 里描出的高亮框，`spotlight` 压暗四周。
- `<Cursor path clicks appearAt>` —— 鼠标沿路径移动，`clicks` 帧上出点击波纹（点击声写在 `audio/build.mjs`）。
- `focusOn(region, view, nat, pad = 60, maxZoom = 2.2): Camera` —— 把自然像素区域框进视口，夹紧在内容内。
- `useStages(beats, stages, from?)` —— 讲解走查：第 n 个节拍（本镜帧号，`beats[0]` 为 0）到达第 n 个 `{cam, box}`，慢进慢出；`from` 是续镜时上一镜的终点。
- `zoomInFrames(beats, stages)` —— 第一次推近的帧（放"要放大"音效的位置）。
- `shotToScreen(slot, nat, cam, rect)`、`travel(frame, start, a, b, dur)`、`mid(rect)` —— 自然像素 ↔ 画面坐标，物体移动。

### 形态变化（`MorphBox.tsx`）

- `<MorphBox from to t outgoing={(w,h)=>…} incoming={(w,h)=>…}>` —— 盒子移动缩放，旧内容在 t 0.25–0.75 溶解成新内容。

### 调试（`Guides.tsx`）

- `<Guides />` —— 画出安全区、字幕带、出镜小窗位置；只在调试时临时放进镜头，交付前删掉。

## 用代码重绘界面

1. 量出要重绘的区域在原截图里的尺寸，作为自然尺寸（`natW/natH`），尽量与目标图位同比例。
2. 文案、列表数据和样式分开：演示数据放片目录（如 `shots/data.ts`），组件只管画。
3. 和原截图并排截一帧比对（`wka still --at`），字号、间距、圆角对上再继续。
4. 用户说"素材不补"时按理解画，在分镜表里注明是示意。

## 性能要点

- 一次渲染只打包一次（约 1–5 秒，webpack 缓存在 `.cache/work/remotion-*/`），之后逐镜出片；1080p 30fps 下约 20–25 帧/秒（M 系列 Mac，`WKA_WORKERS` 控制并发）。
- 镜头缓存照常：镜头文件、`film.json` 的 `scripts`、风格 `scripts/` 任一变化才重渲对应的镜。
