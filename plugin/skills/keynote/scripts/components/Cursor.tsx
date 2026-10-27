import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { keyframes } from "../lib/anim";
import { color } from "../theme";
import { useShotScale } from "./Shot";

export interface CursorStop {
  frame: number;
  x: number;
  y: number;
}

interface CursorProps {
  path: CursorStop[];
  /** frames at which a click happens */
  clicks?: number[];
  appearAt?: number;
}

const CLICK_FRAMES = 16;

/** macOS-style pointer that follows a keyframed path and ripples on click. */
export const Cursor: React.FC<CursorProps> = ({ path, clicks = [], appearAt = 0 }) => {
  const frame = useCurrentFrame();
  const scale = useShotScale();
  const fr = path.map((p) => p.frame);
  const x = keyframes(frame, fr, path.map((p) => p.x));
  const y = keyframes(frame, fr, path.map((p) => p.y));
  const opacity = interpolate(frame, [appearAt, appearAt + 6], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const active = clicks.find((c) => frame >= c && frame < c + CLICK_FRAMES);
  const press = active === undefined ? 0 : 1 - Math.abs((frame - active) / 4 - 1);
  const ripple = active === undefined ? 0 : (frame - active) / CLICK_FRAMES;

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        opacity,
        transform: `scale(${1 / scale})`,
        transformOrigin: "0 0",
        pointerEvents: "none",
      }}
    >
      {active !== undefined && (
        <div
          style={{
            position: "absolute",
            left: -40,
            top: -40,
            width: 80,
            height: 80,
            borderRadius: "50%",
            border: `4px solid ${color.accent}`,
            opacity: 1 - ripple,
            transform: `scale(${0.3 + ripple * 1.2})`,
          }}
        />
      )}
      <svg
        width={44}
        height={52}
        viewBox="0 0 22 26"
        style={{
          transform: `scale(${1 - Math.max(0, press) * 0.15})`,
          transformOrigin: "2px 2px",
          filter: "drop-shadow(0 4px 6px rgba(0,0,0,0.35))",
        }}
      >
        <path
          d="M2 2 L2 20 L6.6 15.8 L9.6 22.6 L12.8 21.2 L9.9 14.6 L16 14.6 Z"
          fill="#111"
          stroke="#fff"
          strokeWidth={1.6}
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
};
