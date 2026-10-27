import React, { createContext, useContext } from "react";
import type { Rect } from "./theme";

/**
 * Everything that depends on the canvas shape. The landscape spec is the
 * Apple-keynote spec mapped at 2 px/pt (unchanged from the 16:9 video); the
 * portrait spec re-lays the same masters for a 9:16 phone screen, keeping
 * content clear of short-video platform UI (top bar, right-hand buttons,
 * bottom caption area).
 */
export type Orientation = "landscape" | "portrait";

export interface TypeSpec {
  size: number;
  weight: number;
  line: number;
}

export type TypeStyle = "T01" | "T02" | "T03" | "T04" | "T05" | "T06" | "T07" | "T08" | "T09";

export interface Layouts {
  L01: { phrase: Rect; sub: Rect };
  L02: { title: Rect; image: Rect };
  L03: { title: Rect; image: Rect };
  L04: { title: Rect; body: Rect; image: Rect };
  L05: { number: Rect; claim: Rect; note: Rect };
  L06: { title: Rect; labelA: Rect; labelB: Rect; imageA: Rect; imageB: Rect; note: Rect };
}

/** Per-project scene geometry that differs by shape (see FrameSpec.scene). */
export interface SceneGeometry {
  /**
   * Pages that show screenshot / UI detail: no page title, the shot is as big as it can be
   * while centred on the canvas both ways and kept above the subtitle band
   * (user rules: maximise the screenshot, drop the title; a lone image sits dead centre).
   */
  detail: Rect;
}

export interface FrameSpec {
  orientation: Orientation;
  W: number;
  H: number;
  safe: Rect;
  type: Record<TypeStyle, TypeSpec>;
  layout: Layouts;
  /** subtitle bar: bottom edge, text size, max width */
  subtitle: { bottom: number; size: number; maxWidth: number };
  /** presenter webcam bubble */
  presenter: Rect;
  /**
   * Per-project scene geometry that differs by shape. Add keys here for any
   * page whose portrait layout can't be derived from the masters above, e.g.
   *   grid: { area: Rect; cols: number }      // a grid of cards/windows
   *   focus: "whole" | "pane"                 // what the end framing shows
   * and fill both specs below. Keep the landscape values untouched when adding portrait ones.
   */
  scene: SceneGeometry;
}

const LANDSCAPE: FrameSpec = {
  orientation: "landscape",
  W: 1920,
  H: 1080,
  safe: { x: 120, y: 80, w: 1680, h: 920 },
  type: {
    T01: { size: 200, weight: 600, line: 1.1 }, // single-title (L01) pages: big; 160 read as too small
    T02: { size: 112, weight: 600, line: 1.1 },
    T03: { size: 96, weight: 600, line: 1.1 },
    T04: { size: 64, weight: 500, line: 1.2 },
    T05: { size: 56, weight: 400, line: 1.25 },
    T06: { size: 44, weight: 500, line: 1.25 },
    T07: { size: 32, weight: 400, line: 1.3 },
    T08: { size: 280, weight: 600, line: 1 },
    T09: { size: 48, weight: 400, line: 1.3 },
  },
  layout: {
    L01: { phrase: { x: 120, y: 260, w: 1680, h: 440 }, sub: { x: 320, y: 720, w: 1280, h: 140 } },
    L02: { title: { x: 120, y: 80, w: 1440, h: 152 }, image: { x: 240, y: 300, w: 1440, h: 544 } },
    L03: { title: { x: 120, y: 80, w: 1440, h: 152 }, image: { x: 120, y: 300, w: 1680, h: 544 } },
    // L04 image runs to the safe-area edge (spec: 816 wide) so screenshots read; the text column keeps its width
    L04: {
      title: { x: 120, y: 240, w: 560, h: 260 },
      body: { x: 120, y: 548, w: 560, h: 240 },
      image: { x: 744, y: 140, w: 1056, h: 704 },
    },
    L05: {
      number: { x: 200, y: 180, w: 1520, h: 400 },
      claim: { x: 320, y: 600, w: 1280, h: 100 },
      note: { x: 200, y: 744, w: 1520, h: 60 },
    },
    L06: {
      title: { x: 120, y: 80, w: 1440, h: 152 },
      labelA: { x: 120, y: 300, w: 808, h: 80 },
      labelB: { x: 992, y: 300, w: 808, h: 80 },
      imageA: { x: 120, y: 396, w: 808, h: 392 },
      imageB: { x: 992, y: 396, w: 808, h: 392 },
      note: { x: 120, y: 800, w: 1680, h: 44 },
    },
  },
  subtitle: { bottom: 1000, size: 44, maxWidth: 1560 },
  presenter: { x: 1588, y: 80, w: 212, h: 200 },
  scene: {
    detail: { x: 120, y: 232, w: 1680, h: 616 }, // centre 960,540; bottom 848 clears the subtitle band (top ≈864)
  },
};

