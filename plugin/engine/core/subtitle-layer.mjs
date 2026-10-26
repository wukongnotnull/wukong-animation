// 字幕层：每条字幕用 Chromium 渲染成一张与画面同尺寸的透明 PNG，再用 ffmpeg overlay 按入出点叠到画面上。
// 字幕不进镜头缓存：改字幕不用重渲镜头，只是烧录时整片重新编码一次。
import fs from 'node:fs';
import path from 'node:path';
import { requireDep } from './deps.mjs';
import { run } from './ffmpeg.mjs';
import { prepareFonts } from './fonts.mjs';
import { fileURLToPath } from 'node:url';
import { ensureDir } from './paths.mjs';

const DEFAULTS = {
  font: { family: 'Noto Sans SC', fallback: ['PingFang SC', 'Noto Sans CJK SC', 'sans-serif'] },
  size: 0.045,
  color: '#FFFFFF',
  stroke: { color: 'rgba(0,0,0,0.65)', width: 0.08 },
  bottom: 0.08,
};
/** 一行最宽占画面宽度的比例，超过就缩小字号 */
const MAX_WIDTH = 0.9;

/** 风格 style.json 的 subtitles 块加上缺省值。 */
export function subtitleStyle(style = {}) {
  const s = style.subtitles || {};
  return { ...DEFAULTS, ...s, font: s.font || DEFAULTS.font, stroke: { ...DEFAULTS.stroke, ...s.stroke } };
}

function buildPage({ W, H, style, fonts, workDir }) {
  const size = Math.round(style.size * H);
  const config = {
    W,
    H,
    size,
    bottom: Math.round(style.bottom * H),
    maxWidth: Math.round(W * MAX_WIDTH),
    family: fonts.stacks[style.font.family],
    color: style.color,
    strokeColor: style.stroke.color,
    strokeWidth: style.stroke.width,
  };
  // 模板放在 core/ 而不是 runtime/：runtime/ 下的文件都算进镜头哈希，放进去会让所有镜头缓存失效
  const tpl = fs.readFileSync(fileURLToPath(new URL('./subtitle-layer.html', import.meta.url)), 'utf8');
  const file = path.join(workDir, 'subtitle.html');
  fs.writeFileSync(file, tpl.replace('{{FONT_CSS}}', fonts.css).replace('{{CONFIG}}', JSON.stringify(config)));
  return { file, size };
}

async function renderPngs({ W, H, style, subs, workDir, log }) {
  let chromium;
  try {
    ({ chromium } = requireDep('playwright'));
  } catch {
    throw new Error('烧录字幕需要 browser 管线依赖（playwright + Chromium），运行 /wukong-animation:setup 安装');
  }
  const fonts = prepareFonts([style.font], { text: subs.map((s) => s.text).join(''), workDir, log });
  for (const r of fonts.report) log(`  字幕字体 ${r}`);
  const page = buildPage({ W, H, style, fonts, workDir });
  const dir = ensureDir(path.join(workDir, 'subtitles'));
  const browser = await chromium.launch({ args: ['--allow-file-access-from-files', '--force-color-profile=srgb', '--font-render-hinting=none'] });
  try {
    const tab = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    await tab.goto('file://' + page.file);
    const files = [];
    for (const s of subs) {
      const used = await tab.evaluate((text) => window.setSubtitle(text), s.text);
      if (used < page.size) log(`  ! 第 ${s.index} 条一行放不下，字号从 ${page.size}px 缩到 ${used}px`);
      const f = path.join(dir, `${String(s.index).padStart(4, '0')}.png`);
      await tab.screenshot({ path: f, omitBackground: true });
      files.push(f);
    }
    return files;
  } finally {
    await browser.close();
  }
}

/**
 * 把字幕烧录到 video 上，写到 out。
 * @param {object} o { W, H, style（style.json）, workDir, proxy, audio?（同时混入的声轨）, log }
 */
export async function burnSubtitles(video, subs, out, { W, H, style, workDir, proxy = false, audio = null, log = console.log }) {
  const pngs = subs.length ? await renderPngs({ W, H, style: subtitleStyle(style), subs, workDir, log }) : [];
  const inputs = ['-i', video, ...pngs.flatMap((f) => ['-i', f]), ...(audio ? ['-i', audio] : [])];
  const chain = pngs.map((_, i) => `[${i ? `v${i}` : '0:v'}][${i + 1}:v]overlay=0:0:enable='between(t,${subs[i].start},${subs[i].end})'[v${i + 1}]`);
  const videoMap = pngs.length ? ['-filter_complex', chain.join(';'), '-map', `[v${pngs.length}]`] : ['-map', '0:v'];
  const audioMap = audio ? ['-map', `${pngs.length + 1}:a`, '-c:a', 'aac', '-b:a', '192k', '-shortest'] : [];
  await run([
    ...inputs,
    ...videoMap, ...audioMap,
    '-c:v', 'libx264', '-preset', proxy ? 'veryfast' : 'medium', '-crf', proxy ? '23' : '16', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', out,
  ]);
  log(`  ✓ 已烧录字幕 ${subs.length} 条 → ${path.basename(out)}`);
  return out;
}
