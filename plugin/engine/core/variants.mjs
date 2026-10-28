// 画幅变体：一部片的主版（film.json 的 size）和副版（film.json 的 variants）。
// 主版的路径全部保持原样；副版的缓存、静帧放子目录，其余文件名带画幅后缀（如 9x16）。
import fs from 'node:fs';
import path from 'node:path';

const ASPECT_RE = /^(\d+):(\d+)$/;

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/** [1920, 1080] → '16:9' */
export function aspectOf([W, H]) {
  const g = gcd(W, H);
  return `${W / g}:${H / g}`;
}

export function orientationOf([W, H]) {
  return W > H ? 'landscape' : W < H ? 'portrait' : 'square';
}

/** '9:16' → '9x16'（写进文件名用） */
export const suffixOf = (aspect) => aspect.replace(':', 'x');

function parseAspect(aspect) {
  const m = ASPECT_RE.exec(String(aspect));
  if (!m) throw new Error(`画幅要写成 W:H（如 9:16），收到 "${aspect}"`);
  return [Number(m[1]), Number(m[2])];
}

/** 副版尺寸：保持主版的短边，按画幅推出长边（取偶数）。主版 1920×1080 时 9:16 为 1080×1920。 */
export function sizeOf(aspect, mainSize) {
  const [a, b] = parseAspect(aspect);
  const short = Math.min(...mainSize);
  const even = (x) => Math.round(x / 2) * 2;
  return a >= b ? [even((short * a) / b), short] : [short, even((short * b) / a)];
}

/** 主版在前，副版按 variants 的书写顺序 */
export const listAspects = (film) => [aspectOf(film.size), ...Object.keys(film.variants || {})];

/** 文件名在扩展名前插入一段：('小样.mp4', '-9x16') → '小样-9x16.mp4' */
function insertBeforeExt(name, part) {
  const ext = path.extname(name);
  return `${name.slice(0, name.length - ext.length)}${part}${ext}`;
}

function checkVariants(film, style) {
  const main = aspectOf(film.size);
  const supported = style.aspects || [];
  for (const aspect of Object.keys(film.variants || {})) {
    parseAspect(aspect);
    if (aspect === main) throw new Error(`film.json 的 variants 里的 ${aspect} 就是主版画幅，副版要用另一种画幅`);
    for (const a of [main, aspect]) {
      if (!supported.includes(a)) throw new Error(`风格 ${style.id} 只支持 ${supported.join('、') || '（未声明 aspects）'}，不能出 ${a} 的版本`);
    }
  }
}

/**
 * 解析要处理的画幅版本。aspect 缺省或等于主版画幅 = 主版。
 * @returns {{aspect, isMain, orientation, size, suffix, cacheDir, stillsDir, review: (name: string) => string,
 *   subtitlesFile, enFile, exportName, title, overrides}}
 */
export function resolveVariant({ film, style, filmDir }, aspect = null) {
  checkVariants(film, style);
  const main = aspectOf(film.size);
  const subtitlesFile = film.subtitles?.file || 'subtitles.srt';
  const exportName = film.export?.name || 'out';
  if (!aspect || aspect === main) {
    return {
      aspect: main,
      isMain: true,
      orientation: orientationOf(film.size),
      size: film.size,
      suffix: null,
      cacheDir: path.join(filmDir, '.cache'),
      stillsDir: path.join(filmDir, 'stills'),
      review: (name) => name,
      subtitlesFile,
      enFile: 'subtitles.en.json',
      exportName,
      title: film.title,
      overrides: {},
    };
  }
  parseAspect(aspect);
  const declared = Object.keys(film.variants || {});
  if (!declared.includes(aspect)) {
    throw new Error(`film.json 的 variants 里没有 ${aspect}。可用：${[`${main}（主版）`, ...declared].join('、')}`);
  }
  const overrides = film.variants[aspect] || {};
  const size = sizeOf(aspect, film.size);
  const suffix = suffixOf(aspect);
  return {
    aspect,
    isMain: false,
    orientation: orientationOf(size),
    size,
    suffix,
    cacheDir: path.join(filmDir, '.cache', suffix),
    stillsDir: path.join(filmDir, 'stills', suffix),
    review: (name) => insertBeforeExt(name, `-${suffix}`),
    subtitlesFile: insertBeforeExt(subtitlesFile, `.${suffix}`),
    enFile: `subtitles.en.${suffix}.json`,
    exportName: overrides.export?.name || `${exportName}-${suffix}`,
    title: `${film.title}-${suffix}`,
    overrides,
  };
}

/** 副版的覆盖镜头文件：shots/s03.tsx → shots/s03.9x16.tsx（存在时） */
export function overrideShotPath(shotPath, suffix) {
  if (!suffix) return shotPath;
  const alt = insertBeforeExt(shotPath, `.${suffix}`);
  return fs.existsSync(alt) ? alt : shotPath;
}
