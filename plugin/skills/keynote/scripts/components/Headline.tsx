import React from "react";
import { useCurrentFrame } from "remotion";
import { reveal } from "../lib/anim";
import { FrameSpec, TypeStyle, useFrame } from "../frame";
import { color, font, motion, Rect } from "../theme";
import { useTextExit } from "./SceneShell";

interface HeadlineProps {
  /** lines of the title; wrap a span in [brackets] to paint it with the accent */
  lines: string[];
  /** line breaks for the narrow portrait title slot, when they differ */
  portrait?: string[];
  /** spec text style, T01–T04 */
  style?: TypeStyle;
  at?: number;
  align?: "left" | "center";
  rect?: Rect;
}

/** Splits "abc [def] ghi" into plain and accent runs. */
function runs(line: string): { text: string; accent: boolean }[] {
  return line
    .split(/(\[[^\]]*\])/)
    .filter(Boolean)
    .map((part) => (part.startsWith("[") ? { text: part.slice(1, -1), accent: true } : { text: part, accent: false }));
}

/** Spec title: one block that fades up 0.5 s, accent runs in the single accent colour. */
export const Headline: React.FC<HeadlineProps> = ({ lines: wide, portrait, style = "T02", at = 0, align = "left", rect }) => {
  const frame = useCurrentFrame();
  const spec: FrameSpec = useFrame();
  const t = spec.type[style];
  const lines = spec.orientation === "portrait" && portrait ? portrait : wide;
  const p = reveal(frame, at, motion.fade);
  const out = useTextExit();
  return (
    <div
      style={{
        ...(rect ? { position: "absolute", left: rect.x, top: rect.y, width: rect.w } : {}),
        textAlign: align,
        fontFamily: font.sans,
        fontSize: t.size,
        fontWeight: t.weight,
        lineHeight: t.line,
        letterSpacing: "-0.01em",
        color: color.fg,
        opacity: p * out,
        transform: `translateY(${(1 - p) * 24}px)`,
      }}
    >
      {lines.map((line, i) => (
        <div key={i} style={{ whiteSpace: "nowrap" }}>
          {runs(line).map((r, k) => (
            <span key={k} style={{ color: r.accent ? color.accent : undefined }}>
              {r.text}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
};
