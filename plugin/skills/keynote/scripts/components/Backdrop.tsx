import React from "react";
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion";
import { color } from "../theme";
import { useShot } from "../shot";

/** 6% over the first minute of the film, then it holds: barely there, and continuous across shots. */
const PUSH_PER_SECOND = 0.001;
const PUSH_MAX = 0.06;

/** Dark perspective grid with a barely-there push-in and a soft vignette. */
export const Backdrop: React.FC = () => {
  const frame = useCurrentFrame();
  const { s } = useShot();
  const filmSeconds = s.start + frame / s.fps;
  const scale = 1 + Math.min(PUSH_MAX, filmSeconds * PUSH_PER_SECOND);
  return (
    <AbsoluteFill style={{ background: color.bg, overflow: "hidden" }}>
      <Img
        src={staticFile("assets/grid.jpg")}
        style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.4, transform: `scale(${scale})`, transformOrigin: "50% 100%" }}
      />
      <AbsoluteFill style={{ background: "radial-gradient(120% 90% at 50% 45%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.55) 100%)" }} />
    </AbsoluteFill>
  );
};
