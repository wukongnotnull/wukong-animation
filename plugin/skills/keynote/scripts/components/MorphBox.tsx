import React from "react";
import { interpolate } from "remotion";
import type { Rect } from "../theme";

interface MorphBoxProps {
  from: Rect;
  to: Rect;
  /** 0→1 progress of the move */
  t: number;
  /** what the box showed on the previous page; dissolves out mid-move */
  outgoing: (w: number, h: number) => React.ReactNode;
  /** what it becomes on this page; dissolves in mid-move */
  incoming: (w: number, h: number) => React.ReactNode;
  radius?: number;
}

/**
 * Keynote Magic Move for an object that changes form between slides: the box
 * travels and resizes from its old rect to its new one while the old content
 * cross-dissolves into the new. Each renderer gets the box's current size.
 */
export const MorphBox: React.FC<MorphBoxProps> = ({ from, to, t, outgoing, incoming, radius = 24 }) => {
  const lerp = (a: number, b: number): number => a + (b - a) * t;
  const box = { x: lerp(from.x, to.x), y: lerp(from.y, to.y), w: lerp(from.w, to.w), h: lerp(from.h, to.h) };
  const fade = interpolate(t, [0.25, 0.75], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h, borderRadius: radius, overflow: "hidden" }}>
      {fade < 1 && <div style={{ position: "absolute", inset: 0, opacity: 1 - fade }}>{outgoing(box.w, box.h)}</div>}
      {fade > 0 && <div style={{ position: "absolute", inset: 0, opacity: fade }}>{incoming(box.w, box.h)}</div>}
    </div>
  );
};
