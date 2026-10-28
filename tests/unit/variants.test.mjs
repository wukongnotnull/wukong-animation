import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { aspectOf, orientationOf, suffixOf, sizeOf, resolveVariant, overrideShotPath, listAspects } from '../../plugin/engine/core/variants.mjs';

const STYLE = { id: 'keynote', aspects: ['16:9', '9:16'] };
const FILM = { title: '七十二变', style: 'keynote', size: [1920, 1080], export: { name: 'qishier' } };
const DIR = '/tmp/films/qishier';

test('aspectOf reduces the size to W:H', () => {
  assert.equal(aspectOf([1920, 1080]), '16:9');
  assert.equal(aspectOf([320, 180]), '16:9');
  assert.equal(aspectOf([1080, 1920]), '9:16');
  assert.equal(aspectOf([1080, 1080]), '1:1');
  assert.equal(aspectOf([1080, 1350]), '4:5');
});

test('orientationOf tells landscape, portrait and square apart', () => {
  assert.equal(orientationOf([1920, 1080]), 'landscape');
  assert.equal(orientationOf([1080, 1920]), 'portrait');
  assert.equal(orientationOf([1080, 1080]), 'square');
});

test('suffixOf writes the aspect as WxH for file names', () => {
  assert.equal(suffixOf('16:9'), '16x9');
  assert.equal(suffixOf('9:16'), '9x16');
});

test('sizeOf keeps the short edge of the main size', () => {
  assert.deepEqual(sizeOf('9:16', [1920, 1080]), [1080, 1920]);
  assert.deepEqual(sizeOf('16:9', [1080, 1920]), [1920, 1080]);
  assert.deepEqual(sizeOf('9:16', [320, 180]), [180, 320]);
  assert.deepEqual(sizeOf('1:1', [1920, 1080]), [1080, 1080]);
});

test('without an aspect the main version keeps every existing path', () => {
  const v = resolveVariant({ film: FILM, style: STYLE, filmDir: DIR });
  assert.equal(v.isMain, true);
  assert.equal(v.aspect, '16:9');
  assert.equal(v.orientation, 'landscape');
  assert.deepEqual(v.size, [1920, 1080]);
  assert.equal(v.suffix, null);
  assert.equal(v.cacheDir, path.join(DIR, '.cache'));
  assert.equal(v.stillsDir, path.join(DIR, 'stills'));
  assert.equal(v.review('小样.mp4'), '小样.mp4');
  assert.equal(v.subtitlesFile, 'subtitles.srt');
  assert.equal(v.enFile, 'subtitles.en.json');
  assert.equal(v.exportName, 'qishier');
  assert.equal(v.title, '七十二变');
  assert.deepEqual(v.overrides, {});
});

test('naming the main aspect is the same as naming none', () => {
  const v = resolveVariant({ film: { ...FILM, variants: { '9:16': {} } }, style: STYLE, filmDir: DIR }, '16:9');
  assert.equal(v.isMain, true);
  assert.equal(v.cacheDir, path.join(DIR, '.cache'));
});

test('a variant gets its own size, cache, stills, review names, subtitles and export name', () => {
  const film = { ...FILM, subtitles: { file: 'zh.srt' }, variants: { '9:16': {} } };
  const v = resolveVariant({ film, style: STYLE, filmDir: DIR }, '9:16');
  assert.equal(v.isMain, false);
  assert.equal(v.aspect, '9:16');
  assert.equal(v.orientation, 'portrait');
  assert.deepEqual(v.size, [1080, 1920]);
  assert.equal(v.suffix, '9x16');
  assert.equal(v.cacheDir, path.join(DIR, '.cache', '9x16'));
  assert.equal(v.stillsDir, path.join(DIR, 'stills', '9x16'));
  assert.equal(v.review('小样.mp4'), '小样-9x16.mp4');
  assert.equal(v.review('主版不变报告.md'), '主版不变报告-9x16.md');
  assert.equal(v.subtitlesFile, 'zh.9x16.srt');
  assert.equal(v.enFile, 'subtitles.en.9x16.json');
  assert.equal(v.exportName, 'qishier-9x16');
  assert.equal(v.title, '七十二变-9x16');
});

test('a portrait main version can have a landscape variant', () => {
  const film = { ...FILM, size: [1080, 1920], variants: { '16:9': {} } };
  const v = resolveVariant({ film, style: STYLE, filmDir: DIR }, '16:9');
  assert.deepEqual(v.size, [1920, 1080]);
  assert.equal(v.cacheDir, path.join(DIR, '.cache', '16x9'));
});

test('variant overrides: export name and subtitle style', () => {
  const film = { ...FILM, variants: { '9:16': { export: { name: 'qishier-shu' }, subtitles: { style: { size: 0.03 } } } } };
  const v = resolveVariant({ film, style: STYLE, filmDir: DIR }, '9:16');
  assert.equal(v.exportName, 'qishier-shu');
  assert.deepEqual(v.overrides.subtitles, { style: { size: 0.03 } });
});