// Portrait: safe area x 72–1008, y 200–1500; subtitles end at 1500; presenter top-right.
const PORTRAIT: FrameSpec = {
  orientation: "portrait",
  W: 1080,
  H: 1920,
  safe: { x: 72, y: 200, w: 936, h: 1300 },
  type: {
    T01: { size: 150, weight: 600, line: 1.1 }, // single-title (L01) pages: big; 120 read as too small
    T02: { size: 84, weight: 600, line: 1.12 },
    T03: { size: 84, weight: 600, line: 1.12 },
    T04: { size: 52, weight: 500, line: 1.2 },
    T05: { size: 46, weight: 400, line: 1.3 },
    T06: { size: 40, weight: 500, line: 1.3 },
    T07: { size: 30, weight: 400, line: 1.3 },
    T08: { size: 200, weight: 600, line: 1 },
    T09: { size: 36, weight: 400, line: 1.3 },
  },
  layout: {
    L01: { phrase: { x: 72, y: 560, w: 936, h: 520 }, sub: { x: 72, y: 1120, w: 936, h: 160 } },
    L02: { title: { x: 72, y: 230, w: 700, h: 200 }, image: { x: 72, y: 470, w: 936, h: 820 } },
    L03: { title: { x: 72, y: 230, w: 700, h: 200 }, image: { x: 72, y: 470, w: 936, h: 820 } },
    L04: {
      title: { x: 72, y: 230, w: 700, h: 200 },
      image: { x: 72, y: 460, w: 936, h: 600 },
      body: { x: 72, y: 1090, w: 936, h: 260 },
    },
    L05: {
      number: { x: 72, y: 440, w: 936, h: 680 },
      claim: { x: 72, y: 1150, w: 936, h: 80 },
      note: { x: 72, y: 1240, w: 936, h: 50 },
    },
    L06: {
      title: { x: 72, y: 230, w: 700, h: 200 },
      labelA: { x: 72, y: 450, w: 936, h: 60 },
      imageA: { x: 72, y: 516, w: 936, h: 340 },
      labelB: { x: 72, y: 878, w: 936, h: 60 },
      imageB: { x: 72, y: 944, w: 936, h: 340 },
      note: { x: 72, y: 1300, w: 936, h: 44 },
    },
  },
  subtitle: { bottom: 1500, size: 40, maxWidth: 960 },
  presenter: { x: 796, y: 200, w: 212, h: 200 },
  scene: {
    detail: { x: 72, y: 562, w: 936, h: 796 }, // centre 540,960; bottom 1358 clears the subtitle band (top ≈1374)
  },
};

export const FRAMES: Record<Orientation, FrameSpec> = { landscape: LANDSCAPE, portrait: PORTRAIT };

const FrameContext = createContext<FrameSpec>(LANDSCAPE);

export const FrameProvider: React.FC<{ orientation: Orientation; children: React.ReactNode }> = ({ orientation, children }) => (
  <FrameContext.Provider value={FRAMES[orientation]}>{children}</FrameContext.Provider>
);

/** The current canvas spec: sizes, type scale and layouts for this orientation. */
export const useFrame = (): FrameSpec => useContext(FrameContext);
