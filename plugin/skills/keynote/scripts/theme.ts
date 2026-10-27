/**
 * Design tokens following the Apple-keynote-style spec (苹果发布会风格 Keynote 设计规范 v2.0),
 * dark theme: colours, fonts, spacing and motion. Shape-dependent tokens are in src/frame.tsx.
 */
export const color = {
  // spec dark theme
  bg: "#111111",
  fg: "#F5F5F7",
  fgSoft: "#B5B5BA",
  fgFaint: "#6E6E73",
  container: "#242426",
  accent: "#D97757", // Claude orange, the single accent (spec blue #64A8FF replaced by request)
  glass: "rgba(36,36,38,0.72)",
  glassEdge: "rgba(255,255,255,0.12)",
  // light surfaces used by recreated app UI and screenshots
  card: "#FFFFFF",
  ink: "#1D1D1F",
  inkSoft: "#626267",
  // swimlane palette: data colours from the plugin's own graph, not decoration
  laneBlue: "#2563C9",
  laneOrange: "#D2591E",
  laneGreen: "#1C8C64",
  laneGold: "#DE9B1B",
  lanePink: "#C04F8E",
  laneSky: "#4C9BE0",
  diffAdd: "#3DB872",
  diffDel: "#F0614F",
} as const;

export const lanes = [color.laneBlue, color.laneOrange, color.laneGreen, color.laneGold, color.lanePink, color.laneSky];

export const font = {
  sans: '"Inter", "Noto Sans SC", sans-serif',
  mono: '"JetBrains Mono", "SF Mono", Menlo, monospace',
} as const;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Canvas-dependent tokens (type scale, safe area, master layouts) live in src/frame.tsx.

/** Spec gutters: base 8, common 16/24/32/48 pt → px. */
export const gap = { s: 16, m: 32, l: 48, xl: 64, xxl: 96 } as const;

export const ease = {
  outExpo: [0.16, 1, 0.3, 1] as const,
};

/** Spec animation durations at 30 fps: fades 0.3–0.6 s, moves 0.5–0.9 s. */
export const motion = { fade: 14, move: 20, transition: 24 } as const;
