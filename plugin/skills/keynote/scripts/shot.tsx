import React, { createContext, useContext } from "react";
import { AbsoluteFill } from "remotion";
import { Backdrop } from "./components/Backdrop";
import { FrameProvider } from "./frame";

/** What the engine passes every shot (same fields as the browser pipeline's `s`). */
export interface ShotInfo {
  id: string;
  /** design size; proxies are scaled down by the renderer, not here */
  W: number;
  H: number;
  designW: number;
  designH: number;
  /** current aspect, '16:9' / '9:16': the main version and its variants share one shot file */
  aspect: string;
  orientation: "landscape" | "portrait" | "square";
  fps: number;
  seed: number;
  /** seconds, film time */
  duration: number;
  start: number;
  /** sync point in / out, seconds relative to this shot: 用 sec(秒数, s.fps) 换成帧 */
  cueIn: (name: string) => number;
  cueOut: (name: string) => number;
}

export interface ShotProps {
  /** shot length in frames */
  dur: number;
  s: ShotInfo;
}

const ShotContext = createContext<ShotProps | null>(null);

/** The current shot's props, for components that need film time (Backdrop) without prop drilling. */
export function useShot(): ShotProps {
  const v = useContext(ShotContext);
  if (!v) throw new Error("useShot() 只能在镜头里用");
  return v;
}

interface ShotRootProps extends ShotProps {
  children: React.ReactNode;
}

/** Wraps every keynote shot (the remotion pipeline picks it up from @wka/style): geometry context + backdrop. */
export function ShotRoot({ dur, s, children }: ShotRootProps) {
  // 引擎按当前画幅给出（主版 / 副版共用同一镜头）；方形按横屏版式排
  const orientation = s.orientation === "portrait" ? "portrait" : "landscape";
  return (
    <ShotContext.Provider value={{ dur, s }}>
      <FrameProvider orientation={orientation}>
        <AbsoluteFill>
          <Backdrop />
          {children}
        </AbsoluteFill>
      </FrameProvider>
    </ShotContext.Provider>
  );
}
