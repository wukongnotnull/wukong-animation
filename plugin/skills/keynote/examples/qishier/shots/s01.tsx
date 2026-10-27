// s01 —— 标题。L01：单句标题页用 T01 大字撑满
import React from "react";
import { Headline, SceneShell, useFrame, color, font, reveal, motion } from "@wka/style";
import type { ShotProps } from "@wka/style";
import { useCurrentFrame } from "remotion";

export default function S01({ dur }: ShotProps) {
  const f = useFrame();
  const frame = useCurrentFrame();
  const sub = f.layout.L01.sub;
  return (
    <SceneShell dur={dur} exit="fade">
      <div style={{ position: "absolute", left: f.layout.L01.phrase.x, top: f.layout.L01.phrase.y, width: f.layout.L01.phrase.w, height: f.layout.L01.phrase.h, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Headline lines={["每一帧都由[代码]画出"]} style="T01" align="center" at={4} />
      </div>
      <div style={{ position: "absolute", left: sub.x, top: sub.y, width: sub.w, textAlign: "center", fontFamily: font.sans, fontSize: f.type.T04.size, fontWeight: f.type.T04.weight, color: color.fgSoft, opacity: reveal(frame, 30, motion.fade) }}>
        不用任何 AI 视频模型
      </div>
    </SceneShell>
  );
}
