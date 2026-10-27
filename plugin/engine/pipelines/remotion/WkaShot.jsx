// 每个镜头的外壳（打包进页面）：注入字体、等字体就绪再出第一帧，再交给风格的 ShotRoot（若有）和镜头组件。
import React, { useEffect, useState } from 'react';
import { continueRender, delayRender, staticFile } from 'remotion';

const PREFIX = /wka-static:([^')]+)/g;

/**
 * @param {{ Shot: Function, Wrap?: Function, s: object, dur: number, fontCss: string }} props
 */
export function WkaShot({ Shot, Wrap, s, dur, fontCss }) {
  const css = fontCss.replace(PREFIX, (_, p) => staticFile(p));
  const [handle] = useState(() => delayRender('等字体就绪'));
  useEffect(() => {
    const families = [...css.matchAll(/font-family:'([^']+)'/g)].map((m) => m[1]);
    Promise.all(families.map((f) => document.fonts.load(`48px '${f}'`, '永字八法Aa').catch(() => {})))
      .then(() => document.fonts.ready)
      .then(() => continueRender(handle));
  }, []);
  const inner = <Shot dur={dur} s={s} />;
  return (
    <>
      <style>{css}</style>
      {Wrap ? <Wrap dur={dur} s={s}>{inner}</Wrap> : inner}
    </>
  );
}
