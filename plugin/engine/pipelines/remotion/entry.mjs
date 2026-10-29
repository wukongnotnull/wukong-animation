// remotion 管线的纯函数部分：生成打包入口、改写字体 CSS、推出 headless shell 路径。不碰文件系统（headlessShellFrom 的 fs 由调用方传入）。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aspectOf, orientationOf } from '../../core/variants.mjs';
import { buildFrameTimeline } from '../../core/timing.mjs';

const SHOT_WRAPPER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'WkaShot.jsx');

/** 字体 CSS 里静态文件地址的占位前缀；WkaShot 在页面里换成 staticFile() 的结果。 */
export const STATIC_PREFIX = 'wka-static:';


/**
 * 打包入口源码：每个镜头一个 Composition（设计尺寸、film.fps），外包 WkaShot 注入字体并等字体就绪。
 * 组件看到的 s.W / s.H 是设计尺寸；小样的缩小由 renderMedia 的 scale 完成。
 * @param {object} job  需要 film.fps / film.cues / designW / designH / seed / shots / styleEntry
 * @param {string} fontCss  已经过 rewriteFontCss 的 @font-face
 */
export function buildEntry(job, fontCss) {
  const fps = job.film.fps;
  const native = buildFrameTimeline(job.shots, fps);
  const shots = job.shots.map((sh, i) => ({
    id: sh.id,
    frames: native.shots[i].frames,
    s: {
      id: sh.id, W: job.designW, H: job.designH, designW: job.designW, designH: job.designH,
      aspect: aspectOf([job.designW, job.designH]), orientation: orientationOf([job.designW, job.designH]),
      fps, seed: job.seed, cues: job.film.cues || {}, duration: sh.duration, start: sh.start,
      ...(Object.keys(sh.wordFrames || {}).length ? { wordFrames: sh.wordFrames, renderStart: sh.renderStart } : {}),
    },
  }));
  const lines = [
    'import React from "react";',
    'import { registerRoot, Composition } from "remotion";',
    `import { WkaShot } from ${JSON.stringify(SHOT_WRAPPER)};`,
    job.styleEntry ? 'import * as Style from "@wka/style";' : 'const Style = {};',
    ...job.shots.map((sh, i) => `import S${i} from ${JSON.stringify(sh.path)};`),
    `const SHOTS = ${JSON.stringify(shots)};`,
    `const FONT_CSS = ${JSON.stringify(fontCss)};`,
    `const COMPONENTS = [${job.shots.map((_, i) => `S${i}`).join(', ')}];`,
    'const h = React.createElement;',
    'const Root = () => h(React.Fragment, null, SHOTS.map((x, i) => h(Composition, {',
    '  key: x.id, id: x.id, durationInFrames: x.frames, fps: x.s.fps, width: x.s.designW, height: x.s.designH,',
    '  component: () => h(WkaShot, { Shot: COMPONENTS[i], Wrap: Style["ShotRoot"], s: x.s, dur: x.frames, fontCss: FONT_CSS }),',
    '})));',
    'registerRoot(Root);',
    '',
  ];
  return lines.join('\n');
}

/** 镜头里可用的模块别名。 */
export function webpackAliases(job) {
  return { ...(job.styleEntry ? { '@wka/style': job.styleEntry } : {}), '@wka/film': job.filmDir };
}

/**
 * 打包后的页面走 http，读不到 file://：把字体改成静态目录里的文件。
 * @returns {{css: string, files: {from: string, to: string}[]}}  files 由调用方复制到 publicDir
 */
export function rewriteFontCss(css) {
  const files = [];
  const out = css.replace(/url\('file:\/\/([^']+)'\)/g, (_, from) => {
    const to = `fonts/${files.length}-${path.basename(from)}`;
    files.push({ from, to });
    return `url('${STATIC_PREFIX}${to}')`;
  });
  return { css: out, files };
}

/**
 * playwright 的完整版 Chromium 不能给 Remotion 用，同版本的 headless shell 可以。
 * 把路径里的 chromium-<rev> 换成 chromium_headless_shell-<rev>，在其中找 chrome-headless-shell[.exe]。
 * @returns {string|null} 找不到时 null（交给 Remotion 自己下载）
 */
export function headlessShellFrom(exe, fsLike, sep = path.sep) {
  const parts = exe.split(sep);
  const i = parts.findIndex((p) => /^chromium-\d+$/.test(p));
  if (i < 0) return null;
  const root = [...parts.slice(0, i), parts[i].replace('chromium-', 'chromium_headless_shell-')].join(sep);
  const ls = (d) => {
    try {
      return fsLike.readdirSync(d);
    } catch {
      return [];
    }
  };
  for (const sub of ls(root).filter((d) => d.startsWith('chrome-headless-shell'))) {
    const bin = ls(root + sep + sub).find((f) => f === 'chrome-headless-shell' || f === 'chrome-headless-shell.exe');
    if (bin) return [root, sub, bin].join(sep);
  }
  return null;
}
