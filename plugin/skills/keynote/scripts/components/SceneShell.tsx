import React, { createContext, useContext } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import type { Rect } from "../theme";
const IN = 9;
const OUT = 7;
/** Frames over which text crossfades out when the next page holds the visual. */
const TEXT_OUT = 8;

/**
 * How a page meets its neighbours. "fade" dips the whole frame (a new topic);
 * "hold" keeps the shared visual on screen across the cut, and only the text
 * (titles, points, labels) crossfades, per the spec's continuous-object rule.
 */
export type Seam = "fade" | "hold";

interface ShellState {
  dur: number;
  exit: Seam;
}

const ShellContext = createContext<ShellState>({ dur: Number.POSITIVE_INFINITY, exit: "fade" });

/** Opacity multiplier for text: fades out at the end of a page whose visual is held into the next. */
export function useTextExit(): number {
  const frame = useCurrentFrame();
  const { dur, exit } = useContext(ShellContext);
  if (exit !== "hold") return 1;
  return interpolate(frame, [dur - TEXT_OUT, dur], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
}

interface SceneShellProps {
  dur: number;
  children: React.ReactNode;
  enter?: Seam;
  exit?: Seam;
}

/** Soft push-in on entry and a quick fade on exit, unless a seam is held. The 切镜 swish goes in audio/build.mjs. */
export const SceneShell: React.FC<SceneShellProps> = ({ dur, children, enter = "fade", exit = "fade" }) => {
  const frame = useCurrentFrame();
  const fadeIn = enter === "hold" ? 1 : interpolate(frame, [0, IN], [0, 1], { extrapolateRight: "clamp" });
  const fadeOut = exit === "hold" ? 1 : interpolate(frame, [dur - OUT, dur], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const scale = enter === "hold" ? 1 : interpolate(frame, [0, IN], [1.025, 1], { extrapolateRight: "clamp" });
  return (
    <ShellContext.Provider value={{ dur, exit }}>
      <AbsoluteFill style={{ opacity: Math.min(fadeIn, fadeOut), transform: `scale(${scale})` }}>
        {children}
      </AbsoluteFill>
    </ShellContext.Provider>
  );
};

/** Absolutely positioned box, the basic layout primitive for scenes. */
export const At: React.FC<{
  x: number;
  y: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ x, y, children, style }) => (
  <div style={{ position: "absolute", left: x, top: y, ...style }}>{children}</div>
);

/** Largest rect with the content's aspect ratio that fits inside `slot`, centred in it. */
export function fitRect(slot: Rect, natW: number, natH: number): Rect & { scale: number } {
  const scale = Math.min(slot.w / natW, slot.h / natH);
  const w = natW * scale;
  const h = natH * scale;
  return { x: slot.x + (slot.w - w) / 2, y: slot.y + (slot.h - h) / 2, w, h, scale };
}

/** Draws natural-size content scaled to fit a layout slot (no camera). */
export const Fit: React.FC<{ slot: Rect; natW: number; natH: number; children: React.ReactNode; style?: React.CSSProperties }> = ({
  slot,
  natW,
  natH,
  children,
  style,
}) => {
  const r = fitRect(slot, natW, natH);
  return (
    <div style={{ position: "absolute", left: r.x, top: r.y, width: natW, height: natH, transform: `scale(${r.scale})`, transformOrigin: "0 0", ...style }}>
      {children}
    </div>
  );
};
