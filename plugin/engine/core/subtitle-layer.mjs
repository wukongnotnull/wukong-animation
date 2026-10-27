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

/** 字幕样式叠加：font 整体替换，stroke 按字段合并，其余字段直接覆盖。 */
export function mergeSubtitleStyle(base = {}, override = {}) {
  const merged = { ...base, ...override };
  if (base.font || override.font) merged.font = override.font || base.font;
  if (base.font_en || override.font_en) merged.font_en = override.font_en || base.font_en;
  if (base.stroke || override.stroke) merged.stroke = { ...base.stroke, ...override.stroke };
  return merged;
}

/** 风格 style.json 的 subtitles 块（已叠加 film.json 的 subtitles.style）加上缺省值。 */
export function subtitleStyle(style = {}) {
  return mergeSubtitleStyle(DEFAULTS, style.subtitles);
}

function buildPage({ W, H, style, fonts, workDir }) {
  const enFont = style.font_en || style.font;
  const size = Math.round(style.size * H);
  const config = {
    W,
    H,
    size,
    bottom: Math.round(style.bottom * H),
    maxWidth: Math.round(W * MAX_WIDTH),
    family: fonts.stacks[style.font.family],
    familyEn: fonts.stacks[enFont.family],
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
  // 英文字体只在真有英文行时才准备（单语片子不多下载、不多打日志）
  const bilingual = subs.some((s) => s.en);
  const families = [style.font, ...(bilingual && style.font_en && style.font_en.family !== style.font.family ? [style.font_en] : [])];
  const fonts = prepareFonts(families, { text: subs.map((s) => s.text + (s.en || '')).join(''), workDir, log });
  for (const r of fonts.report) log(`  字幕字体 ${r}`);
  const page = buildPage({ W, H, style, fonts, workDir });
  const dir = ensureDir(path.join(workDir, 'subtitles'));
  const browser = await chromium.launch({ args: ['--allow-file-access-from-files', '--force-color-profile=srgb', '--font-render-hinting=none'] });
  try {
    const tab = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    await tab.goto('file://' + page.file);
    const files = [];
    for (const s of subs) {
      const used = await tab.evaluate(([text, en]) => window.setSubtitle(text, en), [s.text, s.en || null]);
      if (used.zh < page.size) log(`  ! 第 ${s.index} 条${s.en ? '中文' : ''}一行放不下，字号从 ${page.size}px 缩到 ${used.zh}px`);
      if (used.en !== null && used.en < page.size) log(`  ! 第 ${s.index} 条英文一行放不下，字号从 ${page.size}px 缩到 ${used.en}px`);
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
