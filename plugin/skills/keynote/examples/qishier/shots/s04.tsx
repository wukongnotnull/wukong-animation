// s04 —— 表达"多"用图形不用大数字：72 个格子逐个弹出，已修成的 2 个上强调色
import React from "react";
import { useCurrentFrame } from "remotion";
import { Headline, SceneShell, color, pop, useFrame } from "@wka/style";
import type { ShotProps } from "@wka/style";

const TOTAL = 72;
const DONE = 2;
const COLS = 12;
const CELL = 72;
const GAP = 20;

export default function S04({ dur, s }: ShotProps) {
  const f = useFrame();
  const frame = useCurrentFrame();
  const cols = f.orientation === "portrait" ? 8 : COLS;
  const rows = Math.ceil(TOTAL / cols);
  const gridW = cols * CELL + (cols - 1) * GAP;
  const x0 = f.safe.x + (f.safe.w - gridW) / 2;
  const y0 = f.safe.y + 300;
  return (
    <SceneShell dur={dur}>
      <Headline lines={["已修成 [2] / 72 变"]} style="T02" align="center" rect={{ x: f.safe.x, y: f.safe.y + 60, w: f.safe.w, h: 150 }} at={2} />
      {Array.from({ length: TOTAL }, (_, i) => {
        const p = pop(frame, s.fps, 8 + i * 0.6);
        const lit = i < DONE;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x0 + (i % cols) * (CELL + GAP),
              top: y0 + Math.floor(i / cols) * (CELL + GAP),
              width: CELL,
              height: CELL,
              borderRadius: 16,
              background: lit ? color.accent : color.container,
              outline: lit ? "none" : `1px solid ${color.glassEdge}`,
              opacity: Math.min(1, p),
              transform: `scale(${0.6 + 0.4 * p})`,
            }}
          />
        );
      })}
      <div style={{ position: "absolute", top: y0 + rows * (CELL + GAP) }} />
    </SceneShell>
  );
}
