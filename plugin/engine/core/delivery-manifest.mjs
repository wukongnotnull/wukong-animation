import fs from 'node:fs';
import path from 'node:path';
import { hashFile } from './file-hash.mjs';
import { loadFilm } from './film-context.mjs';
import { resolveVariant, suffixOf } from './variants.mjs';
import { reviewFile, finalFile } from './layout.mjs';
import { assertActiveProduction, LAST_STEP, PRODUCTION_ROLES } from './state.mjs';
import { scopedPath } from './workbench-catalog.mjs';

const TEXT = {
  2: ['brief.md'],
  3: ['brief.md', 'story.md'],
  4: ['brief.md', 'story.md'],
  5: ['brief.md', 'story.md', 'storyboard.md'],
};
export const MANIFEST = 'review/交付/delivery-manifest.json';

function relative(dir, file) {
  const rel = path.relative(dir, path.resolve(dir, file)).split(path.sep).join('/');
  if (!rel || rel.startsWith('../') || path.isAbsolute(rel)) throw new Error(`待审文件超出影片范围：${file}`);
  return rel;
}
function exists(dir, rel) {
  return fs.existsSync(path.join(dir, rel)) && fs.statSync(path.join(dir, rel)).isFile();
}
function generated(dir, ctx, proxy) {
  const names = proxy
    ? ['小样.mp4', 'QC报告-proxy.json', 'QC报告-proxy.md']
    : ['QC报告.json', 'QC报告.md'];
  const files = names.map(name => relative(dir, reviewFile(dir, ctx.variant.review(name))));
  if (!proxy) files.push(relative(dir, finalFile(dir, `${ctx.variant.exportName}.mp4`)));
  return files.filter(file => exists(dir, file));
}
function sourceFiles(dir, film) {
  const files = ['film.json', ...film.scripts || [], ...film.shots?.map(shot => shot.file) || []];
  if (film.audio?.build) files.push(film.audio.build);
  for (const item of [...film.audio?.tracks || [], ...film.audio?.voices || []]) if (item?.file) files.push(item.file);
  for (const aspect of Object.keys(film.variants || {})) {
    const mark = `.${suffixOf(aspect)}`;
    for (const shot of film.shots || []) if (shot.file) {
      const ext = path.extname(shot.file);
      files.push(ext ? shot.file.slice(0, -ext.length) + mark + ext : shot.file + mark);
    }
  }
  files.push('.wka/voice-alignment.json', '.wka/word-timeline.json', 'sync-points.json', '.wka/review-notes.json');
  return files.map(file => relative(dir, file)).filter(file => exists(dir, file));
}
function entry(dir, rel) {
  const file = path.join(dir, rel), stat = fs.statSync(file);
  return { path: rel, bytes: stat.size, sha256: hashFile(file) };
}

export function buildManifest(dir, step) {
  assertActiveProduction(dir);
  dir = path.resolve(dir);
  const stepNumber = Number(step);
  if (!Number.isInteger(stepNumber) || stepNumber < 2 || stepNumber > LAST_STEP) throw new Error('待审工序无效');
  let tracked = [], media = [];
  if (stepNumber === PRODUCTION_ROLES.voice) {
    const ctx = loadFilm(dir, { requireShots: false, requireTimeline: false });
    const recordings = (ctx.film.audio?.voices || []).map(voice => relative(dir, scopedPath(dir, voice.file)));
    const evidence = ['.wka/voice-alignment.json', '.wka/word-timeline.json', 'review/台词/台词定位.md', 'review/台词/逐词时间表.md'];
    tracked = ['film.json', ...TEXT[4], ...recordings, ...evidence].filter(file => exists(dir, file));
    media = [...recordings, ...evidence].filter(file => exists(dir, file));
  }
  else if (stepNumber <= PRODUCTION_ROLES.storyboard) tracked = ['film.json', ...TEXT[stepNumber]].filter(file => exists(dir, file));
  else if (fs.existsSync(path.join(dir, 'film.json'))) {
    const ctx = loadFilm(dir, { requireShots: false });
    tracked = [...TEXT[5].filter(file => exists(dir, file)), ...sourceFiles(dir, ctx.film)];
    media = stepNumber === PRODUCTION_ROLES.proxy ? generated(dir, ctx, true) : stepNumber === PRODUCTION_ROLES.final ? generated(dir, ctx, false) : [];
    if (stepNumber === PRODUCTION_ROLES.variant) {
      for (const aspect of Object.keys(ctx.film.variants || {})) {
        const variant = resolveVariant(ctx, aspect);
        media.push(...['小样.mp4', 'QC报告-proxy.json', 'QC报告-proxy.md'].map(name => relative(dir, reviewFile(dir, variant.review(name)))));
        media.push(relative(dir, finalFile(dir, `${variant.exportName}.mp4`)));
      }
      media = media.filter(file => exists(dir, file));
    }
  }
  return {
    version: 1, step: stepNumber,
    tracked: [...new Set(tracked)].sort(),
    generated: [...new Set(media)].sort().map(file => entry(dir, file)),
  };
}
export function writeManifest(dir, manifest) {
  const file = path.join(path.resolve(dir), MANIFEST);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
  return MANIFEST;
}
export function verifyManifest(dir) {
  dir = path.resolve(dir);
  const file = path.join(dir, MANIFEST);
  if (!fs.existsSync(file)) return { ok: false, reason: '缺少待审校验清单' };
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const rel of manifest.tracked || []) if (!exists(dir, rel)) return { ok: false, reason: `待审源文件缺失：${rel}` };
  for (const item of manifest.generated || []) {
    if (!exists(dir, item.path)) return { ok: false, reason: `待审文件缺失：${item.path}` };
    const current = entry(dir, item.path);
    if (current.bytes !== item.bytes || current.sha256 !== item.sha256) return { ok: false, reason: `待审文件已变化：${item.path}` };
  }
  return { ok: true, manifest };
}
