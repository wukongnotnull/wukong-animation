import { useCurrentFrame } from "remotion";
import type { Camera } from "../components/Shot";
import { glide } from "./anim";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Stage {
  cam: Camera;
  box: Box;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Camera move length: 0.7 s, inside the spec's 0.5–0.9 s for moves and zooms. */
const MOVE = 21;

/** Index of the last beat already reached (beats are shot-relative frames, ascending). */
export function beatIndex(beats: number[], frame: number): number {
  let index = 0;
  beats.forEach((b, i) => {
    if (frame >= b) index = i;
  });
  return index;
}

/**
 * Camera + highlight box for a walkthrough: stage n is reached on beat n
 * (shot-relative frames, from the shot's sync points), gliding (slow in, slow out)
 * from the previous stage. `from` is where the shot starts when it continues
 * the previous shot, so stage 0 glides in too.
 */
export function useStages(beats: number[], stages: Stage[], from?: Stage, duration = MOVE): Stage {
  const frame = useCurrentFrame();
  const i = Math.min(beatIndex(beats, frame), stages.length - 1);
  const start = i === 0 ? from ?? stages[0] : stages[i - 1];
  const to = stages[i];
  const t = glide(frame, i === 0 ? 0 : beats[i], duration);
  return {
    cam: { cx: lerp(start.cam.cx, to.cam.cx, t), cy: lerp(start.cam.cy, to.cam.cy, t), zoom: lerp(start.cam.zoom, to.cam.zoom, t) },
    box: { x: lerp(start.box.x, to.box.x, t), y: lerp(start.box.y, to.box.y, t), w: lerp(start.box.w, to.box.w, t), h: lerp(start.box.h, to.box.h, t) },
  };
}

/**
 * Camera that frames `region` (natural px) inside a `view`-sized viewport,
 * with `pad` px of breathing room, never zooming out past the full fit
 * and never panning past the content edges.
 */
export function focusOn(region: Box, view: { w: number; h: number }, nat: { w: number; h: number }, pad = 60, maxZoom = 2.2): Camera {
  const fit = Math.min(view.w / nat.w, view.h / nat.h);
  const want = Math.min(view.w / (region.w + pad * 2), view.h / (region.h + pad * 2));
  const zoom = Math.max(1, Math.min(maxZoom, want / fit));
  // keep the framed window inside the content so no empty margin shows
  const visW = view.w / (fit * zoom);
  const visH = view.h / (fit * zoom);
  const clamp = (v: number, vis: number, size: number): number => (vis >= size ? size / 2 : Math.min(size - vis / 2, Math.max(vis / 2, v)));
  return {
    cx: clamp(region.x + region.w / 2, visW, nat.w),
    cy: clamp(region.y + region.h / 2, visH, nat.h),
    zoom,
  };
}

/** Frame (shot-relative) of the shot's first camera push-in, if any: where the one 要放大 sound goes. */
export function zoomInFrames(beats: number[], stages: Stage[], threshold = 0.08): number[] {
  const i = stages.findIndex((s, k) => k > 0 && s.cam.zoom > stages[k - 1].cam.zoom + threshold);
  return i > 0 ? [beats[i]] : [];
}
