// s02 —— 标题、要点与步骤、界面与截图。L04：左侧观点 + 逐条要点，右侧代码重绘的面板；exit="hold" 把面板交给 s03
import React from "react";
import { CuePoint, Headline, SceneShell, Shot, color, useFrame, sec } from "@wka/style";
import type { ShotProps } from "@wka/style";
import { FilmPanel, PANEL } from "@wka/film/shots/panel";

export default function S02({ dur, s }: ShotProps) {
  const f = useFrame();
  const L = f.layout.L04;
  return (
    <SceneShell dur={dur} exit="hold">
      <Headline lines={["一个故事", "→ 一支[短片]"]} style="T03" rect={L.title} at={4} />
      <CuePoint
        rect={L.body}
        points={[
          { at: sec(0.9, s.fps), text: "选一套画风" },
          { at: sec(2.0, s.fps), text: "写脚本、画分镜" },
          { at: sec(3.0, s.fps), text: "渲染成片" },
        ]}
      />
      <div style={{ position: "absolute", left: L.image.x, top: L.image.y }}>
        <Shot natW={PANEL.w} natH={PANEL.h} width={L.image.w} height={L.image.h} push={{ from: 0, frames: dur }} style={{ background: color.container }}>
          <FilmPanel />
        </Shot>
      </div>
    </SceneShell>
  );
}
