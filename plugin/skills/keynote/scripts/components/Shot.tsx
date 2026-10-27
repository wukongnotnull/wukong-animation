import React, { createContext, useContext } from "react";
import { Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { color } from "../theme";

export interface Camera {
  /** focus point in image pixels */
  cx: number;
  cy: number;
  /** 1 = whole image fits the viewport */
  zoom: number;
}

interface ShotProps {
  /** screenshot to show; omit to frame vector children drawn at natW×natH */
  src?: string;
  natW: number;
  natH: number;
  /** viewport size on screen */
  width: number;
  height: number;
  camera?: Camera;
  radius?: number;
  children?: React.ReactNode;
  style?: React.CSSProperties;
  /** slow push-in while the shot holds still: scene frames [from, from + frames], growing by `amount` */
  push?: Push;
}

export interface Push {
  from: number;
  frames: number;
  /** fraction to grow by; a barely-noticeable 3% by default */
  amount?: number;
}

const PUSH_AMOUNT = 0.03;

/** Effective px-per-image-px scale, so overlays can counter-scale (cursor, strokes). */
const ScaleContext = createContext(1);
export const useShotScale = (): number => useContext(ScaleContext);

/**
 * A screenshot (or vector UI) shown through a movable camera. Children are positioned in
 * image-pixel space, so highlights and cursors track the zoom automatically.
 */
export const Shot: React.FC<ShotProps> = ({
  src,
  natW,
  natH,
  width,
  height,
  camera,
  radius = 22,
  children,
  style,
  push,
}) => {
  const frame = useCurrentFrame();
  const fit = Math.min(width / natW, height / natH);
  const cam = camera ?? { cx: natW / 2, cy: natH / 2, zoom: 1 };
  const drift = push
    ? 1 + (push.amount ?? PUSH_AMOUNT) * interpolate(frame, [push.from, push.from + push.frames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.sin) })
    : 1;
  const s = fit * cam.zoom * drift;
  return (
    <div
      style={{
        position: "relative",
        width,
        height,
        borderRadius: radius,
        overflow: "hidden",
        background: color.card,
        boxShadow: "0 24px 48px -24px rgba(0,0,0,0.6)",
        outline: `1px solid ${color.glassEdge}`,
        ...style,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: natW,
          height: natH,
          transformOrigin: "0 0",
          transform: `translate(${width / 2}px, ${height / 2}px) scale(${s}) translate(${-cam.cx}px, ${-cam.cy}px)`,
        }}
      >
        {src && <Img
          src={staticFile(src)}
          style={{ width: natW, height: natH, display: "block" }}
        />}
        <ScaleContext.Provider value={s}>{children}</ScaleContext.Provider>
      </div>
    </div>
  );
};

interface HighlightProps {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 0→1 draw progress */
  progress: number;
  stroke?: string;
  /** dim everything outside the box */
  spotlight?: number;
  /** frame the box starts drawing; plays the 划重点 punch there */
  at?: number;
}

/** Hand-drawn-feel rounded box that strokes itself on, in image space. */
export const Highlight: React.FC<HighlightProps> = ({
  x,
  y,
  w,
  h,
  progress,
  stroke = color.accent,
  spotlight = 0,
  at,
}) => {
  const scale = useShotScale();
  const sw = 5 / scale;
  const pad = 8 / scale;
  const r = 14 / scale;
  const bx = x - pad;
  const by = y - pad;
  const bw = w + pad * 2;
  const bh = h + pad * 2;
  const perimeter = 2 * (bw + bh);
  return (
    <>
      <svg
        style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none" }}
        width={1}
        height={1}
      >
        {spotlight > 0 && (
          <path
            d={`M-99999,-99999 H99999 V99999 H-99999 Z M${bx},${by} v${bh} h${bw} v${-bh} Z`}
            fill={`rgba(28,25,21,${0.45 * spotlight})`}
            fillRule="evenodd"
          />
        )}
        <rect
          x={bx}
          y={by}
          width={bw}
          height={bh}
          rx={r}
          fill="none"
          stroke={stroke}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeDasharray={perimeter}
          strokeDashoffset={perimeter * (1 - progress)}
        />
      </svg>
    </>
  );
};
