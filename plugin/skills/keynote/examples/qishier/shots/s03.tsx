// s03 —— 接 s02（enter="hold"）：面板从 L04 的图位移到细节区并推近 style 一行，高亮框描出来
import React from "react";
import { useCurrentFrame } from "remotion";
import { Highlight, SceneShell, Shot, color, focusOn, glide, reveal, useFrame } from "@wka/style";
import type { ShotProps } from "@wka/style";
import { FilmPanel, PANEL, lineRect } from "@wka/film/shots/panel";

const MOVE = 24;

export default function S03({ dur }: ShotProps) {
  const f = useFrame();
  const frame = useCurrentFrame();
  const from = f.layout.L04.image;
  const to = f.scene.detail;
  const t = glide(frame, 0, MOVE);
  const lerp = (a: number, b: number) => a + (b - a) * t;
  const box = { x: lerp(from.x, to.x), y: lerp(from.y, to.y), w: lerp(from.w, to.w), h: lerp(from.h, to.h) };
  const line = lineRect(1);
  const end = focusOn(line, to, PANEL, 120, 2.4);
  // 起点与 s02 的最后一帧相同：整面板、3% 推进已走完
  const startZoom = 1.03;
  const cam = { cx: lerp(PANEL.w / 2, end.cx), cy: lerp(PANEL.h / 2, end.cy), zoom: lerp(startZoom, end.zoom) };
  return (
    <SceneShell dur={dur} enter="hold">
      <div style={{ position: "absolute", left: box.x, top: box.y }}>
        <Shot natW={PANEL.w} natH={PANEL.h} width={box.w} height={box.h} camera={cam} style={{ background: color.container }}>
          <FilmPanel />
          <Highlight {...line} progress={reveal(frame, MOVE + 4, 18)} spotlight={reveal(frame, MOVE + 4, 18)} />
        </Shot>
      </div>
    </SceneShell>
  );
}
