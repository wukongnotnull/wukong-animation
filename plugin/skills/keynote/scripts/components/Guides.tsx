import React from "react";
import { AbsoluteFill } from "remotion";
import { useFrame } from "../frame";

/**
 * QA overlay: safe area (green), subtitle band (blue), presenter bubble (magenta).
 * Never on in a render; enable with --props='{"guides":true}' on a still, or the
 * Guides toggle in Studio's props panel.
 */
export const Guides: React.FC = () => {
  const { safe, subtitle, presenter, H } = useFrame();
  const box = (r: { x: number; y: number; w: number; h: number }, stroke: string, label: string) => (
    <div style={{ position: "absolute", left: r.x, top: r.y, width: r.w, height: r.h, outline: `2px dashed ${stroke}`, boxSizing: "border-box" }}>
      <span style={{ position: "absolute", left: 4, top: 2, fontSize: 20, fontFamily: "monospace", color: stroke }}>{label}</span>
    </div>
  );
  const subH = subtitle.size * 1.3 * 2 + 22; // two lines plus padding
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {box(safe, "#3FD17A", "safe")}
      {box({ x: (safe.x + safe.w / 2) - subtitle.maxWidth / 2, y: subtitle.bottom - subH, w: subtitle.maxWidth, h: subH }, "#4DA3FF", "subtitles")}
      {box(presenter, "#FF4DD2", "presenter")}
      <div style={{ position: "absolute", left: 0, top: H - 2, width: "100%", height: 2, background: "#FF4DD2" }} />
    </AbsoluteFill>
  );
};
