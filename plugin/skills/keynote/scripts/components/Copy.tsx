import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { reveal } from "../lib/anim";
import { TypeStyle, useFrame } from "../frame";
import { color, font, motion, Rect } from "../theme";
import { useTextExit } from "./SceneShell";

export interface Point {
  /** scene-relative frame this point becomes current */
  at: number;
  text: string;
}

interface CuePointProps {
  points: Point[];
  rect: Rect;
  style?: TypeStyle;
  align?: "left" | "center";
}

/**
 * The one point currently being explained, in the L04 body slot. Each new
 * point cross-fades in (0.4 s) and replaces the last: one focus per page.
 */
export const CuePoint: React.FC<CuePointProps> = ({ points, rect, style = "T05", align = "left" }) => {
  const frame = useCurrentFrame();
  const t = useFrame().type[style];
  const out = useTextExit();
  return (
    <div style={{ position: "absolute", left: rect.x, top: rect.y, width: rect.w, height: rect.h, opacity: out }}>
      {points.map((p, i) => {
        const next = points[i + 1];
        const fadeIn = reveal(frame, p.at, motion.fade);
        const fadeOut = next ? interpolate(frame, [next.at, next.at + 8], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
        const opacity = Math.min(fadeIn, fadeOut);
        if (opacity <= 0) return null;
        return (
          <div
            key={`${p.at}-${p.text}`}
            style={{
              position: "absolute",
              inset: 0,
              fontFamily: font.sans,
              fontSize: t.size,
              fontWeight: t.weight,
              lineHeight: t.line,
              color: color.fgSoft,
              whiteSpace: "pre-line",
              textAlign: align,
              opacity,
              transform: `translateY(${(1 - fadeIn) * 16}px)`,
            }}
          >
            {p.text}
          </div>
        );
      })}
    </div>
  );
};

interface StepListProps {
  steps: Point[];
  rect: Rect;
}

/** Numbered steps: the current one in full white, the rest receded (spec: >3 steps, highlight current). */
export const StepList: React.FC<StepListProps> = ({ steps, rect }) => {
  const frame = useCurrentFrame();
  const current = steps.reduce((acc, s, i) => (frame >= s.at ? i : acc), -1);
  const t = useFrame().type.T06;
  const out = useTextExit() * reveal(frame, 0, motion.fade);
  return (
    <div style={{ position: "absolute", left: rect.x, top: rect.y, width: rect.w, display: "flex", flexDirection: "column", gap: 20, opacity: out }}>
      {steps.map((s, i) => {
        const isCurrent = i === current;
        return (
          <div
            key={s.text}
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 20,
              fontFamily: font.sans,
              fontSize: t.size,
              fontWeight: isCurrent ? 600 : 400,
              lineHeight: t.line,
              color: isCurrent ? color.fg : color.fgFaint,
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ width: 36, color: isCurrent ? color.accent : color.fgFaint, fontVariantNumeric: "tabular-nums" }}>{i + 1}</span>
            {s.text}
          </div>
        );
      })}
    </div>
  );
};

interface CalloutProps {
  text: string;
  at: number;
  size?: "T04" | "T06";
}

/** Flat accent label for a key line: no rotation, border or heavy shadow (spec 06). */
export const Callout: React.FC<CalloutProps> = ({ text, at, size = "T06" }) => {
  const frame = useCurrentFrame();
  const p = reveal(frame, at, motion.fade);
  const t = useFrame().type[size];
  const out = useTextExit();
  return (
    <>
      <div
        style={{
          display: "inline-block",
          fontFamily: font.sans,
          fontSize: t.size,
          fontWeight: 600,
          lineHeight: 1.2,
          color: color.accent,
          background: color.container,
          borderRadius: 999,
          padding: `${t.size * 0.28}px ${t.size * 0.6}px`,
          opacity: p * out,
          transform: `scale(${0.96 + 0.04 * p})`,
          whiteSpace: "nowrap",
        }}
      >
        {text}
      </div>
    </>
  );
};
