import type { Camera } from "../components/Shot";
import { glide } from "./anim";
import type { Rect } from "../theme";

/** Where a natural-pixel rect of a Shot lands on the canvas, given the Shot's slot and camera. */
export function shotToScreen(slot: Rect, nat: { w: number; h: number }, cam: Camera, r: Rect): Rect {
  const fit = Math.min(slot.w / nat.w, slot.h / nat.h);
  const s = fit * cam.zoom;
  const ox = slot.x + slot.w / 2 - cam.cx * s;
  const oy = slot.y + slot.h / 2 - cam.cy * s;
  return { x: ox + r.x * s, y: oy + r.y * s, w: r.w * s, h: r.h * s };
}

export interface XY {
  x: number;
  y: number;
}

/** A thing travelling from `a` to `b` over [start, start+dur] frames: its position and visibility. */
export function travel(frame: number, start: number, a: XY, b: XY, dur = 24): XY & { t: number; visible: boolean } {
  const t = glide(frame, start, dur);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, t, visible: frame >= start };
}

export const mid = (r: Rect): XY => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
