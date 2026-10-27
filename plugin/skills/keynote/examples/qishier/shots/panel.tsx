// s02 / s03 共用：代码重绘的 film.json 面板（自然尺寸 960×600，由 Shot 缩放取景）。
import React from "react";
import { color, font } from "@wka/style";

export const PANEL = { w: 960, h: 640 };

const LINES: [string, string][] = [
  ['"title"', '"七十二变"'],
  ['"style"', '"keynote"'],
  ['"size"', "[1920, 1080]"],
  ['"fps"', "30"],
  ['"shots"', "[ s01, s02, s03, s04 ]"],
];

/** 每一行在面板里的矩形（自然像素），给高亮框和镜头取景用。 */
export const lineRect = (i: number) => ({ x: 56, y: 132 + i * 76, w: 640, h: 56 });

export function FilmPanel() {
  return (
    <div style={{ width: PANEL.w, height: PANEL.h, background: color.container, fontFamily: font.mono, color: color.fg }}>
      <div style={{ height: 72, display: "flex", alignItems: "center", gap: 12, padding: "0 28px", borderBottom: `1px solid ${color.glassEdge}` }}>
        {["#F0614F", "#DE9B1B", "#3DB872"].map((c) => (
          <div key={c} style={{ width: 16, height: 16, borderRadius: 8, background: c }} />
        ))}
        <div style={{ marginLeft: 16, fontSize: 26, color: color.fgSoft }}>film.json</div>
      </div>
      {LINES.map(([k, v], i) => {
        const r = lineRect(i);
        return (
          <div key={k} style={{ position: "absolute", left: r.x, top: r.y, height: r.h, display: "flex", alignItems: "center", fontSize: 34, whiteSpace: "nowrap" }}>
            <span style={{ color: color.fgSoft }}>{k}</span>
            <span style={{ color: color.fgFaint }}>:&nbsp;</span>
            <span>{v}</span>
          </div>
        );
      })}
    </div>
  );
}
