import { Easing, interpolate, spring } from "remotion";
import { ease } from "../theme";

const outExpo = Easing.bezier(...ease.outExpo);

/** 0→1 progress over [start, start+duration] with an expo-out curve. */
export function reveal(frame: number, start: number, duration = 18): number {
  return interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: outExpo,
  });
}

/** Piecewise interpolation over keyframes, clamped, eased between stops. */
export function keyframes(frame: number, frames: number[], values: number[]): number {
  return interpolate(frame, frames, values, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });
}

export function pop(frame: number, fps: number, delay = 0): number {
  return spring({ frame: frame - delay, fps, config: { damping: 14, stiffness: 180, mass: 0.7 } });
}

export const sec = (s: number, fps = 30): number => Math.round(s * fps);

const inOut = Easing.inOut(Easing.cubic);

/** 0→1 over [start, start+duration] with a slow-in slow-out curve: for camera moves and travelling boxes. */
export function glide(frame: number, start: number, duration = 21): number {
  return interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: inOut,
  });
}