test('rejects aspects that are malformed, not declared, the main one as a variant, or unsupported by the style', () => {
  const ctx = (film, style = STYLE) => ({ film, style, filmDir: DIR });
  assert.throws(() => resolveVariant(ctx({ ...FILM, variants: { '9:16': {} } }), '9x16'), /W:H/);
  assert.throws(() => resolveVariant(ctx(FILM), '9:16'), /variants.*16:9/s);
  assert.throws(() => resolveVariant(ctx({ ...FILM, variants: { '16:9': {} } }), '9:16'), /主版/);
  assert.throws(() => resolveVariant(ctx({ ...FILM, variants: { '9:16': {} } }, { id: 'x', aspects: ['16:9'] }), '9:16'), /x.*16:9/s);
  assert.throws(() => resolveVariant(ctx({ ...FILM, variants: { '1:1': {} } }), '1:1'), /keynote.*16:9、9:16/s);
});

test('a variant is checked even when the film only renders the main version', () => {
  assert.throws(() => resolveVariant({ film: { ...FILM, variants: { '16:9': {} } }, style: STYLE, filmDir: DIR }), /主版/);
});

test('overrideShotPath picks shots/sNN.<suffix>.<ext> when it exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-variant-'));
  const shot = path.join(dir, 's03.tsx');
  fs.writeFileSync(shot, '');
  assert.equal(overrideShotPath(shot, '9x16'), shot);
  fs.writeFileSync(path.join(dir, 's03.9x16.tsx'), '');
  assert.equal(overrideShotPath(shot, '9x16'), path.join(dir, 's03.9x16.tsx'));
  assert.equal(overrideShotPath(shot, null), shot);
});

test('listAspects lists the main version first, then the variants', () => {
  assert.deepEqual(listAspects(FILM), ['16:9']);
  assert.deepEqual(listAspects({ ...FILM, variants: { '9:16': {} } }), ['16:9', '9:16']);
});

test('film.schema accepts variants with export name and subtitle style overrides only', async () => {
  const { validate } = await import('../../plugin/engine/core/validate.mjs');
  const film = { title: 't', style: 'keynote', size: [1920, 1080], fps: 30, seed: 1, shots: [{ id: 's01', file: 'shots/s01.tsx', duration: 1 }] };
  assert.deepEqual(validate('film', { ...film, variants: { '9:16': {} } }), []);
  assert.deepEqual(validate('film', { ...film, variants: { '9:16': { export: { name: 'x' }, subtitles: { style: { size: 0.03 } } } } }), []);
  assert.notDeepEqual(validate('film', { ...film, variants: { '9:16': { foo: 1 } } }), []);
  assert.notDeepEqual(validate('film', { ...film, variants: { '9:16': { subtitles: { mode: 'burn' } } } }), []);
});

test('style.schema accepts qc.by_aspect overrides', async () => {
  const { validate } = await import('../../plugin/engine/core/validate.mjs');
  const errs = (qc) => validate('style', { qc }).filter((e) => e.includes('qc'));
  assert.deepEqual(errs({ accent_max: 0.04, by_aspect: { '9:16': { accent_max: 0.05 } } }), []);
  assert.notDeepEqual(errs({ by_aspect: { '9:16': { foo: 1 } } }), []);
});

/** 临时片目录：ink-wash 风格（声明了 16:9 与 9:16），s01 有竖版覆盖文件。 */
function inkFilm(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wka-variant-film-'));
  fs.mkdirSync(path.join(dir, 'shots'));
  for (const f of ['s01.js', 's01.9x16.js', 's02.js']) fs.writeFileSync(path.join(dir, 'shots', f), '');
  const film = {
    title: 'v', style: 'ink-wash', size: [320, 180], fps: 10, seed: 1,
    shots: [{ id: 's01', file: 'shots/s01.js', duration: 1 }, { id: 's02', file: 'shots/s02.js', duration: 1 }],
    ...extra,
  };
  fs.writeFileSync(path.join(dir, 'film.json'), JSON.stringify(film));
  return dir;
}

test('loadFilm without an aspect loads the main version as before', async () => {
  const { loadFilm } = await import('../../plugin/engine/core/job.mjs');
  const dir = inkFilm({ variants: { '9:16': {} } });
  const ctx = loadFilm(dir);
  assert.equal(ctx.variant.isMain, true);
  assert.deepEqual(ctx.film.size, [320, 180]);
  assert.equal(ctx.shots[0].path, path.join(dir, 'shots', 's01.js'));
});

test('loadFilm with a variant aspect swaps the size and picks override shot files', async () => {
  const { loadFilm } = await import('../../plugin/engine/core/job.mjs');
  const dir = inkFilm({ variants: { '9:16': { subtitles: { style: { size: 0.03 } } } } });
  const ctx = loadFilm(dir, { aspect: '9:16' });
  assert.equal(ctx.variant.isMain, false);
  assert.deepEqual(ctx.film.size, [180, 320]);
  assert.equal(ctx.shots[0].path, path.join(dir, 'shots', 's01.9x16.js'));
  assert.equal(ctx.shots[1].path, path.join(dir, 'shots', 's02.js'));
  assert.equal(ctx.style.subtitles.size, 0.03);
  // film.json 本身不被改写
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'film.json'), 'utf8')).size, [320, 180]);
});

test('loadFilm rejects an aspect the film does not declare', async () => {
  const { loadFilm } = await import('../../plugin/engine/core/job.mjs');
  assert.throws(() => loadFilm(inkFilm(), { aspect: '9:16' }), /variants/);
});
