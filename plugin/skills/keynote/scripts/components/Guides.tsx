import React from "react";
import { AbsoluteFill } from "remotion";
import { useFrame } from "../frame";

/**
 * QA overlay: safe area (green), presenter bubble (magenta).
 * Never on in a render; enable with --props='{"guides":true}' on a still, or the
 * Guides toggle in Studio's props panel.
 */
export const Guides: React.FC = () => {
  const { safe, presenter, H } = useFrame();
  const box = (r: { x: number; y: number; w: number; h: number }, stroke: string, label: string) => (
    <div style={{ position: "absolute", left: r.x, top: r.y, width: r.w, height: r.h, outline: `2px dashed ${stroke}`, boxSizing: "border-box" }}>
      <span style={{ position: "absolute", left: 4, top: 2, fontSize: 20, fontFamily: "monospace", color: stroke }}>{label}</span>
    </div>
  );
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {box(safe, "#3FD17A", "safe")}
      {box(presenter, "#FF4DD2", "presenter")}
      <div style={{ position: "absolute", left: 0, top: H - 2, width: "100%", height: 2, background: "#FF4DD2" }} />
    </AbsoluteFill>
  );
};
