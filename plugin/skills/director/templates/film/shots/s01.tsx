// s01 —— remotion 管线的镜头写法见 director/SHOT.md；风格积木从 '@wka/style' 引用（见风格的 TECH.md）
import React from "react";
import { AbsoluteFill } from "remotion";
import type { ShotProps } from "@wka/style";

export default function S01({ dur, s }: ShotProps) {
  return <AbsoluteFill style={{ background: "#111111" }} />;
}
